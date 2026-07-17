export const COACH_HELP_CATEGORIES = [
  'practice_plan', 'parent_message', 'parent_concern', 'player_behavior', 'discouraged_player',
  'team_culture', 'child_explanation', 'game_day', 'other',
] as const;
export type CoachHelpCategory = typeof COACH_HELP_CATEGORIES[number];
export type CoachHelpLocale = 'en' | 'es';
export type CoachHelpTone = 'warm' | 'direct' | 'encouraging' | 'neutral';
export type ValidatedCoachHelpRequest = {
  category: CoachHelpCategory;
  sport?: string;
  ageGroup?: string;
  situation: string;
  desiredOutcome?: string;
  tone?: CoachHelpTone;
  practiceMinutes?: number;
  playerCount?: number;
  equipment?: string[];
  clientRequestId: string;
  locale: CoachHelpLocale;
};
export type ValidatedCoachHelpResult = {
  resultType: 'practice_plan' | 'message' | 'talking_points' | 'step_by_step' | 'checklist';
  title: string;
  introduction?: string;
  body?: string;
  sections?: Array<{ heading: string; items: string[] }>;
  phrasesToUse?: string[];
  phrasesToAvoid?: string[];
  safetyNotice?: string;
  canSendAsAnnouncement: boolean;
};

const TONES = new Set<CoachHelpTone>(['warm', 'direct', 'encouraging', 'neutral']);
const RESULT_TYPES = new Set<ValidatedCoachHelpResult['resultType']>(['practice_plan', 'message', 'talking_points', 'step_by_step', 'checklist']);
const ANNOUNCEMENT_CATEGORIES = new Set<CoachHelpCategory>(['parent_message', 'team_culture', 'game_day']);
const SENSITIVE_SAFETY_TERMS = [
  'abuse', 'assault', 'suicide', 'self-harm', 'weapon', 'threat', 'immediate danger', 'missing child',
  'severe injury', 'unconscious', 'can\'t breathe', 'cannot breathe', 'emergency',
  'abuso', 'agresión', 'suicidio', 'autolesión', 'arma', 'amenaza', 'peligro inmediato',
  'menor desaparecido', 'lesión grave', 'inconsciente', 'no puede respirar', 'emergencia',
];

export function validateCoachHelpRequest(value: unknown): ValidatedCoachHelpRequest {
  if (!value || typeof value !== 'object') throw new Error('invalid_request');
  const data = value as Record<string, unknown>;
  const category = readEnum(data.category, COACH_HELP_CATEGORIES, 'invalid_category');
  const locale = readEnum(data.locale, ['en', 'es'] as const, 'invalid_locale');
  const situation = readRequiredString(data.situation, 10, 1500, 'invalid_situation');
  const clientRequestId = readRequiredString(data.clientRequestId, 8, 80, 'invalid_request_id');
  if (!/^[A-Za-z0-9_-]+$/.test(clientRequestId)) throw new Error('invalid_request_id');
  const tone = data.tone == null ? undefined : readEnum(data.tone, ['warm', 'direct', 'encouraging', 'neutral'] as const, 'invalid_tone');
  const practiceMinutes = readOptionalInteger(data.practiceMinutes, 15, 240, 'invalid_practice_minutes');
  const playerCount = readOptionalInteger(data.playerCount, 1, 100, 'invalid_player_count');
  const equipment = readOptionalStringArray(data.equipment, 12, 80, 'invalid_equipment');
  return {
    category,
    locale,
    situation,
    clientRequestId,
    ...(tone ? { tone } : {}),
    ...readOptionalField(data, 'sport', 80),
    ...readOptionalField(data, 'ageGroup', 80),
    ...readOptionalField(data, 'desiredOutcome', 500),
    ...(practiceMinutes == null ? {} : { practiceMinutes }),
    ...(playerCount == null ? {} : { playerCount }),
    ...(equipment ? { equipment } : {}),
  };
}

export function isCoachHelpSafetySensitive(request: ValidatedCoachHelpRequest) {
  const text = `${request.situation} ${request.desiredOutcome ?? ''}`.toLowerCase();
  return SENSITIVE_SAFETY_TERMS.some((term) => text.includes(term));
}

