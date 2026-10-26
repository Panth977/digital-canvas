import {
  History, newId, addElements, addPage, arrange, duplicateElements, duplicatePage, findElement, image, movePage,
  pruneAssets, removeElements, removePage, setTitle, shape, text, updateElements, updatePage,
  type Arrange, type Doc, type Element, type ElementPatch, type Page, type ShapeKind, type TextElement, type TextStyle,
} from '@digital-canvas/scene';
import { Renderer } from '@digital-canvas/render';
import { assetId, type ProjectFile, type ProjectStore } from '@digital-canvas/storage';
import type { Engine } from './engine.ts';
import { isImage } from './files.ts';

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

export const TEXT_PRESETS = {
  heading: { label: 'Add a heading', style: { fontSize: 64, bold: true }, text: 'Add a heading' },
  subheading: { label: 'Add a subheading', style: { fontSize: 36, bold: true }, text: 'Add a subheading' },
  body: { label: 'Add a little bit of body text', style: { fontSize: 22 }, text: 'Add a little bit of body text' },
} satisfies Record<string, { label: string; style: Partial<TextStyle>; text: string }>;

/**
 * Everything the editor knows about the open design. Components read the
 * reactive fields; every change to the document goes through `commit` so it
 * lands in undo history, triggers a redraw and schedules an autosave.
 */
export class EditorState {
  doc = $state.raw<Doc>(null as unknown as Doc);
  selection = $state.raw<string[]>([]);
  pageId = $state('');
  editingTextId = $state<string | null>(null);
  hoverId = $state<string | null>(null);
  saveState = $state<SaveState>('saved');
  saveError = $state('');
  canUndo = $state(false);
  canRedo = $state(false);
  /** Bumped when something outside `doc` changes the picture (an image decoded). */
  frame = $state(0);

  readonly renderer: Renderer;
  readonly assets: Map<string, Uint8Array>;
  private history: History<Doc>;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private clipboard: Element[] = [];

  constructor(readonly engine: Engine, readonly store: ProjectStore, file: ProjectFile) {
    this.renderer = new Renderer(engine.ck, engine.fonts);
    this.assets = new Map(file.assets);
    for (const [id, bytes] of this.assets) this.renderer.setImage(id, bytes);
    this.doc = file.doc;
    this.history = new History(file.doc);
    this.pageId = file.doc.pages[0]!.id;
  }

  // ---- derived ----

  get page(): Page {
    return this.doc.pages.find((p) => p.id === this.pageId) ?? this.doc.pages[0]!;
  }

  get pageIndex(): number {
    return Math.max(0, this.doc.pages.findIndex((p) => p.id === this.pageId));
  }

  get selected(): Element[] {
    const out: Element[] = [];
    for (const id of this.selection) {
      const hit = findElement(this.doc, id);
      if (hit) out.push(hit.element);
    }
    return out;
  }

  // ---- history ----

  /** Apply a new doc. Same `key` as the last commit = same undo step (drags, sliders). */
  commit(next: Doc, key: string | null = null): void {
    if (next === this.doc) return;
    this.history.push(next, key);
    this.doc = next;
    this.syncHistory();
    this.scheduleSave();
  }

  /** End a coalesced change (pointer up, slider release). */
  seal(): void {
    this.history.seal();
  }

  undo(): void {
    const d = this.history.undo();
    if (d) this.restore(d);
  }

  redo(): void {
    const d = this.history.redo();
    if (d) this.restore(d);
  }

  private restore(d: Doc): void {
    this.doc = d;
    this.editingTextId = null;
    this.selection = this.selection.filter((id) => findElement(d, id));
    if (!d.pages.some((p) => p.id === this.pageId)) this.pageId = d.pages[0]!.id;
    this.syncHistory();
    this.scheduleSave();
  }

  private syncHistory(): void {
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
  }

  // ---- selection ----

  select(ids: string[], pageId?: string): void {
    this.selection = ids;
    if (pageId) this.pageId = pageId;
    else if (ids[0]) {
      const hit = findElement(this.doc, ids[0]);
      if (hit) this.pageId = hit.page.id;
    }
    if (this.editingTextId && !ids.includes(this.editingTextId)) this.stopEditing();
  }

  selectAll(): void {
    this.select(this.page.elements.filter((e) => !e.hidden).map((e) => e.id), this.pageId);
  }

  // ---- element edits ----

  update(patch: ElementPatch | ((e: Element) => ElementPatch), key: string | null = null, ids = this.selection): void {
    this.commit(updateElements(this.doc, ids, patch), key);
  }

  /** Change text style; text boxes grow or shrink to fit. */
  updateTextStyle(style: Partial<TextStyle>, key: string | null = null): void {
    this.update((e) => {
      if (e.type !== 'text') return {};
      const next = { ...e, style: { ...e.style, ...style } };
      // A new font size scales the box too, so line breaks stay where they were.
      if (style.fontSize && e.style.fontSize > 0) next.w = e.w * (style.fontSize / e.style.fontSize);
      return { style: next.style, w: next.w, h: this.renderer.textHeight(next) };
    }, key);
  }

