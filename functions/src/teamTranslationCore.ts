import { createHash } from 'node:crypto';
import languages from './teamTranslationLanguages.json';

export type TranslationSource =
  | { kind: 'announcement'; teamId: string; messageId: string }
  | { kind: 'privateMessage'; conversationId: string; messageId: string };
export type TranslationRequest = TranslationSource & { targetLanguage: string; consentVersion: 1 };
export const TRANSLATION_MAX_CHARACTERS = 2400;
const allowedLanguages = new Set(languages.map(([code]) => code));
export function resolveTranslationProject(environment: Record<string, string | undefined>): string | null {
  // A user-managed setting survives configuration PATCHes without relying on
  // legacy provider-reserved variables being represented or injected.
  const value = environment.TEAM_TRANSLATION_PROJECT_ID ?? environment.GCLOUD_PROJECT ?? environment.GOOGLE_CLOUD_PROJECT ?? environment.GCP_PROJECT;
  return value && /^[a-z][a-z0-9-]{4,62}$/.test(value) ? value : null;
}
export function parseTranslationRequest(value: unknown): TranslationRequest {
  if (!value || typeof value !== 'object') throw new Error('invalid-argument');
  const data = value as Record<string, unknown>;
  const allowedKeys = data.kind === 'announcement'
    ? ['kind', 'teamId', 'messageId', 'targetLanguage', 'consentVersion']
    : ['kind', 'conversationId', 'messageId', 'targetLanguage', 'consentVersion'];
  if (Object.keys(data).some((key) => !allowedKeys.includes(key)) || data.consentVersion !== 1 ||
    typeof data.targetLanguage !== 'string' || !allowedLanguages.has(data.targetLanguage)) throw new Error('invalid-argument');
  const identifier = (name: string) => {
    const id = data[name];
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(id)) throw new Error('invalid-argument');
    return id;
  };
  const common = { messageId: identifier('messageId'), targetLanguage: data.targetLanguage, consentVersion: 1 as const };
  if (data.kind === 'announcement') return { ...common, kind: data.kind, teamId: identifier('teamId') };
  if (data.kind === 'privateMessage') return { ...common, kind: data.kind, conversationId: identifier('conversationId') };
  throw new Error('invalid-argument');
}

// URLs, email addresses and six-character team invite codes stay byte-for-byte intact.
// Send separate plain-text spans rather than asking a model to preserve invented placeholders.
export function splitTranslationText(text: string, inviteCode?: string) {
  if (!text.trim() || [...text].length > TRANSLATION_MAX_CHARACTERS) throw new Error('invalid-argument');
  const knownCode = inviteCode && /^[A-HJ-NP-Z2-9]{6}$/.test(inviteCode) ? `|\\b${inviteCode}\\b` : '';
  const expression = new RegExp(`https?:\\/\\/[^\\s<>]+|[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}|\\b(?=[A-HJ-NP-Z2-9]{6}\\b)(?=[A-Z2-9]*[2-9])[A-HJ-NP-Z2-9]{6}\\b${knownCode}`, 'gu');
  const parts: { text: string; translate: boolean }[] = [];
  let offset = 0;
  for (const match of text.matchAll(expression)) {
    const index = match.index!;
    if (index > offset) parts.push({ text: text.slice(offset, index), translate: true });
    parts.push({ text: match[0], translate: false });
    offset = index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), translate: true });
  return parts.flatMap((part) => {
    if (!part.translate || !part.text.trim()) return [{ ...part, translate: false }];
    const leading = part.text.match(/^\s+/u)?.[0] ?? '';
    const trailing = part.text.match(/\s+$/u)?.[0] ?? '';
    return [
      ...(leading ? [{ text: leading, translate: false }] : []),
      { text: part.text.slice(leading.length, part.text.length - trailing.length), translate: true },
      ...(trailing ? [{ text: trailing, translate: false }] : []),
    ];
  });
}
export function translationIdentity(request: TranslationRequest, text: string, inviteCode?: string) {
  return createHash('sha256').update(JSON.stringify([request, text, inviteCode])).digest('hex');
}
export function translationCharacters(texts: string[]) {
  return texts.reduce((total, text) => total + [...text].length, 0);
}
export function nextTranslationUsage(input: {
  now: number; characters: number; monthlyLimit: number;
  global: Record<string, unknown>; user: Record<string, unknown>;
}) {
  const month = new Date(input.now).toISOString().slice(0, 7);
  const day = new Date(input.now).toISOString().slice(0, 10);
  const minute = Math.floor(input.now / 60_000);
  const count = (value: unknown) => {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('resource-exhausted');
    return Number(value);
  };
  const globalCharacters = input.global.month === month ? count(input.global.characters) : 0;
  const userCharacters = input.user.day === day ? count(input.user.characters) : 0;
  const requests = input.user.minute === minute ? count(input.user.requests) : 0;
  if (requests >= 10 || userCharacters + input.characters > 20_000 ||
    globalCharacters + input.characters > input.monthlyLimit) throw new Error('resource-exhausted');
  return {
    global: { month, characters: globalCharacters + input.characters },
    user: { day, minute, characters: userCharacters + input.characters, requests: requests + 1 },
  };
}

export function createTranslationEngine(dependencies: {
  load: (uid: string, request: TranslationRequest) => Promise<{ text: string; inviteCode?: string }>;
  reserve: (uid: string, characters: number) => Promise<void>;
  translate: (texts: string[], language: string) => Promise<string[]>;
  now?: () => number;
}) {
  const cache = new Map<string, { text: string; expires: number }>();
  const pending = new Map<string, Promise<string>>();
  const now = dependencies.now ?? Date.now;
  return async (uid: string, request: TranslationRequest) => {
    const original = await dependencies.load(uid, request); // Reauthorize every cache hit.
    const identity = translationIdentity(request, original.text, original.inviteCode);
    const cached = cache.get(identity);
    let translated = cached && cached.expires > now() ? cached.text : undefined;
    if (translated === undefined) {
      const existing = pending.get(identity);
      if (existing) translated = await existing;
      else {
        const operation = (async () => {
          const parts = splitTranslationText(original.text, original.inviteCode);
          const texts = parts.filter((part) => part.translate).map((part) => part.text);
          await dependencies.reserve(uid, translationCharacters(texts));
          const results = texts.length ? await dependencies.translate(texts, request.targetLanguage) : [];
          if (results.length !== texts.length || results.some((text) => typeof text !== 'string' || !text.trim() || text.length > 12_000)) {
            throw new Error('unavailable');
          }
          let index = 0;
          const text = parts.map((part) => part.translate ? results[index++] : part.text).join('');
          if (text.length > 40_000) throw new Error('unavailable');
          for (const [key, entry] of cache) if (entry.expires <= now()) cache.delete(key);
          if (cache.size >= 100) cache.delete(cache.keys().next().value!);
          cache.set(identity, { text, expires: now() + 5 * 60_000 });
          return text;
        })();
        pending.set(identity, operation);
        try { translated = await operation; } finally { pending.delete(identity); }
      }
    }
    // Membership, standing, deletions and staff takedowns may change during a provider call.
    const latest = await dependencies.load(uid, request);
    if (latest.text !== original.text || latest.inviteCode !== original.inviteCode) throw new Error('failed-precondition');
    return { originalText: original.text, translatedText: translated, targetLanguage: request.targetLanguage, provider: 'Google Translate' as const };
  };
}
