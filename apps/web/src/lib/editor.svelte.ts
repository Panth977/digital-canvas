import {
  History, newId, addAudio, addElements, pageDuration, removeAudio, totalDuration, updateAudio, video, addPage, arrange, commonStyle, duplicateElements, duplicatePage, findElement, image, movePage,
  normalizeRuns, pruneAssets, pruneFonts, removeElements, removePage, setAsBackground, setTitle, shape, styleRange, text, updateElements, updatePage, lineEnds, pathElement,
  type Arrange, type ImageLook, type AudioClip, type Doc, type Element, type ElementPatch, type EmbeddedFont, type Page, type ShapeKind, type TextElement, type TextRun, type TextStyle,
  childrenOf, cloneElement, distribute, groupElements, resizeDoc, tidyUp, ungroupElements, walk, type ResizeTarget,
} from '@digital-canvas/scene';
import { Renderer, exportSvg, exportVectorPdf } from '@digital-canvas/render';
import {
  chart, coverCrop, erasedBy, followConnectors, frame, FRAMES, freehand, grid, isFrame, line, parseSvg, qrCode, qrUpdate, setLineEnds, table, tableCellText, tableFitRows,
  tableSetCell, type Attach, type Brush, type ChartKind, type LineElement, type LineMarker, type LineRoute, type Stroke, type TableElement,
} from '@digital-canvas/scene';
import { assetId, type ProjectFile, type ProjectStore } from '@digital-canvas/storage';
import type { Engine } from './engine.ts';
import { isImage } from './files.ts';
import { removeBackground, type BackgroundRemover } from './bgremove.ts';
import { addCssFace, fetchFamily, type CatalogFont, type FontFile } from './fonts.ts';
import { isAudioFile, isVideoFile, mediaMime, probeAudio, probeVideo } from './media.ts';
import { Player } from './player.svelte.ts';

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
  /** The current page itself is selected (clicked on its background): it shows a purple outline (Canva). */
  pageSelected = $state(false);
  saveState = $state<SaveState>('saved');
  saveError = $state('');
  canUndo = $state(false);
  canRedo = $state(false);
  /** Bumped when something outside `doc` changes the picture (an image decoded). */
  frame = $state(0);
  /** Characters selected in the text being edited (UTF-16 offsets). */
  textSel = $state<{ start: number; end: number } | null>(null);
  /** Bumped when a style change while editing means the editor must redraw its text. */
  textRev = $state(0);
  /** A font family being downloaded. */
  fontLoading = $state<string | null>(null);
  /** The image or video in crop mode. */
  croppingId = $state<string | null>(null);
  /** Background removal running: what it is doing (and how far, 0..1). */
  bgStatus = $state<{ msg: string; fraction?: number } | null>(null);
  bgError = $state('');
  /** The background remover to use (swappable: other models, tests). */
  bgRemover: BackgroundRemover = removeBackground;

  readonly renderer: Renderer;
  /** Plays the design as a video (pages, clips, sounds). */
  readonly player: Player;
  readonly assets: Map<string, Uint8Array>;
  private history: History<Doc>;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private clipboard: Element[] = [];

  constructor(readonly engine: Engine, readonly store: ProjectStore, file: ProjectFile) {
    this.renderer = new Renderer(engine.ck, engine.fonts);
    this.player = new Player(this);
    this.assets = new Map(file.assets);
    for (const f of file.doc.fonts ?? []) {
      const bytes = this.assets.get(f.asset);
      if (bytes) this.registerFont(f, bytes);
    }
    for (const [id, bytes] of this.assets) if (file.doc.assets[id]?.mime.startsWith('image/')) this.renderer.setImage(id, bytes);
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
    next = followConnectors(next); // connectors keep up with what they are stuck to
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
    if (this.croppingId && !findElement(d, this.croppingId)) this.croppingId = null;
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
    this.pageSelected = false;
    if (pageId) this.pageId = pageId;
    else if (ids[0]) {
      const hit = findElement(this.doc, ids[0]);
      if (hit) this.pageId = hit.page.id;
    }
    if (this.editingTextId && !ids.includes(this.editingTextId)) this.stopEditing();
    if (this.croppingId && !ids.includes(this.croppingId)) this.stopCrop();
    if (this.framePanId && !ids.includes(this.framePanId)) this.framePanId = null;
    if (this.cell && !ids.includes(this.cell.id)) this.cell = null;
    if (this.editingCell && !ids.includes(this.editingCell.id)) this.stopCellEdit();
  }

  selectAll(): void {
    this.select(this.page.elements.filter((e) => !e.hidden).map((e) => e.id), this.pageId);
  }

  // ---- element edits ----

  update(patch: ElementPatch | ((e: Element) => ElementPatch), key: string | null = null, ids = this.selection): void {
    this.commit(updateElements(this.doc, ids, patch), key);
  }

  /** Box changes that keep a text box fitted to its content (curved text keeps its centre). */
  fitPatch(e: TextElement): Partial<TextElement> {
    if (!e.curve) return { h: this.renderer.textHeight(e) };
    const { w, h } = this.renderer.fitText(e);
    return { w, h, x: e.x + (e.w - w) / 2, y: e.y + (e.h - h) / 2 };
  }

  /** The selected range of the text being edited, if any characters are selected. */
  private editRange(): { id: string; start: number; end: number } | null {
    const id = this.editingTextId, sel = this.textSel;
    return id && sel && sel.end > sel.start ? { id, ...sel } : null;
  }

  /** The text style to show: the selected characters' while editing, else the first text box's. */
  get textStyle(): Partial<TextStyle> | null {
    const r = this.editRange();
    if (r) {
      const hit = findElement(this.doc, r.id);
      if (hit?.element.type === 'text') return commonStyle(hit.element, r.start, r.end);
    }
    const t = this.selected.find((e): e is TextElement => e.type === 'text');
    return t ? t.style : null;
  }

  /**
   * Change text style. While editing with characters selected, only those
   * change; otherwise every selected text box. Boxes grow or shrink to fit.
   */
  updateTextStyle(style: Partial<TextStyle>, key: string | null = null): void {
    const r = this.editRange();
    if (r) {
      this.commit(updateElements(this.doc, [r.id], (e) => {
        if (e.type !== 'text') return {};
        const next = { ...e, ...styleRange(e, r.start, r.end, style) };
        return { style: next.style, runs: next.runs, ...this.fitPatch(next) };
      }), key);
      this.textRev++;
      return;
    }
    this.update((e) => {
      if (e.type !== 'text') return {};
      const next: TextElement = { ...e, ...styleRange(e, 0, e.text.length, style) };
      // A new font size scales the box too, so line breaks stay where they were.
      if (style.fontSize && e.style.fontSize > 0 && !e.curve) next.w = e.w * (style.fontSize / e.style.fontSize);
      return { style: next.style, w: next.w, runs: next.runs, ...this.fitPatch(next) };
    }, key);
    if (this.editingTextId) this.textRev++;
  }

  /** Change whole-box text settings (effect, curve, list, gradient), refitting the box. */
  updateText(patch: Partial<Pick<TextElement, 'effect' | 'curve' | 'list' | 'gradient'>>, key: string | null = null): void {
    this.update((e) => {
      if (e.type !== 'text') return {};
      const next = { ...e, ...patch } as TextElement;
      for (const k of Object.keys(patch) as (keyof typeof patch)[]) if (patch[k] === undefined || patch[k] === 0) delete next[k];
      return { ...patch, ...this.fitPatch(next) } as Partial<TextElement>;
    }, key);
    if (this.editingTextId) this.textRev++;
  }

  setText(id: string, value: string): void {
    this.setRich(id, value, undefined);
  }

  /** Text typed in the editor, with its styled runs. */
  setRich(id: string, value: string, runs: TextRun[] | undefined): void {
    this.commit(updateElements(this.doc, [id], (e) => {
      if (e.type !== 'text') return {};
      const next = { ...e, text: value, runs: runs && normalizeRuns(runs, e.style) };
      return { text: value, runs: next.runs, ...this.fitPatch(next) };
    }), `text:${id}`);
  }

  // ---- image tools ----

  /** Selected images and video clips. */
  private get pictures(): string[] {
    return this.selected.filter((e) => e.type === 'image' || e.type === 'video').map((e) => e.id);
  }

  /** Change adjustments, filter or effect of the selected images and clips (undefined = none; dropped when saved). */
  updateLook(patch: ImageLook | ((e: ImageLook) => ImageLook), key: string | null = null): void {
    this.commit(updateElements(this.doc, this.pictures, (e) => {
      if (e.type !== 'image' && e.type !== 'video') return {};
      return typeof patch === 'function' ? patch(e) : patch;
    }), key);
  }

  /** Crop mode: drag the image inside its frame, resize the frame or the image. */
  startCrop(id = this.selection[0]): void {
    const hit = id ? findElement(this.doc, id) : null;
    if (!hit || (hit.element.type !== 'image' && hit.element.type !== 'video') || hit.element.locked) return;
    this.stopEditing();
    this.select([hit.element.id]);
    this.croppingId = hit.element.id;
  }

  stopCrop(): void {
    if (!this.croppingId) return;
    this.croppingId = null;
    this.seal();
  }

  /** Make the selected image fill the page, behind everything, locked. */
  setAsBackground(): void {
    const id = this.pictures[0];
    if (!id) return;
    this.stopCrop();
    this.commit(setAsBackground(this.doc, id));
    this.seal();
  }

  /**
   * Remove the background of the selected image. The cut-out becomes a new PNG
   * asset; the old one stays as `original` so it can be restored (or undone).
   */
  async removeBackground(): Promise<void> {
    const el = this.selected.find((e) => e.type === 'image');
    if (!el || el.type !== 'image' || this.bgStatus) return;
    const bytes = this.assets.get(el.asset), meta = this.doc.assets[el.asset];
    if (!bytes || !meta) return;
    this.bgError = '';
    this.bgStatus = { msg: 'Starting…' };
    try {
      const png = await this.bgRemover(bytes, meta.mime, (msg, fraction) => (this.bgStatus = { msg, fraction }));
      const id = await this.addAsset(png, 'image/png', meta.name ? `${meta.name.replace(/\.[^.]+$/, '')} (cut out).png` : 'cut out.png');
      if (!id) throw new Error('the result could not be read');
      this.commit(updateElements(this.doc, [el.id], (e) => (e.type === 'image' ? { asset: id, original: e.original ?? e.asset } : {})));
      this.seal();
    } catch (err) {
      this.bgError = err instanceof Error ? err.message : String(err);
    } finally {
      this.bgStatus = null;
    }
  }

  /** Put back the image from before its background was removed. */
  restoreOriginal(): void {
    this.commit(updateElements(this.doc, this.pictures, (e) => {
      return e.type === 'image' && e.original ? { asset: e.original, original: undefined } : {};
    }));
    this.seal();
  }

  // ---- fonts ----

  private registerFont(f: EmbeddedFont, bytes: Uint8Array): void {
    this.engine.fonts.addOnce(f.family, f.asset, bytes, f.subset, { weight: f.weight, italic: f.italic });
    addCssFace(f.family, f.asset, bytes, f.weight ?? 400, f.italic ?? false);
  }

  /** Embed font files in the design and make them drawable. */
  async addFonts(files: FontFile[], key: string | null = null): Promise<void> {
    const assets = { ...this.doc.assets };
    const fonts = [...(this.doc.fonts ?? [])];
    for (const f of files) {
      const id = await assetId(f.bytes, f.mime);
      this.assets.set(id, f.bytes);
      assets[id] = { mime: f.mime, name: `${f.family} ${f.weight}${f.italic ? ' italic' : ''}${f.subset ? ` ${f.subset}` : ''}` };
      const meta: EmbeddedFont = { family: f.family, asset: id, weight: f.weight, italic: f.italic, subset: f.subset, source: f.source };
      if (!fonts.some((x) => x.asset === id)) fonts.push(meta);
      this.registerFont(meta, f.bytes);
    }
    this.commit({ ...this.doc, assets, fonts }, key);
  }

  /** Families this design can draw right now (bundled, embedded, uploaded this session). */
  get families(): string[] {
    return [...this.engine.fonts.families].sort((a, b) => a.localeCompare(b));
  }

  /** Use a catalogue font for the selection, downloading it first when needed. */
  async useFont(f: CatalogFont): Promise<void> {
    const key = `font:${Date.now()}`;
    if (!this.engine.fonts.families.has(f.family)) {
      const sample = this.selected.filter((e): e is TextElement => e.type === 'text').map((e) => e.text).join(' ');
      this.fontLoading = f.family;
      try {
        await this.addFonts(await fetchFamily(f, sample), key);
      } finally {
        this.fontLoading = null;
      }
    }
    this.updateTextStyle({ fontFamily: f.family }, key);
    this.seal();
    this.refitText();
  }

  /** Re-measure text boxes (after fonts load). */
  refitText(): void {
    const ids: string[] = [];
    for (const p of this.doc.pages) for (const e of walk(p.elements)) if (e.type === 'text' && Math.abs(this.renderer.fitText(e).h - e.h) > 0.5) ids.push(e.id);
    if (ids.length) this.commit(updateElements(this.doc, ids, (e) => (e.type === 'text' ? this.fitPatch(e) : {})), 'refit');
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

  /** Add a dropped or uploaded file: image, video or sound. Returns false when it isn't one we can use. */
  async addMediaFile(file: File, at?: { x: number; y: number }): Promise<boolean> {
    if (isImage(file)) return this.addImageFile(file, at);
    if (isVideoFile(file)) return this.addVideoFile(file, at);
    if (isAudioFile(file)) return this.addAudioFile(file);
    return false;
  }

  async addVideoFile(file: File, at?: { x: number; y: number }): Promise<boolean> {
    return this.addVideoBytes(new Uint8Array(await file.arrayBuffer()), mediaMime(file), file.name, at);
  }

  /** Add a video from its bytes (uploads, stock videos). `name` is kept with the asset (file name or credit). */
  async addVideoBytes(bytes: Uint8Array, mime: string, name: string, at?: { x: number; y: number }): Promise<boolean> {
    let info;
    try {
      info = await probeVideo(bytes, mime);
    } catch {
      return false;
    }
    const id = await assetId(bytes, mime);
    this.assets.set(id, bytes);
    this.assets.set(`${id}.poster`, info.poster);
    this.renderer.setImage(`${id}.poster`, info.poster);
    let doc: Doc = {
      ...this.doc,
      assets: {
        ...this.doc.assets,
        [id]: { mime, width: info.width, height: info.height, duration: info.duration, name },
        [`${id}.poster`]: { mime: 'image/png', width: info.width, height: info.height, name: `${name} (poster)` },
      },
    };
    // The page lasts at least as long as the clip (like Canva).
    const page = this.page;
    if (page.duration === undefined || page.duration < info.duration) {
      doc = updatePage(doc, page.id, { duration: Math.round(Math.max(info.duration, page.duration ?? 0) * 10) / 10 || pageDuration(page) });
    }
    const box = this.placeBox(info.width, info.height, at);
    const el = video(id, box);
    this.commit(addElements(doc, this.pageId, [el]));
    this.seal();
    this.select([el.id], this.pageId);
    void this.player.seek(this.player.time);
    return true;
  }

  async addAudioFile(file: File): Promise<boolean> {
    return this.addAudioBytes(new Uint8Array(await file.arrayBuffer()), mediaMime(file), file.name, file.name.replace(/\.[^.]+$/, ''));
  }

  /** Add a sound from its bytes. `name` is kept with the asset; `title` names the clip on the timeline. */
  async addAudioBytes(bytes: Uint8Array, mime: string, name: string, title = name): Promise<boolean> {
    let duration: number;
    try {
      duration = await probeAudio(bytes, mime);
    } catch {
      return false;
    }
    const id = await assetId(bytes, mime);
    this.assets.set(id, bytes);
    let doc: Doc = { ...this.doc, assets: { ...this.doc.assets, [id]: { mime, duration, name } } };
    // A design with sound is a video: give pages their (default) durations.
    if (!doc.pages.some((p) => p.duration !== undefined)) doc = { ...doc, pages: doc.pages.map((p) => ({ ...p, duration: pageDuration(p) })) };
    const r = addAudio(doc, { asset: id, start: 0, offset: 0, duration: Math.min(duration, Math.max(totalDuration(doc), 0.1)) || duration, name: title });
    this.commit(r.doc);
    this.seal();
    return true;
  }

  updateAudio(id: string, patch: Partial<Omit<AudioClip, 'id'>>, key: string | null = null): void {
    this.commit(updateAudio(this.doc, id, patch), key);
  }

  removeAudio(id: string): void {
    this.commit(removeAudio(this.doc, id));
    this.seal();
  }

  addVideoAsset(id: string, at?: { x: number; y: number }): void {
    const meta = this.doc.assets[id];
    if (!meta) return;
    this.add(video(id, this.placeBox(meta.width ?? 640, meta.height ?? 360, at)));
  }

  private placeBox(w: number, h: number, at?: { x: number; y: number }) {
    const box = this.place(w, h);
    if (at) Object.assign(box, { x: at.x - box.w / 2, y: at.y - box.h / 2 });
    return box;
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
    const copies = this.clipboard.map((e) => cloneElement(e, 20, 20));
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

  // ---- layout: groups, distribute, tidy up, resize ----

  /** Group the selection (Cmd+G). The elements must share a list: the page, or one group. */
  group(): void {
    const r = groupElements(this.doc, this.selection);
    if (!r) return;
    this.commit(r.doc);
    this.seal();
    this.select([r.id]);
  }

  /** Ungroup the selected groups (Cmd+Shift+G); their children become the selection. */
  ungroup(): void {
    const ids = this.selected.filter((e) => childrenOf(e)).map((e) => e.id);
    if (!ids.length) return;
    const r = ungroupElements(this.doc, ids);
    this.commit(r.doc);
    this.seal();
    this.select(r.ids);
  }

  distribute(axis: 'x' | 'y'): void {
    this.commit(distribute(this.doc, this.selection, axis));
    this.seal();
  }

  tidyUp(): void {
    this.commit(tidyUp(this.doc, this.selection));
    this.seal();
  }

  /** Copies of this design at other sizes ("Resize"), saved to the same store. Returns them. */
  async resizeCopies(targets: ResizeTarget[]): Promise<Doc[]> {
    const out: Doc[] = [];
    for (const t of targets) {
      const doc = resizeDoc(pruneAssets(pruneFonts(this.doc)), t);
      const scale = Math.min(1, 480 / Math.max(doc.width, doc.height));
      const thumbnail = this.renderer.exportPage(doc, doc.pages[0]!, { format: 'png', scale });
      await this.store.save({ doc, assets: this.assets, thumbnail });
      out.push(doc);
    }
    return out;
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
    this.textSel = null;
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

  // ---- M6 elements: lines, frames, grids, tables, charts, QR, icons, photos, drawing ----

  /** The freehand drawing tool, while it is on. */
  tool = $state<DrawTool | null>(null);
  /** The table cell picked for styling (and the one being typed in). */
  cell = $state<{ id: string; r: number; c: number } | null>(null);
  editingCell = $state<{ id: string; r: number; c: number } | null>(null);
  /** A frame whose photo is being moved inside it. */
  framePanId = $state<string | null>(null);

  /** A size relative to the page, so new elements look right on any design. */
  private unit(f: number): number {
    return Math.round(Math.min(this.doc.width, this.doc.height) * f);
  }

  addLine(preset: LinePreset, at?: { x: number; y: number }): void {
    const len = this.unit(0.4);
    const c = at ?? { x: this.doc.width / 2, y: this.doc.height / 2 };
    const bent = preset.route !== 'straight';
    const a = { x: c.x - len / 2, y: c.y - (bent ? len / 4 : 0) }, b = { x: c.x + len / 2, y: c.y + (bent ? len / 4 : 0) };
    const width = Math.max(2, this.unit(0.006));
    this.add(line(a, b, { route: preset.route, start: preset.start, end: preset.end, stroke: { color: '#1f2328', width, dash: preset.dash ?? 'solid' } }));
  }

  /** Move one end of a line to page point `p`, sticking it to an element (`attach`) or letting go (null). */
  setLineEnd(id: string, which: 'start' | 'end', p: { x: number; y: number }, attach: Attach | null, key: string | null = null): void {
    this.update((e) => {
      if (e.type !== 'line') return {};
      const [a, b] = lineEnds(e);
      return which === 'start' ? setLineEnds(e, p, b, { start: attach }) : setLineEnds(e, a, p, { end: attach });
    }, key, [id]);
  }

  updateLine(patch: Partial<Pick<LineElement, 'stroke' | 'route'>> & { startMarker?: LineMarker; endMarker?: LineMarker }, key: string | null = null): void {
    this.update((e) => {
      if (e.type !== 'line') return {};
      const { startMarker, endMarker, ...rest } = patch;
      return {
        ...rest,
        ...(startMarker ? { start: { ...e.start, marker: startMarker } } : {}),
        ...(endMarker ? { end: { ...e.end, marker: endMarker } } : {}),
      };
    }, key);
  }

  addFrame(id: string, at?: { x: number; y: number }): void {
    const f = FRAMES.find((x) => x.id === id) ?? FRAMES[0]!;
    const size = this.unit(0.4);
    const box = this.placeBox(size * (f.ratio ?? 1), size, at);
    if (f.id === 'polaroid') {
      // a white card with the photo frame inset (bigger margin at the bottom)
      const m = box.w * 0.06;
      const card = { ...shape('rect', box, { type: 'solid', color: '#ffffff' }), stroke: { color: '#e3e6eb', width: 1 }, name: 'Polaroid' };
      const photo = frame('rect', { x: box.x + m, y: box.y + m, w: box.w - 2 * m, h: box.h - m * 4.2 });
      this.commit(addElements(this.doc, this.pageId, [card, photo]));
      this.seal();
      this.select([card.id, photo.id], this.pageId);
      return;
    }
    this.add(frame(f.mask, box, '', (f.radius ?? 0) * Math.min(box.w, box.h)));
  }

  /** A photo grid filling the page. */
  addGrid(id: string): void {
    const gap = Math.max(4, this.unit(0.012));
    const frames = grid(id, { x: 0, y: 0, w: this.doc.width, h: this.doc.height }, gap);
    this.commit(addElements(this.doc, this.pageId, frames));
    this.seal();
    this.select(frames.map((f) => f.id), this.pageId);
  }

  /** Put an image asset into a frame (cover-fit, centred). */
  fillFrame(frameId: string, assetId: string): void {
    const meta = this.doc.assets[assetId];
    const hit = findElement(this.doc, frameId);
    if (!meta || !hit || !isFrame(hit.element)) return;
    const el = hit.element;
    this.commit(updateElements(this.doc, [frameId], { asset: assetId, crop: coverCrop(meta.width ?? el.w, meta.height ?? el.h, el.w, el.h) }));
    this.seal();
    this.select([frameId]);
  }

  /** Zoom the photo inside a frame: 1 = cover-fit, 3 = three times closer. Keeps the middle in place. */
  zoomFrame(id: string, zoom: number, key: string | null = null): void {
    const hit = findElement(this.doc, id);
    if (!hit || hit.element.type !== 'image') return;
    const el = hit.element, meta = this.doc.assets[el.asset];
    if (!meta) return;
    const base = coverCrop(meta.width ?? el.w, meta.height ?? el.h, el.w, el.h);
    const cur = el.crop ?? base;
    const w = base.w / zoom, h = base.h / zoom;
    const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
    const crop = { w, h, x: Math.max(0, Math.min(1 - w, cx - w / 2)), y: Math.max(0, Math.min(1 - h, cy - h / 2)) };
    this.update({ crop }, key, [id]);
  }

  addTable(rows: number, cols: number): void {
    const w = this.unit(0.7), fs = Math.max(10, this.unit(0.022));
    const h = rows * fs * 2.6;
    this.add(table(rows, cols, { x: (this.doc.width - w) / 2, y: (this.doc.height - h) / 2, w, h }, { fontSize: fs }));
  }

  /** Apply a table operation (add a row, set a fill…) to one table. */
  tableOp(id: string, fn: (t: TableElement) => Partial<TableElement>, key: string | null = null): void {
    this.update((e) => (e.type === 'table' ? fn(e) : {}), key, [id]);
  }

  /** Grow rows that are too short for their text. */
  fitTable(id: string, key: string | null = null): void {
    const hit = findElement(this.doc, id);
    if (hit?.element.type !== 'table') return;
    const t = hit.element;
    const need = t.rows.map((_, r) => Math.max(...t.cols.map((__, c) => {
      const cell = tableCellText(t, r, c);
      const pad = (t.rows[r]! * t.h - cell.h);
      return cell.text ? this.renderer.textHeight(cell) + pad : 0;
    })));
    const patch = tableFitRows(t, need);
    if (patch) this.update(patch, key, [id]);
  }

  setCellText(id: string, r: number, c: number, value: string): void {
    const key = `cell:${id}:${r},${c}`;
    this.tableOp(id, (t) => tableSetCell(t, r, c, { text: value }), key);
    this.fitTable(id, key);
  }

  editCell(id: string, r: number, c: number): void {
    const hit = findElement(this.doc, id);
    if (hit?.element.type !== 'table' || hit.element.locked) return;
    this.select([id]);
    this.cell = { id, r, c };
    this.editingCell = { id, r, c };
  }

  stopCellEdit(): void {
    if (!this.editingCell) return;
    this.editingCell = null;
    this.seal();
  }

  addChart(kind: ChartKind): void {
    const w = this.unit(0.6), h = Math.round(w * 0.7);
    this.add(chart(kind, { x: (this.doc.width - w) / 2, y: (this.doc.height - h) / 2, w, h }));
  }

  addQr(text: string): void {
    const s = this.unit(0.3);
    this.add(qrCode(text, { x: (this.doc.width - s) / 2, y: (this.doc.height - s) / 2, w: s, h: s }));
  }

  updateQr(id: string, text: string): void {
    this.update((e) => (e.type === 'path' && e.qr !== undefined ? qrUpdate(e, text) : {}), null, [id]);
    this.seal();
  }

  /** Insert an SVG icon as a vector graphic. Returns false when the SVG has nothing we can draw. */
  addSvg(svg: string, name: string, color = '#1f2328', at?: { x: number; y: number }): boolean {
    const parsed = parseSvg(svg, color);
    if (!parsed) return false;
    const size = this.unit(0.25);
    const vb = parsed.viewBox;
    const s = size / Math.max(vb.w, vb.h);
    const box = this.placeBox(vb.w * s, vb.h * s, at);
    // stroke widths come in icon units; ours are page px
    const paths = parsed.paths.map((p) => (p.stroke ? { ...p, stroke: { ...p.stroke, width: p.stroke.width * s } } : p));
    this.add({ ...pathElement(paths, vb, box), name });
    return true;
  }

  /** Add a downloaded photo (stock search) to the page. */
  async addPhoto(bytes: Uint8Array, mime: string, name: string): Promise<boolean> {
    const id = await this.addAsset(bytes, mime, name);
    if (!id) return false;
    this.addImageAsset(id);
    return true;
  }

  /** Recolour a vector graphic: every fill or stroke of colour `from` becomes `to`. */
  recolor(from: string, to: string, key: string | null = null): void {
    const swap = (c: string) => (c.slice(0, 7).toLowerCase() === from.slice(0, 7).toLowerCase() ? to + c.slice(7) : c);
    this.update((e) => {
      if (e.type !== 'path') return {};
      return {
        paths: e.paths.map((p) => ({
          ...p,
          fill: p.fill?.type === 'solid' ? { type: 'solid', color: swap(p.fill.color) } : p.fill,
          stroke: p.stroke ? { ...p.stroke, color: swap(p.stroke.color) } : null,
        })),
      };
    }, key);
  }

  /** Finish a freehand stroke drawn on page `pageId` (points in page px). */
  addStroke(pageId: string, points: { x: number; y: number }[]): void {
    const t = this.tool;
    if (!t || !points.length) return;
    if (t.brush === 'eraser') {
      const page = this.doc.pages.find((p) => p.id === pageId);
      const ids = page ? erasedBy(page.elements, points, t.size / 2) : [];
      if (ids.length) {
        this.commit(removeElements(this.doc, ids));
        this.seal();
        this.selection = this.selection.filter((s) => !ids.includes(s));
      }
      return;
    }
    const el = freehand(points, { color: t.color, size: t.size, brush: t.brush });
    if (!el) return;
    el.opacity = t.opacity;
    this.commit(addElements(this.doc, pageId, [el]));
    this.seal();
    this.pageId = pageId;
  }

  // ---- export & save ----

  /** One page as SVG text. */
  exportSvg(pageId: string): string {
    const page = this.doc.pages.find((p) => p.id === pageId) ?? this.page;
    return exportSvg(this.renderer, this.doc, page, { assets: this.assets });
  }

  /** Pages as a vector PDF. */
  exportVectorPdf(pageIds: string[]): Promise<Uint8Array> {
    return exportVectorPdf(this.renderer, this.doc, { assets: this.assets, pages: pageIds });
  }


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
        await this.store.save({ doc: pruneAssets(pruneFonts(doc)), assets: this.assets, thumbnail: this.thumbnail() });
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
    this.player.dispose();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.renderer.dispose();
  }
}

export interface DrawTool {
  brush: Brush;
  color: string;
  /** Stroke width, px. */
  size: number;
  /** 0..1 */
  opacity: number;
}

export const BRUSHES: Record<Brush, { label: string; size: number; opacity: number; color: string }> = {
  pen: { label: 'Pen', size: 6, opacity: 1, color: '#1f2328' },
  marker: { label: 'Marker', size: 16, opacity: 1, color: '#7c5cff' },
  highlighter: { label: 'Highlighter', size: 28, opacity: 0.4, color: '#facc15' },
  eraser: { label: 'Eraser', size: 24, opacity: 0.35, color: '#9aa1ad' },
};

export interface LinePreset {
  id: string;
  label: string;
  route: LineRoute;
  start: LineMarker;
  end: LineMarker;
  dash?: Stroke['dash'];
}

export const LINES: LinePreset[] = [
  { id: 'line', label: 'Line', route: 'straight', start: 'none', end: 'none' },
  { id: 'dashed', label: 'Dashed line', route: 'straight', start: 'none', end: 'none', dash: 'dashed' },
  { id: 'dotted', label: 'Dotted line', route: 'straight', start: 'none', end: 'none', dash: 'dotted' },
  { id: 'arrow', label: 'Arrow', route: 'straight', start: 'none', end: 'arrow' },
  { id: 'triangle', label: 'Solid arrow', route: 'straight', start: 'none', end: 'triangle' },
  { id: 'double', label: 'Double arrow', route: 'straight', start: 'arrow', end: 'arrow' },
  { id: 'dots', label: 'Circle ends', route: 'straight', start: 'circle', end: 'circle' },
  { id: 'elbow', label: 'Elbow connector', route: 'elbow', start: 'none', end: 'triangle' },
  { id: 'curved', label: 'Curved connector', route: 'curved', start: 'none', end: 'triangle' },
];

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