  setText(id: string, value: string): void {
    this.commit(updateElements(this.doc, [id], (e) => {
      if (e.type !== 'text') return {};
      return { text: value, h: this.renderer.textHeight({ ...e, text: value }) };
    }), `text:${id}`);
  }

  /** Re-measure text boxes (after fonts load). */
  refitText(): void {
    const ids: string[] = [];
    for (const p of this.doc.pages) for (const e of p.elements) if (e.type === 'text' && Math.abs(this.renderer.textHeight(e) - e.h) > 0.5) ids.push(e.id);
    if (ids.length) this.commit(updateElements(this.doc, ids, (e) => (e.type === 'text' ? { h: this.renderer.textHeight(e) } : {})), 'refit');
  }

  private place(w: number, h: number): { x: number; y: number; w: number; h: number } {
    // Fit inside 60% of the page, centred.
    const max = Math.min(this.doc.width, this.doc.height) * 0.6;
    const s = Math.min(1, max / Math.max(w, h));
    return { x: (this.doc.width - w * s) / 2, y: (this.doc.height - h * s) / 2, w: w * s, h: h * s };
  }

  private add(el: Element): void {
    this.commit(addElements(this.doc, this.pageId, [el]));
    this.seal();
    this.select([el.id], this.pageId);
  }

  addShape(kind: ShapeKind, at?: { x: number; y: number }): void {
    const size = Math.round(Math.min(this.doc.width, this.doc.height) * 0.3);
    const box = this.place(size, kind === 'arrow' ? size / 2 : size);
    if (at) Object.assign(box, { x: at.x - box.w / 2, y: at.y - box.h / 2 });
    this.add(shape(kind, box));
  }

  addText(preset: keyof typeof TEXT_PRESETS, at?: { x: number; y: number }): void {
    const p = TEXT_PRESETS[preset];
    const scale = Math.max(0.4, Math.min(3, Math.min(this.doc.width, this.doc.height) / 1080));
    const style = { ...p.style, fontSize: Math.round(p.style.fontSize * scale) };
    let el: TextElement = text(p.text, { x: 0, y: 0, w: 100, h: 10 }, style);
    const w = Math.min(this.renderer.textWidth(el) + 4, this.doc.width * 0.9);
    el = { ...el, w };
    el.h = this.renderer.textHeight(el);
    el.x = (at?.x ?? this.doc.width / 2) - w / 2;
    el.y = (at?.y ?? this.doc.height / 2) - el.h / 2;
    this.add(el);
  }

  /** Store an uploaded image in the doc (deduplicated). Returns the asset id. */
  async addAsset(bytes: Uint8Array, mime: string, name?: string): Promise<string | null> {
    const id = await assetId(bytes, mime);
    const size = this.renderer.setImage(id, bytes);
    if (!size) return null;
    this.assets.set(id, bytes);
    if (!this.doc.assets[id]) this.commit({ ...this.doc, assets: { ...this.doc.assets, [id]: { mime, ...size, name } } });
    return id;
  }

  async addImageFile(file: File, at?: { x: number; y: number }): Promise<boolean> {
    if (!isImage(file)) return false;
    const id = await this.addAsset(new Uint8Array(await file.arrayBuffer()), file.type, file.name);
    if (!id) return false;
    this.addImageAsset(id, at);
    return true;
  }

  addImageAsset(id: string, at?: { x: number; y: number }): void {
    const meta = this.doc.assets[id];
    if (!meta) return;
    const box = this.place(meta.width ?? 400, meta.height ?? 300);
    if (at) Object.assign(box, { x: at.x - box.w / 2, y: at.y - box.h / 2 });
    this.add(image(id, box));
  }

  deleteSelection(): void {
    if (!this.selection.length) return;
    this.commit(removeElements(this.doc, this.selection));
    this.seal();
    this.selection = [];
    this.editingTextId = null;
  }

  duplicateSelection(): void {
    if (!this.selection.length) return;
    const { doc, ids } = duplicateElements(this.doc, this.selection);
    this.commit(doc);
    this.seal();
    this.select(ids);
  }

  copy(): void {
    this.clipboard = this.selected.map((e) => structuredClone($state.snapshot(e) as Element));
  }

  cut(): void {
    this.copy();
    this.deleteSelection();
  }

  paste(): void {
    if (!this.clipboard.length) return;
    const copies = this.clipboard.map((e) => ({ ...structuredClone(e), id: newId('e_'), x: e.x + 20, y: e.y + 20 }));
    this.clipboard = copies;
    this.commit(addElements(this.doc, this.pageId, copies));
    this.seal();
    this.select(copies.map((c) => c.id), this.pageId);
  }

