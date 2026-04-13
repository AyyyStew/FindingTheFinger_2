import type { TaxonomyLabel } from "../api/types";

interface HSL {
  h: number;
  s: number;
  l: number;
}
interface TaxonomyColor {
  solid: string;
  dim: string;
}

// ── Root hues (HSL) ──────────────────────────────────────────────────────────
const ROOT_COLORS: Array<{ keywords: string[]; hsl: HSL }> = [
  { keywords: ["abrahamic"], hsl: { h: 220, s: 51, l: 45 } },
  { keywords: ["indic", "dharmic"], hsl: { h: 36, s: 95, l: 43 } },
  { keywords: ["east asian"], hsl: { h: 146, s: 50, l: 36 } },
  { keywords: ["persian", "zoroast", "mandae"], hsl: { h: 0, s: 62, l: 49 } },
  {
    keywords: ["indigenous", "native", "tribal"],
    hsl: { h: 24, s: 40, l: 39 },
  },
  {
    keywords: ["ancient", "historic", "egypt", "greek", "roman", "sumer"],
    hsl: { h: 0, s: 44, l: 44 },
  },
  {
    keywords: ["new religious", "latter", "bahai"],
    hsl: { h: 320, s: 44, l: 44 },
  },
  { keywords: ["other sacred", "sacred"], hsl: { h: 43, s: 57, l: 45 } },
  {
    keywords: ["non sacred", "secular", "philos"],
    hsl: { h: 213, s: 14, l: 35 },
  },
];

const FALLBACK: HSL = { h: 0, s: 0, l: 43 };

// ── Tuning knobs ─────────────────────────────────────────────────────────────
//
// Switch to "static" if you want only root-level taxonomy colors and no
// per-subtradition hue/lightness shifts.
const TAXONOMY_COLOR_MODE: "shifted" | "static" = "shifted";

// Level 1: hue shift approximately ±25°
const L1_HUE_RANGE = 51;
const L1_HUE_CENTER = 25;
// Level 2: lightness shift approximately ±12%
const L2_LIGHT_RANGE = 25;
const L2_LIGHT_CENTER = 12;

// Simple deterministic hash of a string → 0..65535
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

/**
 * Given the full taxonomy ancestor chain for a corpus/result,
 * returns a { solid, dim } color pair.
 *
 * Level 0 (root)  → base hue from ROOT_COLORS
 * Level 1         → hue shifted ±15° based on node name hash
 * Level 2         → lightness shifted ±12% based on node name hash
 */
export function getTaxonomyColor(
  chain: TaxonomyLabel[] | null | undefined,
): TaxonomyColor {
  if (!chain || !Array.isArray(chain) || chain.length === 0) {
    return { solid: hslStr(FALLBACK), dim: hslDimStr(FALLBACK) };
  }
  const sorted = chain.slice().sort((a, b) => a.level - b.level);

  const root = sorted.find((t) => t.level === 0);
  if (!root) return { solid: hslStr(FALLBACK), dim: hslDimStr(FALLBACK) };

  const rootLower = root.name.toLowerCase();
  const base = ROOT_COLORS.find((rc) =>
    rc.keywords.some((kw) => rootLower.includes(kw)),
  );
  let hsl: HSL = base ? { ...base.hsl } : { ...FALLBACK };

  if (TAXONOMY_COLOR_MODE === "shifted") {
    // Level 1 → hue shift ±25°
    const l1 = sorted.find((t) => t.level === 1);
    if (l1) {
      const h1 = nameHash(l1.name);
      const shift = (h1 % L1_HUE_RANGE) - L1_HUE_CENTER;
      hsl = { ...hsl, h: (hsl.h + shift + 360) % 360 };
    }

    // Level 2 → lightness shift ±12%
    const l2 = sorted.find((t) => t.level === 2);
    if (l2) {
      const h2 = nameHash(l2.name);
      const shift = (h2 % L2_LIGHT_RANGE) - L2_LIGHT_CENTER;
      hsl = { ...hsl, l: Math.max(22, Math.min(72, hsl.l + shift)) };
    }
  }

  return { solid: hslStr(hsl), dim: hslDimStr(hsl) };
}
