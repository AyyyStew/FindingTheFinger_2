import type { TaxonomyLabel } from "../api/types";

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export interface TaxonomyColor {
  solid: string;
  dim: string;
}

export interface TaxonomyColorItem extends TaxonomyColor {
  kind: "corpus" | "taxonomy" | "fallback";
  label: string;
  hsl: HSL;
  taxonomy?: TaxonomyLabel;
}

const FALLBACK: HSL = { h: 0, s: 0, l: 43 };
const FALLBACK_LABEL = "Uncategorized";

const ROOT_PALETTE: Record<string, HSL> = {
  abrahamic: { h: 214, s: 55, l: 46 },
  "indic (dharmic)": { h: 38, s: 76, l: 45 },
  "east asian": { h: 195, s: 48, l: 38 },
  persian: { h: 348, s: 58, l: 46 },
  indigenous: { h: 164, s: 32, l: 38 },
  "ancient / historical": { h: 24, s: 24, l: 50 },
  "new religious movements": { h: 316, s: 42, l: 45 },
  "other (sacred)": { h: 42, s: 48, l: 43 },
  "non sacred": { h: 207, s: 16, l: 38 },
};

const NODE_PALETTE: Record<string, HSL> = {
  judaism: { h: 211, s: 62, l: 47 },
  christianity: { h: 229, s: 52, l: 50 },
  islam: { h: 174, s: 52, l: 38 },

  sikhism: { h: 28, s: 82, l: 46 },
  buddhism: { h: 47, s: 78, l: 45 },
  jainism: { h: 83, s: 42, l: 39 },
  hinduism: { h: 16, s: 70, l: 48 },

  taoism: { h: 195, s: 52, l: 36 },
  confucianism: { h: 210, s: 44, l: 40 },
  shinto: { h: 5, s: 55, l: 47 },
  zen: { h: 180, s: 38, l: 37 },

  zoroastrianism: { h: 348, s: 62, l: 44 },

  "north american": { h: 172, s: 34, l: 38 },
  mesoamerican: { h: 135, s: 35, l: 39 },
  "south american": { h: 93, s: 38, l: 38 },
  african: { h: 24, s: 43, l: 40 },
  oceanian: { h: 196, s: 43, l: 40 },
  "aboriginal australian": { h: 9, s: 45, l: 42 },

  greek: { h: 260, s: 38, l: 49 },
  roman: { h: 286, s: 32, l: 46 },
  egyptian: { h: 50, s: 52, l: 42 },
  mesopotamian: { h: 336, s: 45, l: 43 },
  "norse / germanic": { h: 204, s: 38, l: 42 },
  celtic: { h: 142, s: 35, l: 39 },

  scientology: { h: 309, s: 43, l: 45 },
  "bahá'í": { h: 326, s: 43, l: 45 },
  bahai: { h: 326, s: 43, l: 45 },
  "neo-paganism / wicca": { h: 283, s: 36, l: 44 },
  "other modern movements": { h: 336, s: 35, l: 44 },

  philosophy: { h: 216, s: 18, l: 39 },
  scientific: { h: 188, s: 22, l: 38 },
  literature: { h: 258, s: 18, l: 42 },
  plays: { h: 300, s: 18, l: 41 },
  speeches: { h: 226, s: 22, l: 42 },
  historical: { h: 25, s: 24, l: 39 },
};

const CORPUS_OVERRIDES: Record<string, HSL> = {
  "old testament": { h: 207, s: 50, l: 45 },
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  }
  return h;
}

