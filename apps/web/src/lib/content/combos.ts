/**
 * Font combinations for the Text panel: plain heading + body pairs from
 * Fonttrio (MIT, https://www.fonttrio.xyz; data/fontpairs.json, built by
 * tools/catalogs/build.ts). Sizes follow Fonttrio's own type scale; each line
 * shows its font's name, with no added colour or decoration. All fonts are on
 * Google Fonts, served by Fontsource and embedded in the design when used.
 */
import PAIRS from './data/fontpairs.json';

export interface ComboLine {
  text: string;
  family: string;
  /** px on a 1080 px page. */
  size: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  /** Extra letter spacing, px on a 1080 px page. */
  spacing?: number;
  upper?: boolean;
}

export interface Combo {
  id: string;
  name: string;
  tags: string;
  /** Why the pair works, in Fonttrio's words. */
  description: string;
  lines: ComboLine[];
}

/** px per rem of Fonttrio's scale, on a 1080 px page. */
const REM = 32;

export const COMBOS: Combo[] = PAIRS.map((p) => ({
  id: p.id, name: p.name, tags: p.tags, description: p.description,
  lines: [
    { text: p.heading, family: p.heading, size: Math.round(p.headingRem * REM), bold: p.headingBold },
    { text: p.body, family: p.body, size: Math.round(p.bodyRem * REM) },
  ],
}));

/** Popular fonts listed first in the font library (Canva-like picks). */
export const POPULAR_FONTS = ['Montserrat', 'Open Sans', 'Playfair Display', 'Poppins', 'Lato', 'Roboto', 'Bebas Neue', 'Oswald', 'Raleway', 'Great Vibes', 'Pacifico', 'Lobster', 'Anton', 'Dancing Script', 'Merriweather', 'Archivo Black'];

/** Fontsource id of a Google family ("Playfair Display" → "playfair-display"). */
export const fontId = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Combos matching search words (name, tags or font names). */
export function findCombos(query: string): Combo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return COMBOS;
  return COMBOS.filter((c) => {
    const hay = `${c.name} ${c.tags} ${c.lines.map((l) => `${l.family} ${l.text}`).join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
