import AsyncStorage from "@react-native-async-storage/async-storage";
import { httpsCallable } from "firebase/functions";

import { FEATURE_FLAGS } from "@/config/featureFlags";
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
  CoachAiFeedbackInput,
  CoachProTip,
  CoachResourceLocale,
  LocalizedText,
  SavedCoachHelpResult,
} from "@/types/coachResources";
import { CoachAiRequestError, classifyCoachAiRequestError } from "@/utils/coachAiErrors";

const CHECKLIST_KEY_PREFIX = "sidelineSocial.coachChecklistProgress.v1";
const GENERATED_HELP_KEY_PREFIX = "sidelineSocial.coachGeneratedHelp.v1";
const SAVED_HELP_KEY_PREFIX = "sidelineSocial.coachSavedHelp.v1";
const PLACEHOLDER_PATTERN = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;
const COACH_AI_DISCLOSURE_KEY_PREFIX = "sidelineSocial.coachAiDisclosure.v1";
const COACH_HELP_RESULT_TYPES = new Set<CoachHelpResult["resultType"]>([
  "practice_plan", "message", "talking_points", "step_by_step", "checklist",
]);
const savedHelpMutationQueues = new Map<string, Promise<void>>();

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
  if (!FEATURE_FLAGS.coachAiEnabled) throw new CoachAiRequestError("access");
  const callable = httpsCallable<CoachHelpRequest, CoachHelpResult>(functions, "generateCoachResourceHelp", { timeout: 65_000 });
  try {
    return (await callable(request)).data;
  } catch (error) {
    throw classifyCoachAiRequestError(error);
  }
}

export async function submitCoachAiFeedback(input: CoachAiFeedbackInput) {
  if (!FEATURE_FLAGS.coachAiEnabled) throw new CoachAiRequestError("access");
  const callable = httpsCallable<CoachAiFeedbackInput, {
    moderationReceiptNumber: string | null;
    saved: true;
    reviewStatus: "received" | "needs_review";
  }>(
    functions,
    "submitCoachAiFeedback",
    { timeout: 20_000 },
  );
  return (await callable(input)).data;
}

export async function hasAcceptedCoachAiDisclosure(userId: string) {
  if (!userId) return false;
  return (await AsyncStorage.getItem(coachAiDisclosureKey(userId))) === "accepted";
}

export async function acceptCoachAiDisclosure(userId: string) {
  if (!userId) throw new Error("auth_required");
  await AsyncStorage.setItem(coachAiDisclosureKey(userId), "accepted");
}

export async function cacheGeneratedCoachHelpResult(userId: string, requestId: string, result: CoachHelpResult) {
  if (!userId) throw new Error("auth_required");
  await AsyncStorage.setItem(generatedHelpKey(userId, requestId), JSON.stringify(result));
}

export async function getCachedCoachHelpResult(userId: string, requestId: string): Promise<CoachHelpResult | null> {
  if (!userId || !requestId) return null;
  try {
    const raw = await AsyncStorage.getItem(generatedHelpKey(userId, requestId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCoachHelpResult(parsed) ? parsed : null;
  } catch (error) {
    logLocalResourceError("read-generated-help", error);
    return null;
  }
}

export async function saveCoachHelpResult(userId: string, requestId: string, result: CoachHelpResult) {
  if (!userId) throw new Error("auth_required");
  return enqueueSavedHelpMutation(userId, async () => {
    const current = await readSavedCoachHelpResults(userId);
    const entry: SavedCoachHelpResult = { id: requestId, result, createdAt: new Date().toISOString() };
    const next = [entry, ...current.filter((item) => item.id !== requestId)].slice(0, 25);
    await AsyncStorage.setItem(savedHelpKey(userId), JSON.stringify(next));
    return entry;
  });
}

export async function getSavedCoachHelpResults(userId: string): Promise<SavedCoachHelpResult[]> {
  if (!userId) return [];
  try {
    return await readSavedCoachHelpResults(userId);
  } catch (error) {
    logLocalResourceError("read-saved-help", error);
    return [];
  }
}

export async function deleteCoachHelpResult(userId: string, requestId: string) {
  if (!userId) throw new Error("auth_required");
  await enqueueSavedHelpMutation(userId, async () => {
    const next = (await readSavedCoachHelpResults(userId)).filter((item) => item.id !== requestId);
    await AsyncStorage.removeItem(generatedHelpKey(userId, requestId));
    await AsyncStorage.setItem(savedHelpKey(userId), JSON.stringify(next));
  });
}

function enqueueSavedHelpMutation<T>(userId: string, mutation: () => Promise<T>) {
  const previous = savedHelpMutationQueues.get(userId) ?? Promise.resolve();
  const operation = previous.then(mutation);
  const tail = operation.then(() => undefined, () => undefined);
  savedHelpMutationQueues.set(userId, tail);
  void tail.then(() => {
    if (savedHelpMutationQueues.get(userId) === tail) savedHelpMutationQueues.delete(userId);
  });
  return operation;
}

async function readSavedCoachHelpResults(userId: string): Promise<SavedCoachHelpResult[]> {
  const raw = await AsyncStorage.getItem(savedHelpKey(userId));
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(isSavedHelpResult)) {
    throw new Error("invalid_saved_coach_help");
  }
  return parsed;
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

function coachAiDisclosureKey(userId: string) {
  return `${COACH_AI_DISCLOSURE_KEY_PREFIX}.${userId}`;
}

function isSavedHelpResult(value: unknown): value is SavedCoachHelpResult {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SavedCoachHelpResult>;
  return typeof entry.id === "string"
    && entry.id.length >= 8
    && entry.id.length <= 128
    && typeof entry.createdAt === "string"
    && Number.isFinite(Date.parse(entry.createdAt))
    && isCoachHelpResult(entry.result);
}

function isCoachHelpResult(value: unknown): value is CoachHelpResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<CoachHelpResult>;
  return typeof result.resultType === "string"
    && COACH_HELP_RESULT_TYPES.has(result.resultType as CoachHelpResult["resultType"])
    && typeof result.title === "string"
    && result.title.length > 0
    && typeof result.canSendAsAnnouncement === "boolean"
    && isOptionalString(result.introduction)
    && isOptionalString(result.body)
    && isOptionalString(result.safetyNotice)
    && isOptionalStringArray(result.phrasesToUse)
    && isOptionalStringArray(result.phrasesToAvoid)
    && (result.sections === undefined || (
      Array.isArray(result.sections)
      && result.sections.every((section) => (
        Boolean(section)
        && typeof section === "object"
        && typeof section.heading === "string"
        && Array.isArray(section.items)
        && section.items.every((item) => typeof item === "string")
      ))
    ));
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isOptionalStringArray(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

function logLocalResourceError(operation: string, error: unknown) {
  if (!__DEV__) return;
  console.info("[CoachResources] local storage unavailable", {
    operation,
    code: typeof error === "object" && error && "code" in error ? String(error.code) : "unknown",
  });
}
