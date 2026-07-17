import AsyncStorage from "@react-native-async-storage/async-storage";
import { httpsCallable } from "firebase/functions";

import { functions } from "@/config/firebase";
import { COACH_CHECKLISTS } from "@/content/coachResources/checklists";
import { COACH_COMMUNICATION_TEMPLATES } from "@/content/coachResources/communicationTemplates";
import { COACH_PRO_TIPS } from "@/content/coachResources/proTips";
import type {
  CoachChecklist,
  CoachChecklistProgress,
  CoachCommunicationTemplate,
  CoachHelpRequest,
  CoachHelpResult,
  CoachProTip,
  CoachResourceLocale,
  LocalizedText,
  SavedCoachHelpResult,
} from "@/types/coachResources";

const CHECKLIST_KEY_PREFIX = "sidelineSocial.coachChecklistProgress.v1";
const GENERATED_HELP_KEY_PREFIX = "sidelineSocial.coachGeneratedHelp.v1";
const SAVED_HELP_KEY_PREFIX = "sidelineSocial.coachSavedHelp.v1";
const PLACEHOLDER_PATTERN = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

export function resolveCoachResourceLocale(language?: string): CoachResourceLocale {
  return language?.toLowerCase().startsWith("es") ? "es" : "en";
}

export function localizeCoachText(value: LocalizedText, locale: CoachResourceLocale) {
  return value[locale] || value.en;
}

