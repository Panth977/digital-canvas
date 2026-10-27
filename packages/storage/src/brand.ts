/**
 * The Brand Kit: logos, colour palettes and text styles shared by every design.
 *
 * It is one small JSON file (`brand.json`) next to the designs — in Drive it is
 * `Digital Canvas/brand.json` and the logos live in `Digital Canvas/assets/`
 * like any other asset (content-hash names). Local stores keep the same JSON.
 */

export const BRAND_FORMAT = 'digital-canvas-brand';

export interface BrandPalette {
  id: string;
  name: string;
  /** `#rrggbb` colours. */
  colors: string[];
}

export type BrandRole = 'heading' | 'subheading' | 'body';

export interface BrandFont {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  uppercase: boolean;
  letterSpacing: number;
  color?: string;
}

export interface BrandLogo {
  id: string;
  /** Asset id (content hash, e.g. `0a1b…​.png`). */
  asset: string;
  mime: string;
  name: string;
  width?: number;
  height?: number;
}

export interface BrandKit {
  format: typeof BRAND_FORMAT;
  version: 1;
  name: string;
  palettes: BrandPalette[];
  fonts: Record<BrandRole, BrandFont | null>;
  logos: BrandLogo[];
  updatedAt: string;
}

/** What a store hands back: the kit and the logo bytes it has. */
export interface BrandData {
  kit: BrandKit;
  assets: Map<string, Uint8Array>;
}

/** Stores that can keep a brand kit (every built-in store can). */
export interface BrandStore {
  loadBrand(): Promise<BrandData | null>;
  saveBrand(data: BrandData): Promise<void>;
}

export function isBrandStore(s: object): s is BrandStore {
  return typeof (s as Partial<BrandStore>).loadBrand === 'function' && typeof (s as Partial<BrandStore>).saveBrand === 'function';
}

export const BRAND_ROLES: BrandRole[] = ['heading', 'subheading', 'body'];

export function emptyBrand(name = 'Brand Kit'): BrandKit {
  return { format: BRAND_FORMAT, version: 1, name, palettes: [], fonts: { heading: null, subheading: null, body: null }, logos: [], updatedAt: new Date(0).toISOString() };
}

const HEX = /^#[0-9a-f]{6}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** `#abc`, `#AABBCC`, `aabbcc` → `#aabbcc`; anything else → null. */
export function normalizeHex(c: unknown): string | null {
  if (typeof c !== 'string') return null;
  let s = c.trim().toLowerCase();
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  if (/^#[0-9a-f]{8}$/.test(s)) s = s.slice(0, 7);
  return HEX.test(s) ? s : null;
}

function parseFont(v: unknown): BrandFont | null {
  if (!isObj(v) || typeof v.fontFamily !== 'string' || !v.fontFamily.trim()) return null;
  const color = normalizeHex(v.color);
  return {
    fontFamily: v.fontFamily.trim(),
    fontSize: Math.max(4, Math.min(800, num(v.fontSize, 32))),
    bold: v.bold === true,
    italic: v.italic === true,
    uppercase: v.uppercase === true,
    letterSpacing: num(v.letterSpacing, 0),
    ...(color ? { color } : {}),
  };
}

/** Read a `brand.json` leniently: unknown or broken parts are dropped, never fatal. */
export function parseBrand(input: unknown): BrandKit {
  const kit = emptyBrand();
  if (!isObj(input)) return kit;
  if (input.format !== undefined && input.format !== BRAND_FORMAT) throw new Error('not a Digital Canvas brand kit');
  kit.name = str(input.name, kit.name).slice(0, 80) || kit.name;
  kit.updatedAt = str(input.updatedAt, kit.updatedAt);
  if (Array.isArray(input.palettes)) {
    kit.palettes = input.palettes.filter(isObj).map((p, i) => ({
      id: str(p.id) || `pal${i + 1}`,
      name: str(p.name, `Palette ${i + 1}`),
      colors: (Array.isArray(p.colors) ? p.colors : []).map(normalizeHex).filter((c): c is string => !!c).slice(0, 64),
    }));
  }
  if (isObj(input.fonts)) for (const r of BRAND_ROLES) kit.fonts[r] = parseFont(input.fonts[r]);
  if (Array.isArray(input.logos)) {
    kit.logos = input.logos.filter(isObj).filter((l) => typeof l.asset === 'string' && typeof l.mime === 'string').map((l, i) => ({
      id: str(l.id) || `logo${i + 1}`,
      asset: l.asset as string,
      mime: l.mime as string,
      name: str(l.name, 'Logo'),
      ...(typeof l.width === 'number' ? { width: l.width } : {}),
      ...(typeof l.height === 'number' ? { height: l.height } : {}),
    }));
  }
  return kit;
}

/** Every brand colour, in order, without repeats. */
export function brandColors(kit: BrandKit): string[] {
  return [...new Set(kit.palettes.flatMap((p) => p.colors))];
}

export function brandJson(kit: BrandKit): string {
  return JSON.stringify(kit, null, 2);
}

/** Only the logo bytes the kit still uses. */
export function usedBrandAssets(data: BrandData): Map<string, Uint8Array> {
  const keep = new Set(data.kit.logos.map((l) => l.asset));
  return new Map([...data.assets].filter(([id]) => keep.has(id)));
}

/** A brand kit kept in memory (tests, and stores without a place for it). */
export class MemoryBrand implements BrandStore {
  private data: BrandData | null = null;
  async loadBrand(): Promise<BrandData | null> {
    return this.data && { kit: structuredClone(this.data.kit), assets: new Map(this.data.assets) };
  }
  async saveBrand(data: BrandData): Promise<void> {
    this.data = { kit: structuredClone(data.kit), assets: usedBrandAssets(data) };
  }
}
