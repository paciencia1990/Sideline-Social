import languageCatalog from '@/functions/src/teamTranslationLanguages.json';

export const TEAM_TRANSLATION_LANGUAGES = languageCatalog.map(([code, name]) => ({ code, name }));
export const GOOGLE_TRANSLATION_INFO_URL = 'https://docs.cloud.google.com/translate/attribution';
export const GOOGLE_TRANSLATION_PRODUCT_URL = 'https://cloud.google.com/translate';
export const isTranslationLanguage = (value: unknown): value is string =>
  typeof value === 'string' && TEAM_TRANSLATION_LANGUAGES.some((language) => language.code === value);
export function translationLanguageForLocale(locale: string) {
  const normalized = locale.replace(/_/g, '-');
  if (/^zh-(TW|HK|MO|Hant)(-|$)/i.test(normalized)) return 'zh-TW';
  if (/^zh(-|$)/i.test(normalized)) return 'zh-CN';
  const language = normalized.split('-')[0].toLowerCase();
  const alias = language === 'fil' ? 'tl' : language === 'nb' || language === 'nn' ? 'no' : language === 'iw' ? 'he' : language;
  return isTranslationLanguage(alias) ? alias : null;
}
export function announcementTranslationText(title: string, body: string) {
  return [title, body].filter((text) => text.trim()).join('\n\n');
}
export function translationErrorKey(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === 'functions/resource-exhausted') return 'messageTranslation.limit';
  if (code === 'functions/permission-denied' || code === 'functions/unauthenticated' || code === 'functions/failed-precondition') return 'messageTranslation.messageUnavailable';
  return 'messageTranslation.error';
}