export function getCoachChecklists() {
  return COACH_CHECKLISTS.filter((entry) => entry.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getCoachChecklist(checklistId: string) {
  return getCoachChecklists().find((entry) => entry.id === checklistId) ?? null;
}

export function getChecklistItemIds(checklist: CoachChecklist) {
  return checklist.sections.flatMap((section) => section.items.map((entry) => entry.id));
}

export async function getCoachChecklistProgress(userId: string, checklist: CoachChecklist): Promise<CoachChecklistProgress> {
  const empty = createEmptyProgress(checklist);
  if (!userId) return empty;
  try {
    const raw = await AsyncStorage.getItem(checklistProgressKey(userId, checklist.id));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<CoachChecklistProgress>;
    const validItemIds = new Set(getChecklistItemIds(checklist));
    return {
      checklistId: checklist.id,
      completedItemIds: Array.isArray(parsed.completedItemIds)
        ? Array.from(new Set(parsed.completedItemIds.filter((id): id is string => typeof id === "string" && validItemIds.has(id))))
        : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      lastResetAt: typeof parsed.lastResetAt === "string" ? parsed.lastResetAt : undefined,
      contentVersion: checklist.contentVersion,
    };
  } catch (error) {
    logLocalResourceError("read-checklist", error);
    return empty;
  }
}

export async function saveCoachChecklistProgress(userId: string, checklist: CoachChecklist, completedItemIds: string[], lastResetAt?: string) {
  if (!userId) throw new Error("auth_required");
  const validIds = new Set(getChecklistItemIds(checklist));
  const progress: CoachChecklistProgress = {
    checklistId: checklist.id,
    completedItemIds: Array.from(new Set(completedItemIds.filter((id) => validIds.has(id)))),
    updatedAt: new Date().toISOString(),
    ...(lastResetAt ? { lastResetAt } : {}),
    contentVersion: checklist.contentVersion,
  };
  await AsyncStorage.setItem(checklistProgressKey(userId, checklist.id), JSON.stringify(progress));
  return progress;
}

export async function resetCoachChecklistProgress(userId: string, checklist: CoachChecklist) {
  return saveCoachChecklistProgress(userId, checklist, [], new Date().toISOString());
}

export function getCoachCommunicationTemplates() {
  return COACH_COMMUNICATION_TEMPLATES.filter((entry) => entry.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getCoachCommunicationTemplate(templateId: string) {
  return getCoachCommunicationTemplates().find((entry) => entry.id === templateId) ?? null;
}

export function personalizeCoachTemplate(
  template: CoachCommunicationTemplate,
  locale: CoachResourceLocale,
  values: Record<string, string | undefined>,
) {
  return localizeCoachText(template.body, locale).replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    const value = values[key]?.trim();
    return value ? value : match;
  });
}

export function findUnresolvedCoachPlaceholders(message: string) {
  return Array.from(new Set(Array.from(message.matchAll(PLACEHOLDER_PATTERN), (match) => match[1])));
}

export function getCoachProTips() {
  return COACH_PRO_TIPS.filter((entry) => entry.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getLocalCalendarDayNumber(date = new Date()) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

export function getDailyCoachProTip(date = new Date(), tips = getCoachProTips()): CoachProTip {
  if (tips.length === 0) throw new Error("no_active_tips");
  return tips[getLocalCalendarDayNumber(date) % tips.length];
}

export async function generateCoachResourceHelp(request: CoachHelpRequest) {
  const callable = httpsCallable<CoachHelpRequest, CoachHelpResult>(functions, "generateCoachResourceHelp", { timeout: 30_000 });
  return (await callable(request)).data;
}

export async function cacheGeneratedCoachHelpResult(userId: string, requestId: string, result: CoachHelpResult) {
  if (!userId) throw new Error("auth_required");
  await AsyncStorage.setItem(generatedHelpKey(userId, requestId), JSON.stringify(result));
}

export async function getCachedCoachHelpResult(userId: string, requestId: string): Promise<CoachHelpResult | null> {
  if (!userId || !requestId) return null;
  try {
    const raw = await AsyncStorage.getItem(generatedHelpKey(userId, requestId));
    return raw ? JSON.parse(raw) as CoachHelpResult : null;
  } catch (error) {
    logLocalResourceError("read-generated-help", error);
    return null;
  }
}

export async function saveCoachHelpResult(userId: string, requestId: string, result: CoachHelpResult) {
  if (!userId) throw new Error("auth_required");
  const current = await getSavedCoachHelpResults(userId);
  const entry: SavedCoachHelpResult = { id: requestId, result, createdAt: new Date().toISOString() };
  const next = [entry, ...current.filter((item) => item.id !== requestId)].slice(0, 25);
  await AsyncStorage.setItem(savedHelpKey(userId), JSON.stringify(next));
  return entry;
}

export async function getSavedCoachHelpResults(userId: string): Promise<SavedCoachHelpResult[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(savedHelpKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSavedHelpResult) : [];
  } catch (error) {
    logLocalResourceError("read-saved-help", error);
    return [];
  }
}

export async function deleteCoachHelpResult(userId: string, requestId: string) {
  if (!userId) throw new Error("auth_required");
  const next = (await getSavedCoachHelpResults(userId)).filter((item) => item.id !== requestId);
  await AsyncStorage.setItem(savedHelpKey(userId), JSON.stringify(next));
  await AsyncStorage.removeItem(generatedHelpKey(userId, requestId));
}

export function formatCoachHelpResultForSharing(result: CoachHelpResult, locale: CoachResourceLocale) {
  const useLabel = locale === "es" ? "Frases que puedes usar:" : "Phrases to use:";
  const avoidLabel = locale === "es" ? "Frases que conviene evitar:" : "Phrases to avoid:";
  return [
    result.title,
    result.introduction,
    result.body,
    ...(result.sections ?? []).flatMap((section) => [section.heading, ...section.items.map((item, index) => `${index + 1}. ${item}`)]),
    result.phrasesToUse?.length ? `${useLabel}\n${result.phrasesToUse.join("\n")}` : undefined,
    result.phrasesToAvoid?.length ? `${avoidLabel}\n${result.phrasesToAvoid.join("\n")}` : undefined,
    result.safetyNotice,
  ].filter(Boolean).join("\n\n");
}

function createEmptyProgress(checklist: CoachChecklist): CoachChecklistProgress {
  return { checklistId: checklist.id, completedItemIds: [], updatedAt: new Date().toISOString(), contentVersion: checklist.contentVersion };
}

function checklistProgressKey(userId: string, checklistId: string) {
  return `${CHECKLIST_KEY_PREFIX}.${userId}.${checklistId}`;
}

function generatedHelpKey(userId: string, requestId: string) {
  return `${GENERATED_HELP_KEY_PREFIX}.${userId}.${requestId}`;
}

function savedHelpKey(userId: string) {
  return `${SAVED_HELP_KEY_PREFIX}.${userId}`;
}

function isSavedHelpResult(value: unknown): value is SavedCoachHelpResult {
  return Boolean(value && typeof value === "object" && "id" in value && "result" in value && "createdAt" in value);
}

function logLocalResourceError(operation: string, error: unknown) {
  if (!__DEV__) return;
  console.info("[CoachResources] local storage unavailable", {
    operation,
    code: typeof error === "object" && error && "code" in error ? String(error.code) : "unknown",
  });
}