  arrange(how: Arrange): void {
    if (this.selection.length) this.commit(arrange(this.doc, this.selection, how));
  }

  nudge(dx: number, dy: number): void {
    const ids = this.selected.filter((e) => !e.locked).map((e) => e.id);
    if (ids.length) this.commit(updateElements(this.doc, ids, (e) => ({ x: e.x + dx, y: e.y + dy })), 'nudge');
  }

  /** Align the selection to the page (one element) or to each other. */
  align(how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
    const els = this.selected.filter((e) => !e.locked);
    if (!els.length) return;
    const W = this.doc.width, H = this.doc.height;
    const box = els.length > 1
      ? { x: Math.min(...els.map((e) => e.x)), y: Math.min(...els.map((e) => e.y)), r: Math.max(...els.map((e) => e.x + e.w)), b: Math.max(...els.map((e) => e.y + e.h)) }
      : { x: 0, y: 0, r: W, b: H };
    this.commit(updateElements(this.doc, els.map((e) => e.id), (e) => {
      switch (how) {
        case 'left': return { x: box.x };
        case 'center': return { x: (box.x + box.r) / 2 - e.w / 2 };
        case 'right': return { x: box.r - e.w };
        case 'top': return { y: box.y };
        case 'middle': return { y: (box.y + box.b) / 2 - e.h / 2 };
        case 'bottom': return { y: box.b - e.h };
      }
    }));
  }

  startEditing(id: string): void {
    const hit = findElement(this.doc, id);
    if (hit?.element.type !== 'text' || hit.element.locked) return;
    this.select([id]);
    this.editingTextId = id;
  }

  stopEditing(): void {
    const id = this.editingTextId;
    if (!id) return;
    this.editingTextId = null;
    this.seal();
    const hit = findElement(this.doc, id);
    if (hit?.element.type === 'text' && !hit.element.text.trim()) {
      this.commit(removeElements(this.doc, [id]));
      this.seal();
      this.selection = this.selection.filter((s) => s !== id);
    }
  }

  // ---- pages ----

  addPage(): void {
    const r = addPage(this.doc, this.pageId);
    this.commit(r.doc);
    this.seal();
    this.select([], r.pageId);
  }

  duplicatePage(pageId = this.pageId): void {
    const r = duplicatePage(this.doc, pageId);
    this.commit(r.doc);
    this.seal();
    this.select([], r.pageId);
  }

  removePage(pageId = this.pageId): void {
    if (this.doc.pages.length <= 1) return;
    const i = this.doc.pages.findIndex((p) => p.id === pageId);
    this.commit(removePage(this.doc, pageId));
    this.seal();
    this.select([], this.doc.pages[Math.max(0, i - 1)]!.id);
  }

  movePage(pageId: string, delta: number): void {
    const i = this.doc.pages.findIndex((p) => p.id === pageId);
    this.commit(movePage(this.doc, pageId, i + delta));
    this.seal();
  }

  updatePage(patch: Partial<Omit<Page, 'id' | 'elements'>>, key: string | null = null, pageId = this.pageId): void {
    this.commit(updatePage(this.doc, pageId, patch), key);
  }

  rename(title: string): void {
    const t = title.trim() || 'Untitled design';
    if (t !== this.doc.title) {
      this.commit(setTitle(this.doc, t));
      this.seal();
    }
  }

  // ---- export & save ----

  exportPage(pageId: string, format: 'png' | 'jpeg', scale: number, transparent = false): Uint8Array {
    const page = this.doc.pages.find((p) => p.id === pageId) ?? this.page;
    return this.renderer.exportPage(this.doc, page, { format, scale, transparent, quality: 92 });
  }

  thumbnail(): Uint8Array {
    const scale = Math.min(1, 480 / Math.max(this.doc.width, this.doc.height));
    return this.renderer.exportPage(this.doc, this.doc.pages[0]!, { format: 'png', scale });
  }

  private scheduleSave(): void {
    this.saveState = 'unsaved';
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), 800);
  }

  /** Save now (waits for a save already running). */
  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.saving) await this.saving;
    if (this.saveState === 'saved') return;
    const doc = this.doc;
    this.saveState = 'saving';
    this.saving = (async () => {
      try {
        await this.store.save({ doc: pruneAssets(doc), assets: this.assets, thumbnail: this.thumbnail() });
        // A change made while saving has already scheduled the next save.
        this.saveState = this.doc === doc ? 'saved' : 'unsaved';
        this.saveError = '';
      } catch (err) {
        this.saveState = 'error';
        this.saveError = err instanceof Error ? err.message : String(err);
      } finally {
        this.saving = null;
      }
    })();
    await this.saving;
  }

  dispose(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.renderer.dispose();
  }
}

export const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: 'Square' },
  { kind: 'ellipse', label: 'Circle' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'star', label: 'Star' },
  { kind: 'arrow', label: 'Arrow' },
];
