import { assetId, brandColors, emptyBrand, isBrandStore, type BrandData, type BrandFont, type BrandKit, type BrandLogo, type BrandRole, type ProjectStore } from '@digital-canvas/storage';
import { addElements, newId, text, type TextElement } from '@digital-canvas/scene';
import type { EditorState } from './editor.svelte.ts';
import { library } from './library.svelte.ts';
import { fetchFonts } from './templates.ts';

/**
 * The Brand Kit in the editor: loaded from the current store (Drive:
 * `Digital Canvas/brand.json`; signed out: this browser or the chosen folder)
 * and saved back on every change.
 */
class Brand {
  kit = $state.raw<BrandKit>(emptyBrand());
  /** Logo bytes by asset id. */
  assets = $state.raw(new Map<string, Uint8Array>());
  status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  error = $state('');
  saving = $state(false);
  private loadedFrom: ProjectStore | null = null;

  get colors(): string[] {
    return brandColors(this.kit);
  }

  get empty(): boolean {
    const k = this.kit;
    return !k.palettes.some((p) => p.colors.length) && !k.logos.length && !Object.values(k.fonts).some(Boolean);
  }

  /** Load the kit of the current store (once per store). */
  async load(store: ProjectStore = library.store, force = false): Promise<void> {
    if (!force && this.loadedFrom === store && this.status !== 'error') return;
    this.loadedFrom = store;
    this.status = 'loading';
    this.error = '';
    try {
      const data = isBrandStore(store) ? await store.loadBrand() : null;
      if (this.loadedFrom !== store) return;
      this.kit = data?.kit ?? emptyBrand();
      this.assets = data?.assets ?? new Map();
      this.status = 'ready';
    } catch (e) {
      this.status = 'error';
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  private async save(): Promise<void> {
    const store = this.loadedFrom ?? library.store;
    if (!isBrandStore(store)) return;
    this.saving = true;
    try {
      await store.saveBrand({ kit: this.kit, assets: this.assets } satisfies BrandData);
      this.error = '';
    } catch (e) {
      this.error = `Couldn't save the brand kit: ${e instanceof Error ? e.message : e}`;
    } finally {
      this.saving = false;
    }
  }

  async update(fn: (k: BrandKit) => BrandKit): Promise<void> {
    this.kit = { ...fn(this.kit), updatedAt: new Date().toISOString() };
    await this.save();
  }

  rename(name: string): Promise<void> {
    return this.update((k) => ({ ...k, name: name.trim() || 'Brand Kit' }));
  }

  addPalette(colors: string[] = [], name?: string): Promise<void> {
    return this.update((k) => ({ ...k, palettes: [...k.palettes, { id: newId('pal_'), name: name ?? `Palette ${k.palettes.length + 1}`, colors }] }));
  }

  setPalette(id: string, patch: { name?: string; colors?: string[] }): Promise<void> {
    return this.update((k) => ({ ...k, palettes: k.palettes.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  }

  removePalette(id: string): Promise<void> {
    return this.update((k) => ({ ...k, palettes: k.palettes.filter((p) => p.id !== id) }));
  }

  /** Add colours to the first palette (made when there is none). */
  async addColors(colors: string[]): Promise<void> {
    if (!this.kit.palettes.length) return this.addPalette(colors, 'Brand colours');
    const p = this.kit.palettes[0]!;
    return this.setPalette(p.id, { colors: [...new Set([...p.colors, ...colors])] });
  }

  setFont(role: BrandRole, f: BrandFont | null): Promise<void> {
    return this.update((k) => ({ ...k, fonts: { ...k.fonts, [role]: f } }));
  }

  async addLogo(bytes: Uint8Array, mime: string, name: string): Promise<void> {
    const asset = await assetId(bytes, mime);
    const size = await imageSize(bytes, mime).catch(() => null);
    this.assets = new Map(this.assets).set(asset, bytes);
    const logo: BrandLogo = { id: newId('logo_'), asset, mime, name, ...(size ?? {}) };
    await this.update((k) => ({ ...k, logos: [...k.logos.filter((l) => l.asset !== asset), logo] }));
  }

  removeLogo(id: string): Promise<void> {
    return this.update((k) => ({ ...k, logos: k.logos.filter((l) => l.id !== id) }));
  }
}

async function imageSize(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  const out = { width: bmp.width, height: bmp.height };
  bmp.close();
  return out;
}

export const brand = new Brand();
if (import.meta.env.DEV) (window as unknown as { __brand?: Brand }).__brand = brand;

export const ROLE_LABELS: Record<BrandRole, string> = { heading: 'Heading', subheading: 'Subheading', body: 'Body' };
export const ROLE_SAMPLE: Record<BrandRole, string> = { heading: 'Add a heading', subheading: 'Add a subheading', body: 'Add a little bit of body text' };

/** Put a logo on the page. */
export async function placeLogo(ed: EditorState, logo: BrandLogo): Promise<boolean> {
  const bytes = brand.assets.get(logo.asset);
  if (!bytes) return false;
  if (logo.mime === 'image/svg+xml') return ed.addSvg(new TextDecoder().decode(bytes), logo.name);
  return ed.addPhoto(bytes, logo.mime, logo.name);
}

/** Add a text box in a brand text style (downloading the font first). */
export async function addBrandText(ed: EditorState, role: BrandRole, value = ROLE_SAMPLE[role]): Promise<void> {
  const f = brand.kit.fonts[role];
  if (!f) return;
  const key = `brandtext:${Date.now()}`;
  if (!ed.engine.fonts.families.has(f.fontFamily)) {
    const files = await fetchFonts([f.fontFamily], value);
    if (files.length) await ed.addFonts(files, key);
  }
  const scale = Math.max(0.4, Math.min(3, Math.min(ed.doc.width, ed.doc.height) / 1080));
  let el: TextElement = text(value, { x: 0, y: 0, w: 100, h: 10 }, {
    fontFamily: f.fontFamily, fontSize: Math.round(f.fontSize * scale), bold: f.bold, italic: f.italic, uppercase: f.uppercase, letterSpacing: f.letterSpacing * scale,
    ...(f.color ? { color: f.color } : {}),
  });
  el = { ...el, w: Math.min(ed.renderer.textWidth(el) + 4, ed.doc.width * 0.9) };
  el = { ...el, h: ed.renderer.textHeight(el), x: (ed.doc.width - el.w) / 2 };
  el.y = (ed.doc.height - el.h) / 2;
  ed.commit(addElements(ed.doc, ed.pageId, [el]), key);
  ed.seal();
  ed.select([el.id], ed.pageId);
}

/** Apply a brand text style to the selected text boxes. */
export async function styleSelection(ed: EditorState, role: BrandRole): Promise<void> {
  const f = brand.kit.fonts[role];
  if (!f || !ed.selected.some((e) => e.type === 'text')) return;
  const key = `brandstyle:${Date.now()}`;
  if (!ed.engine.fonts.families.has(f.fontFamily)) {
    const files = await fetchFonts([f.fontFamily], ed.selected.map((e) => (e.type === 'text' ? e.text : '')).join(' '));
    if (files.length) await ed.addFonts(files, key);
  }
  ed.updateTextStyle({ fontFamily: f.fontFamily, bold: f.bold, italic: f.italic, uppercase: f.uppercase, ...(f.color ? { color: f.color } : {}) }, key);
  ed.seal();
  ed.refitText();
}