function hslStr({ h, s, l }: HSL): string {
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

function hslDimStr({ h, s, l }: HSL): string {
  return `hsla(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%, 0.15)`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function colorItem(
  kind: TaxonomyColorItem["kind"],
  label: string,
  hsl: HSL,
  taxonomy?: TaxonomyLabel,
): TaxonomyColorItem {
  return {
    kind,
    label,
    solid: hslStr(hsl),
    dim: hslDimStr(hsl),
    hsl: { ...hsl },
    ...(taxonomy ? { taxonomy } : {}),
  };
}

function sortedTaxonomyChain(
  chain: TaxonomyLabel[] | null | undefined,
): TaxonomyLabel[] {
  if (!chain || !Array.isArray(chain)) return [];
  return chain
    .map((taxonomy, index) => ({ taxonomy, index }))
    .sort((a, b) => {
      if (a.taxonomy.level !== b.taxonomy.level) {
        return a.taxonomy.level - b.taxonomy.level;
      }
      return a.index - b.index;
    })
    .map(({ taxonomy }) => taxonomy);
}

function paletteForTaxonomy(taxonomy: TaxonomyLabel): HSL | null {
  const key = normalizeName(taxonomy.name);
  return NODE_PALETTE[key] ?? ROOT_PALETTE[key] ?? null;
}

function fallbackVariant(label: string, base: HSL): HSL {
  const h = nameHash(normalizeName(label));
  return {
    h: (base.h + ((h % 25) - 12) + 360) % 360,
    s: clamp(base.s + (((h >> 5) % 11) - 5), 24, 86),
    l: clamp(base.l + (((h >> 9) % 15) - 7), 28, 68),
  };
}

function corpusVariant(label: string, base: HSL): HSL {
  const h = nameHash(normalizeName(label));
  return {
    h: (base.h + ((h % 11) - 5) + 360) % 360,
    s: clamp(base.s + (((h >> 5) % 13) - 6), 28, 90),
    l: clamp(base.l + (((h >> 9) % 21) - 10), 28, 68),
  };
}

function translationVariant(label: string, base: HSL): HSL {
  const h = nameHash(normalizeName(label));
  return {
    h: (base.h + ((h % 7) - 3) + 360) % 360,
    s: clamp(base.s + (((h >> 5) % 7) - 3), 28, 92),
    l: clamp(base.l + (((h >> 8) % 13) - 6), 26, 74),
  };
}

function taxonomyItem(taxonomy: TaxonomyLabel): TaxonomyColorItem {
  const explicit = paletteForTaxonomy(taxonomy);
  const hsl = explicit ?? fallbackVariant(taxonomy.name, FALLBACK);
  return colorItem("taxonomy", taxonomy.name, hsl, taxonomy);
}

/**
 * Returns the full color ancestry for a corpus/result in leaf-to-root order.
 *
 * With a corpus name, the first item is the corpus display color. It is
 * followed by taxonomy colors from deepest known node back to root.
 */
export function getTaxonomyColors(
  chain: TaxonomyLabel[] | null | undefined,
  corpusName?: string | null,
): TaxonomyColorItem[] {
  const sorted = sortedTaxonomyChain(chain);

  if (sorted.length === 0) {
    return [colorItem("fallback", FALLBACK_LABEL, FALLBACK)];
  }

  const taxonomyItems = sorted
    .map((taxonomy, index) => ({ taxonomy, index }))
    .sort((a, b) => {
      if (a.taxonomy.level !== b.taxonomy.level) {
        return b.taxonomy.level - a.taxonomy.level;
      }
      return a.index - b.index;
    })
    .map(({ taxonomy }) => taxonomy)
    .map((taxonomy) => taxonomyItem(taxonomy));

  const corpusLabel = corpusName?.trim();
  if (!corpusLabel) return taxonomyItems;

  const override = CORPUS_OVERRIDES[normalizeName(corpusLabel)];
  const base = taxonomyItems[0]?.hsl ?? FALLBACK;
  const hsl = override ?? corpusVariant(corpusLabel, base);
  return [colorItem("corpus", corpusLabel, hsl), ...taxonomyItems];
}

/**
 * Compatibility helper for callers that only need a taxonomy color.
 * Returns the deepest taxonomy color, not a corpus variant.
 */
export function getTaxonomyColor(
  chain: TaxonomyLabel[] | null | undefined,
): TaxonomyColor {
  const item = getTaxonomyColors(chain).find(
    (color) => color.kind === "taxonomy",
  );
  return item ?? colorItem("fallback", FALLBACK_LABEL, FALLBACK);
}

/**
 * Compatibility helper for callers that need the primary corpus display color.
 */
export function getCorpusColor(
  chain: TaxonomyLabel[] | null | undefined,
  corpusName: string | null | undefined,
): TaxonomyColor {
  return getTaxonomyColors(chain, corpusName)[0];
}

/**
 * Deterministic color variant for translations of the same corpus.
 * Keeps family resemblance to the corpus color while separating versions.
 */
export function getTranslationColor(
  chain: TaxonomyLabel[] | null | undefined,
  corpusName: string | null | undefined,
  translationKey: string,
): TaxonomyColor {
  const base = getTaxonomyColors(chain, corpusName)[0]?.hsl ?? FALLBACK;
  const variant = translationVariant(translationKey, base);
  return {
    solid: hslStr(variant),
    dim: hslDimStr(variant),
  };
}