export function createCoachHelpSafetyResult(locale: CoachHelpLocale): ValidatedCoachHelpResult {
  if (locale === 'es') {
    return {
      resultType: 'step_by_step',
      title: 'Prioriza la seguridad y sigue el proceso aprobado',
      introduction: 'Esta situación necesita apoyo humano y los procedimientos oficiales, no orientación generada por IA.',
      sections: [{ heading: 'Próximos pasos', items: [
        'Si existe peligro inmediato, contacta a los servicios de emergencia correspondientes.',
        'Sigue de inmediato el procedimiento de seguridad o protección de menores de la liga.',
        'Informa a la persona responsable designada y conserva solo la documentación requerida por la liga.',
      ] }],
      safetyNotice: 'No uses esta herramienta como sustituto de servicios de emergencia, profesionales médicos, autoridades o procedimientos de protección de menores.',
      canSendAsAnnouncement: false,
    };
  }
  return {
    resultType: 'step_by_step',
    title: 'Prioritize safety and follow the approved process',
    introduction: 'This situation needs qualified human support and official procedures, not AI-generated coaching guidance.',
    sections: [{ heading: 'Next steps', items: [
      'If anyone is in immediate danger, contact the appropriate emergency services.',
      'Follow your league safeguarding or emergency procedure immediately.',
      'Notify the designated responsible person and retain only documentation required by league policy.',
    ] }],
    safetyNotice: 'Do not use this tool as a substitute for emergency services, medical professionals, authorities, or safeguarding procedures.',
    canSendAsAnnouncement: false,
  };
}

export function validateCoachHelpResult(value: unknown, category: CoachHelpCategory): ValidatedCoachHelpResult {
  if (!value || typeof value !== 'object') throw new Error('invalid_provider_result');
  const data = value as Record<string, unknown>;
  const resultType = readString(data.resultType, 40) as ValidatedCoachHelpResult['resultType'];
  if (!RESULT_TYPES.has(resultType)) throw new Error('invalid_provider_result');
  const title = readRequiredString(data.title, 1, 160, 'invalid_provider_result');
  const sections = readSections(data.sections);
  const introduction = readOptionalString(data.introduction, 1000);
  const body = readOptionalString(data.body, 5000);
  if (!introduction && !body && !sections?.length) throw new Error('invalid_provider_result');
  return {
    resultType,
    title,
    ...(introduction ? { introduction } : {}),
    ...(body ? { body } : {}),
    ...(sections?.length ? { sections } : {}),
    ...readOptionalListField(data, 'phrasesToUse', 8, 300),
    ...readOptionalListField(data, 'phrasesToAvoid', 8, 300),
    ...readOptionalField(data, 'safetyNotice', 800),
    canSendAsAnnouncement: data.canSendAsAnnouncement === true && ANNOUNCEMENT_CATEGORIES.has(category),
  };
}

function readSections(value: unknown) {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 8) throw new Error('invalid_provider_result');
  return value.map((section) => {
    if (!section || typeof section !== 'object') throw new Error('invalid_provider_result');
    const data = section as Record<string, unknown>;
    return {
      heading: readRequiredString(data.heading, 1, 160, 'invalid_provider_result'),
      items: readStringArray(data.items, 12, 500, 'invalid_provider_result'),
    };
  });
}

function readOptionalField(data: Record<string, unknown>, key: string, max: number) {
  const value = readOptionalString(data[key], max);
  return value ? { [key]: value } : {};
}

function readOptionalListField(data: Record<string, unknown>, key: 'phrasesToUse' | 'phrasesToAvoid', maxItems: number, maxLength: number) {
  if (data[key] == null) return {};
  const value = readStringArray(data[key], maxItems, maxLength, 'invalid_provider_result');
  return value.length ? { [key]: value } : {};
}

function readRequiredString(value: unknown, min: number, max: number, code: string) {
  const result = readString(value, max);
  if (result.length < min) throw new Error(code);
  return result;
}

function readOptionalString(value: unknown, max: number) {
  if (value == null) return undefined;
  const result = readString(value, max);
  return result || undefined;
}

function readString(value: unknown, max: number) {
  if (typeof value !== 'string') return '';
  const result = value.trim();
  if (result.length > max) throw new Error('value_too_long');
  return result;
}

function readOptionalInteger(value: unknown, min: number, max: number, code: string) {
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(code);
  return value;
}

function readOptionalStringArray(value: unknown, maxItems: number, maxLength: number, code: string) {
  if (value == null) return undefined;
  return readStringArray(value, maxItems, maxLength, code);
}

function readStringArray(value: unknown, maxItems: number, maxLength: number, code: string) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(code);
  return value.map((entry) => {
    const text = readString(entry, maxLength);
    if (!text) throw new Error(code);
    return text;
  });
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], code: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(code);
  return value as T;
}
