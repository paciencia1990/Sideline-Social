export type BombChoiceLocale = "en" | "es";
export type BombChoiceMarker =
  | "solid"
  | "striped"
  | "dashed"
  | "dotted"
  | "circle"
  | "square"
  | "triangle"
  | "diamond";

type BombChoiceDescriptionInput = {
  label: string;
  locale: BombChoiceLocale;
  marker: BombChoiceMarker;
  markerLabel: string;
};

// Also simplify labels received from the existing generator. Each choice keeps
// its number and opaque answer ID; a second decorative identifier is unnecessary.
const PRIMARY_LABELS: Record<BombChoiceLocale, Record<string, string>> = {
  en: {
    'Red wire with a solid pattern': 'Red',
    'Blue wire with a striped pattern': 'Blue',
    'Yellow wire with a dashed pattern': 'Yellow',
    'Green wire with a dotted pattern': 'Green',
    'Solid panel': 'Solid',
    'Striped panel': 'Striped',
    'Dashed panel': 'Dashed',
    'Dotted panel': 'Dotted',
  },
  es: {
    'Cable rojo con patrón sólido': 'Rojo',
    'Cable azul con patrón de rayas': 'Azul',
    'Cable amarillo con patrón de guiones': 'Amarillo',
    'Cable verde con patrón de puntos': 'Verde',
    'Panel sólido': 'Sólido',
    'Panel de rayas': 'Rayas',
    'Panel de guiones': 'Guiones',
    'Panel de puntos': 'Puntos',
  },
};

export function buildBombChoiceDescription({
  label,
  locale,
}: BombChoiceDescriptionInput) {
  const conciseLabel = label.trim();
  return PRIMARY_LABELS[locale][conciseLabel] ?? conciseLabel;
}
