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

const INTRINSIC_MARKER_PATTERNS: Record<BombChoiceLocale, Record<BombChoiceMarker, RegExp>> = {
  en: {
    solid: /\bsolid\b/iu,
    striped: /\bstriped\b/iu,
    dashed: /\bdashed\b/iu,
    dotted: /\bdotted\b/iu,
    circle: /\bcircle\b/iu,
    square: /\bsquare\b/iu,
    triangle: /\btriangle\b/iu,
    diamond: /\bdiamond\b/iu,
  },
  es: {
    solid: /\bs[oó]lid[oa]s?\b/iu,
    striped: /\brayas?\b/iu,
    dashed: /\bguiones?\b/iu,
    dotted: /\bpuntos?\b/iu,
    circle: /\b(c[ií]rculo|circular(?:es)?)\b/iu,
    square: /\bcuadrad[oa]s?\b/iu,
    triangle: /\b(tri[aá]ngulo|triangular(?:es)?)\b/iu,
    diamond: /\brombos?\b/iu,
  },
};

export function buildBombChoiceDescription({
  label,
  locale,
  marker,
  markerLabel,
}: BombChoiceDescriptionInput) {
  const conciseLabel = label.trim();
  const conciseMarker = markerLabel.trim();
  if (!conciseLabel || !conciseMarker) return conciseLabel;
  if (INTRINSIC_MARKER_PATTERNS[locale][marker].test(conciseLabel)) return conciseLabel;

  const alreadyCompound = locale === "es"
    ? /\scon\s/iu.test(conciseLabel)
    : /\swith\s/iu.test(conciseLabel);
  const connector = locale === "es"
    ? alreadyCompound ? "y" : "con"
    : alreadyCompound ? "and" : "with";
  return `${conciseLabel} ${connector} ${conciseMarker}`;
}
