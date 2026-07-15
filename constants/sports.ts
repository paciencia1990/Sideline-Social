export const SQUAD_SPORT_IDS = [
  "baseball",
  "softball",
  "basketball",
  "soccer",
  "football",
  "volleyball",
  "swimming",
  "lacrosse",
  "hockey",
  "tennis",
  "track-field",
  "cheer",
  "gymnastics",
  "dance",
  "other",
] as const;

export type SquadSportId = (typeof SQUAD_SPORT_IDS)[number];

export type SquadSportOption = {
  id: SquadSportId;
  englishName: string;
  emoji: string;
};

export const SQUAD_SPORTS: SquadSportOption[] = [
  { id: "baseball", englishName: "Baseball", emoji: "⚾" },
  { id: "softball", englishName: "Softball", emoji: "🥎" },
  { id: "basketball", englishName: "Basketball", emoji: "🏀" },
  { id: "soccer", englishName: "Soccer", emoji: "⚽" },
  { id: "football", englishName: "Football", emoji: "🏈" },
  { id: "volleyball", englishName: "Volleyball", emoji: "🏐" },
  { id: "swimming", englishName: "Swimming", emoji: "🏊" },
  { id: "lacrosse", englishName: "Lacrosse", emoji: "🥍" },
  { id: "hockey", englishName: "Hockey", emoji: "🏒" },
  { id: "tennis", englishName: "Tennis", emoji: "🎾" },
  { id: "track-field", englishName: "Track & Field", emoji: "🏃" },
  { id: "cheer", englishName: "Cheer", emoji: "📣" },
  { id: "gymnastics", englishName: "Gymnastics", emoji: "🤸" },
  { id: "dance", englishName: "Dance", emoji: "💃" },
  { id: "other", englishName: "Other", emoji: "🏅" },
];

const SPORT_BY_ID = new Map(SQUAD_SPORTS.map((sport) => [sport.id, sport]));
const LEGACY_ALIASES = new Map<string, SquadSportId>([
  ["baseball", "baseball"],
  ["softball", "softball"],
  ["basketball", "basketball"],
  ["soccer", "soccer"],
  ["football", "football"],
  ["volleyball", "volleyball"],
  ["swimming", "swimming"],
  ["lacrosse", "lacrosse"],
  ["hockey", "hockey"],
  ["tennis", "tennis"],
  ["trackandfield", "track-field"],
  ["trackfield", "track-field"],
  ["track-field", "track-field"],
  ["track & field", "track-field"],
  ["cheer", "cheer"],
  ["cheerleading", "cheer"],
  ["gymnastics", "gymnastics"],
  ["dance", "dance"],
  ["other", "other"],
]);

export function isSquadSportId(value: unknown): value is SquadSportId {
  return typeof value === "string" && SQUAD_SPORT_IDS.includes(value as SquadSportId);
}

export function normalizeSquadSportId(value: unknown): SquadSportId {
  if (isSquadSportId(value)) return value;
  if (typeof value !== "string") return "other";
  const normalized = value.trim().toLocaleLowerCase().replace(/[_\s]+/g, " ");
  return LEGACY_ALIASES.get(normalized) ?? LEGACY_ALIASES.get(normalized.replace(/\s+/g, "")) ?? "other";
}

export function getSquadSportOption(value: unknown): SquadSportOption {
  return SPORT_BY_ID.get(normalizeSquadSportId(value)) ?? SPORT_BY_ID.get("other")!;
}

export function getSquadSportTranslationKey(value: unknown): string {
  return `sports.labels.${normalizeSquadSportId(value)}`;
}
