<script lang="ts">
  import { handlePanelDrop } from '../lib/content/insert.svelte.ts';
  import { onMount, untrack } from 'svelte';
  import type { Surface } from 'canvaskit-wasm';
  import {
    aabb, angleTo, center, corners, cropFromBoxes, cropOf, cropPatch, duplicateElements, findElement, hitTest, hitTestAll, imageBox, marqueePick, localToPage, normalizeRect, pageToLocal,
    panImage, resizeBox, resizeFrame, rotatePoint, scaleImage, union, updateElements,
    addGuide, childrenOf, hitTestPath, moveGuide, pathTo, removeGuide, safeMargin, snapMove, snapResize, snapTargets,
    ANCHORS, boxPoint, contains, coverCrop, isFrame, lineEnds, lineRoute, routePoints, tableCellAt, tableCellRect,
    type Attach, type CropHandle, type Element, type GapHint, type Handle, type ImageElement, type LineElement, type Point, type Rect, type ShapeKind, type SnapGuide, type SnapTargets, type VideoElement,
  } from '@digital-canvas/scene';
  import { fetchPhoto, attribution, type Photo } from '../lib/stock.ts';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { TEXT_PRESETS } from '../lib/editor.svelte.ts';
  import Icon from '../lib/Icon.svelte';
  import { view, clampZoom, type FitMode } from '../lib/view.svelte.ts';
  import CanvasMenu from './CanvasMenu.svelte';
  import Rulers, { RULER } from './Rulers.svelte';
  import { ui } from '../lib/ui.svelte.ts';
  import { textShortcut } from '../lib/shortcuts.ts';
  import { flatten, getSelectionOffsets, needsRebuild, renderRich, setSelectionOffsets } from '../lib/richtext.ts';
  import { mobile } from '../lib/mobile.svelte.ts';

  let { ed, zoom = $bindable(view.zoom) }: { ed: EditorState; zoom?: number } = $props();

  /** Workspace colour behind the pages, from the theme (--stage), as CanvasKit RGBA. */
  let STAGE = [0.922, 0.925, 0.941, 1];
  function readStage(): void {
    const v = getComputedStyle(host).getPropertyValue('--stage').trim();
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
    if (m) STAGE = [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255, 1];
  }
  const HANDLE_HIT = 11;
  /** Fingers get bigger targets (Canva mobile). */
  const TOUCH_HIT = 22;
  /** The last pointer was a finger: handles grow and gestures switch to touch rules. */
  let touchUi = $state(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);

  let host: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;
  let surface: Surface | null = null;
  let vw = $state(0), vh = $state(0);
  let panX = $state(0), panY = $state(0);
  let dpr = 1;
  let drawQueued = false;
  let fitted = false;
  view.mode = 'fit';

  // ---- layout: pages stacked vertically in world space ----
  /** Space between pages: room for the page header (about 56 screen px) at any zoom, like Canva. */
  const gap = $derived(Math.max(ed.doc.height * 0.04, 56 / zoom));
  const pageTop = (i: number) => i * (ed.doc.height + gap);
  const pageIndexOf = (pageId: string) => ed.doc.pages.findIndex((p) => p.id === pageId);

  const toScreen = (wx: number, wy: number): Point => ({ x: panX + wx * zoom, y: panY + wy * zoom });
  const toWorld = (sx: number, sy: number): Point => ({ x: (sx - panX) / zoom, y: (sy - panY) / zoom });

  /** Which page a world point belongs to (nearest by y). */
  function pageAt(w: Point): number {
    const i = Math.floor((w.y + gap / 2) / (ed.doc.height + gap));
    return Math.max(0, Math.min(ed.doc.pages.length - 1, i));
  }
  function toPage(w: Point, i: number): Point {
    return { x: w.x, y: w.y - pageTop(i) };
  }
  // Canva drops a clicked element in the middle of the visible part of the page (asked on demand)
  $effect(() => {
    ed.viewProbe = () => {
      const i = ed.pageIndex;
      if (i < 0 || !vw || !vh) return null;
      const c = toPage(toWorld(vw / 2, vh / 2), i);
      return { pageId: ed.pageId, x: c.x, y: c.y };
    };
  });

  function localPoint(e: PointerEvent | MouseEvent | DragEvent): Point {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Screen points along a line's route (for its outline). */
  function lineOutline(el: LineElement, i: number): Point[] {
    return routePoints(lineRoute(el), 16).map((p) => rotatePoint(p, center(el), el.rotation)).map((p) => toScreen(p.x, p.y + pageTop(i)));
  }

  /** Screen-space corners of an element on page i. */
  function screenCorners(el: Rect & { rotation: number }, i: number): Point[] {
    return corners(el).map((p) => toScreen(p.x, p.y + pageTop(i)));
  }

  // ---- view: Canva's scroll model ----
  // The workspace scrolls like a document: the page column plus a margin around it.
  // While the (zoomed) page width fits, it is centred and cannot scroll sideways; once
  // wider, it scrolls between its edges plus MARGIN_X. Vertically the column runs from the
  // first page's header to the "Add page" button below the last page; a column shorter
  // than the workspace is centred.
  /** Workspace margin beside the page once it scrolls sideways (screen px). */
  const MARGIN_X = $derived(mobile.on ? 12 : 40);
  /** Above the first page: its header (34 px) and a little air. */
  const MARGIN_TOP = $derived(mobile.on ? 20 : 56);
  /** Below the last page: the "Add page" button (16 + 40 px) and a little air. */
  const MARGIN_BOTTOM = $derived(mobile.on ? 72 : 88);

  /** Screen insets of the scrollable area (rulers and bleed take room too). */
  function insets(): { l: number; r: number; t: number; b: number } {
    const ruler = view.rulers ? RULER : 0;
    const b = view.bleed ? ed.doc.bleed * zoom : 0;
    return { l: MARGIN_X + ruler + b, r: MARGIN_X + b, t: MARGIN_TOP + ruler + b, b: MARGIN_BOTTOM + b };
  }
  const columnHeight = () => pageTop(ed.doc.pages.length - 1) + ed.doc.height;

  /** Allowed panX / panY: [lo, hi]; lo === hi when that axis cannot scroll. */
  function panRange(): { x: { lo: number; hi: number }; y: { lo: number; hi: number } } {
    const ins = insets();
    const pw = ed.doc.width * zoom, ph = columnHeight() * zoom;
    const axis = (size: number, view: number, a: number, b: number) => {
      if (size + a + b <= view) {
        const c = a + (view - a - b - size) / 2;
        return { lo: c, hi: c };
      }
      return { lo: view - b - size, hi: a };
    };
    return { x: axis(pw, vw, ins.l, ins.r), y: axis(ph, vh, ins.t, ins.b) };
  }

  function clampPan(): void {
    if (!vw || !vh) return;
    const r = panRange();
    panX = Math.min(r.x.hi, Math.max(r.x.lo, panX));
    panY = Math.min(r.y.hi, Math.max(r.y.lo, panY));
  }

  /** panY that shows page i: centred when it fits, else its top under the header. */
  function panYFor(i: number): number {
    const ins = insets();
    return ins.t + Math.max(0, (vh - ins.t - ins.b - ed.doc.height * zoom) / 2) - pageTop(i) * zoom;
  }

  /** Canva's Fit (whole page in view) and Fill (page width fills the workspace). */
  function fit(mode: FitMode = 'fit', i = ed.pageIndex): void {
    if (!vw || !vh) return;
    stopScrollAnim();
    const W = ed.doc.width, H = ed.doc.height;
    const ins = insets();
    const fw = (vw - ins.l - ins.r) / W;
    zoom = clampZoom(mode === 'fill' ? fw : Math.min(fw, (vh - ins.t - ins.b) / H));
    panX = 0;
    panY = panYFor(i);
    clampPan();
    view.mode = mode;
    queueDraw();
  }

  function zoomAt(next: number, s: Point): void {
    next = clampZoom(next);
    stopScrollAnim();
    // keep the same spot of the same page under the cursor (the gap between pages changes with zoom),
    // then centre / clamp again
    const w = toWorld(s.x, s.y);
    const i = pageAt(w);
    const local = toPage(w, i);
    zoom = next;
    panX = s.x - w.x * zoom;
    panY = s.y - (local.y + pageTop(i)) * zoom;
    clampPan();
    view.mode = null;
    flashBars();
  }

  export function setZoom(next: number): void {
    zoomAt(next, { x: vw / 2, y: vh / 2 });
  }

  /** Pan by a screen delta (wheel, trackpad, hand tool), within the clamps. */
  function scrollBy(dx: number, dy: number): void {
    stopScrollAnim();
    panX -= dx;
    panY -= dy;
    clampPan();
    flashBars();
    syncCurrentPage();
  }

  // Re-centre / re-clamp whenever the column or the workspace changes size (pages added or
  // deleted, page size, rulers, bleed). A resize is handled by the observer (keeps the view stable).
  $effect(() => {
    void ed.doc.pages.length; void ed.doc.width; void ed.doc.height; void view.rulers; void view.bleed; void ed.doc.bleed;
    untrack(clampPan);
  });
  // a new page size (Resize) re-fits while in Fit / Fill
  let sized = '';
  $effect(() => {
    const k = `${ed.doc.width}x${ed.doc.height}`;
    untrack(() => {
      if (sized && k !== sized && view.mode) fit(view.mode);
      sized = k;
    });
  });

  $effect(() => {
    view.zoom = zoom;
  });

  // ---- smooth scroll to a page ----
  let scrollAnim = 0;
  function stopScrollAnim(): void {
    if (scrollAnim) cancelAnimationFrame(scrollAnim);
    scrollAnim = 0;
  }
  function animatePanY(target: number): void {
    stopScrollAnim();
    const from = panY, t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 240);
      panY = from + (target - from) * (1 - (1 - k) ** 3);
      clampPan();
      scrollAnim = k < 1 ? requestAnimationFrame(step) : 0;
    };
    scrollAnim = requestAnimationFrame(step);
  }

  // ---- continuous scroll: the page in the middle of the view is the current one (Canva) ----
  let scrolledTo = '';
  /** After the user scrolls or zooms: make the page in the middle of the view current. */
  function syncCurrentPage(): void {
    if (!vh || drag || ed.selection.length || ed.editingTextId || ed.croppingId) return;
    const id = ed.doc.pages[pageAt(toWorld(vw / 2, vh / 2))]?.id;
    if (id && id !== ed.pageId) {
      scrolledTo = id;
      ed.pageId = id;
    }
  }
  /** Scroll page i into view unless it already is (smoothly, like Canva). */
  function revealPage(i: number): void {
    stopScrollAnim(); // a scroll to another page still running is cancelled
    const top = toScreen(0, pageTop(i)).y, h = ed.doc.height * zoom;
    const ins = insets();
    const shown = h <= vh - ins.t - ins.b ? top >= ins.t / 2 && top + h <= vh - 16 : top < vh / 2 && top + h > vh / 2;
    if (shown) return;
    const r = panRange();
    animatePanY(Math.min(r.y.hi, Math.max(r.y.lo, panYFor(i))));
  }
  /** A page made current elsewhere (page strip, grid view, add / duplicate page, Page Up/Down) is scrolled into view. */
  $effect(() => {
    const id = ed.pageId;
    if (!vh || id === scrolledTo) return;
    scrolledTo = id;
    untrack(() => {
      const i = pageIndexOf(id);
      if (i >= 0) revealPage(i);
    });
  });

  // ---- overlay scrollbars (thin, shown while scrolling or hovered, like Canva) ----
  let barsShown = $state(false);
  let barsTimer = 0;
  function flashBars(): void {
    barsShown = true;
    clearTimeout(barsTimer);
    barsTimer = window.setTimeout(() => (barsShown = false), 900);
  }
  const SB_PAD = 4, SB_MIN = 32;
  /** Thumb geometry per axis, or null when that axis cannot scroll. */
  const scrollbars = $derived.by(() => {
    void panX; void panY;
    if (!vw || !vh) return { x: null, y: null };
    const r = panRange();
    const one = (lo: number, hi: number, pan: number, len: number) => {
      if (hi - lo < 0.5) return null;
      const track = len - 2 * SB_PAD - 12;
      const size = Math.max(SB_MIN, (track * len) / (len + hi - lo));
      const at = ((hi - pan) / (hi - lo)) * (track - size);
      return { size, at: SB_PAD + Math.max(0, Math.min(track - size, at)), track, lo, hi };
    };
    return { x: one(r.x.lo, r.x.hi, panX, vw), y: one(r.y.lo, r.y.hi, panY, vh) };
  });
  let barDrag: { axis: 'x' | 'y'; start: number; pan: number } | null = null;
  function barDown(axis: 'x' | 'y', e: PointerEvent): void {
    e.stopPropagation();
    e.preventDefault();
    const b = scrollbars[axis];
    if (!b) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const pos = axis === 'x' ? localPoint(e).x : localPoint(e).y;
    if (!(e.target as HTMLElement).classList.contains('thumb')) {
      // a click on the track jumps there (thumb centred on the pointer)
      const k = Math.max(0, Math.min(1, (pos - SB_PAD - b.size / 2) / (b.track - b.size)));
      if (axis === 'x') panX = b.hi - k * (b.hi - b.lo);
      else panY = b.hi - k * (b.hi - b.lo);
      clampPan();
      syncCurrentPage();
    }
    barDrag = { axis, start: pos, pan: axis === 'x' ? panX : panY };
    flashBars();
  }
  function barMove(e: PointerEvent): void {
    if (!barDrag) return;
    e.stopPropagation();
    const b = scrollbars[barDrag.axis];
    if (!b) return;
    const pos = barDrag.axis === 'x' ? localPoint(e).x : localPoint(e).y;
    const per = (b.hi - b.lo) / Math.max(1, b.track - b.size);
    if (barDrag.axis === 'x') panX = barDrag.pan - (pos - barDrag.start) * per;
    else panY = barDrag.pan - (pos - barDrag.start) * per;
    clampPan();
    flashBars();
    syncCurrentPage();
  }
  function barUp(e: PointerEvent): void {
    barDrag = null;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }

  // ---- auto-scroll while dragging an element near the workspace edge (Canva) ----
  let lastMove: PointerEvent | null = null;
  let autoRaf = 0;
  const EDGE = 40, EDGE_SPEED = 18;
  function autoScroll(): void {
    autoRaf = 0;
    if (!drag || !lastMove || (drag.mode !== 'move' && drag.mode !== 'resize')) return;
    if (drag.mode === 'move' && !drag.moved) return;
    const s = localPoint(lastMove);
    const speed = (d: number) => (d < EDGE ? EDGE_SPEED * Math.min(1, (EDGE - d) / EDGE) : 0);
    const dx = speed(s.x) - speed(vw - s.x), dy = speed(s.y) - speed(vh - s.y);
    if (!dx && !dy) return;
    const x0 = panX, y0 = panY;
    panX += dx;
    panY += dy;
    clampPan();
    if (panX !== x0 || panY !== y0) {
      flashBars();
      onPointerMove(lastMove);
    }
    autoRaf = requestAnimationFrame(autoScroll);
  }

  view.port = {
    zoomTo: (z) => setZoom(z),
    fit: (mode) => fit(mode),
    goToPage: (i) => {
      const p = ed.doc.pages[Math.max(0, Math.min(ed.doc.pages.length - 1, i))];
      if (!p) return;
      if (p.id === ed.pageId) revealPage(pageIndexOf(p.id));
      else ed.select([], p.id);
    },
  };

  // ---- canvas context menu (right-click) ----
  let menu = $state.raw<{ x: number; y: number; kind: 'element' | 'page'; pageId: string } | null>(null);
  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    // a finger's long press opens the menu itself (iOS sends no contextmenu at all)
    if ((e as PointerEvent).pointerType === 'touch' || touches.size || Date.now() - lastTouch < 800) return;
    if (drag || ed.croppingId) return;
    openMenu(localPoint(e));
  }

  function openMenu(s: Point): void {
    if (ed.editingTextId) ed.stopEditing();
    const hit = elementAt(s);
    if (hit) {
      // Canva: right-click on an element outside the selection selects it first
      if (!ed.selection.includes(hit.el.id)) ed.select([hit.el.id]);
      menu = { x: s.x, y: s.y, kind: 'element', pageId: ed.doc.pages[hit.i]!.id };
      return;
    }
    if (multiBox && onSelection(s, null)) {
      menu = { x: s.x, y: s.y, kind: 'element', pageId: ed.pageId };
      return;
    }
    const w = toWorld(s.x, s.y);
    const i = pageAt(w);
    const p = toPage(w, i);
    const onPage = p.x >= 0 && p.y >= 0 && p.x <= ed.doc.width && p.y <= ed.doc.height;
    const pageId = ed.doc.pages[i]!.id;
    ed.select([], onPage ? pageId : undefined);
    ed.pageSelected = onPage;
    menu = { x: s.x, y: s.y, kind: 'page', pageId: onPage ? pageId : ed.pageId };
  }

  // ---- drawing ----
  function makeSurface(): void {
    const ck = ed.engine.ck;
    surface?.delete();
    dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.max(1, Math.round(vw * dpr));
    canvasEl.height = Math.max(1, Math.round(vh * dpr));
    surface = ck.MakeWebGLCanvasSurface(canvasEl) ?? ck.MakeSWCanvasSurface(canvasEl);
  }

  function queueDraw(): void {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(draw);
  }

  function draw(): void {
    drawQueued = false;
    if (!surface) return;
    const ck = ed.engine.ck;
    const c = surface.getCanvas();
    c.clear(Float32Array.from(STAGE));
    c.save();
    c.scale(dpr, dpr);
    // Text being edited is still drawn here (the editor's own letters are invisible, it only
    // shows the caret and selection), so nothing moves on double-click. Curved text is edited
    // as a straight line on a white card, so the canvas leaves it out.
    const editingEl = ed.editingTextId ? findElement(ed.doc, ed.editingTextId)?.element : null;
    const skip = editingEl?.type === 'text' && editingEl.curve ? new Set([editingEl.id]) : undefined;
    const shadow = new ck.Paint();
    shadow.setColor(ck.Color4f(0.06, 0.07, 0.12, 0.14));
    shadow.setMaskFilter(ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, 6, true));
    const bleed = view.bleed ? ed.doc.bleed : 0;
    ed.doc.pages.forEach((page, i) => {
      const s = toScreen(0, pageTop(i));
      const w = ed.doc.width * zoom, h = ed.doc.height * zoom, b = bleed * zoom;
      if (s.y > vh || s.y + h < 0 || s.x > vw || s.x + w < 0) return; // off screen
      c.drawRect(ck.XYWHRect(s.x - b, s.y - b + 2, w + 2 * b, h + 2 * b), shadow);
      c.save();
      c.translate(s.x, s.y);
      c.scale(zoom, zoom);
      ed.renderer.drawPage(c, ed.doc, page, { skip, bleed });
      c.restore();
    });
    shadow.delete();
    if (cropping) {
      // crop mode: everything dimmed, the whole image faded, the frame's part bright on top
      const { el, i } = cropping;
      const dim = new ck.Paint();
      dim.setColor(ck.Color4f(0.06, 0.07, 0.12, 0.35));
      c.drawRect(ck.XYWHRect(0, 0, vw, vh), dim);
      dim.delete();
      const s = toScreen(0, pageTop(i));
      c.save();
      c.translate(s.x, s.y);
      c.scale(zoom, zoom);
      ed.renderer.drawCropGhost(c, el, 0.5);
      ed.renderer.drawElement(c, el);
      c.restore();
    }
    c.restore();
    surface.flush();
  }

  $effect(() => {
    // Redraw whenever anything visible changes.
    void ed.doc; void ed.editingTextId; void ed.frame; void cropping; void zoom; void panX; void panY; void vw; void vh; void view.bleed;
    queueDraw();
  });

  onMount(() => {
    readStage();
    // for tests and the console: the viewport (pan = screen position of page 1's top-left corner)
    (window as unknown as { __dcView?: unknown }).__dcView = { get: () => ({ panX, panY, zoom, vw, vh, range: panRange(), mode: view.mode }) };
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => { readStage(); queueDraw(); };
    scheme.addEventListener('change', onScheme);
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      // keep the view stable: the spot in the middle of the workspace stays in the middle
      let anchor: { x: number; y: number; i: number } | null = null;
      if (vw && vh) {
        const w = toWorld(vw / 2, vh / 2);
        const i = pageAt(w);
        anchor = { x: w.x, y: toPage(w, i).y, i };
      }
      vw = r.width;
      vh = r.height;
      makeSurface();
      if (!fitted && vw > 0 && vh > 0) {
        fitted = true;
        fit('fit');
      } else if (fitted && view.mode && !ed.editingTextId) {
        // Fit / Fill keep fitting until the user zooms (Canva)
        fit(view.mode, anchor?.i ?? ed.pageIndex);
      } else if (anchor) {
        stopScrollAnim();
        panX = vw / 2 - anchor.x * zoom;
        panY = vh / 2 - (anchor.y + pageTop(anchor.i)) * zoom;
        clampPan();
      }
      if (ed.editingTextId) revealEditing();
      queueDraw();
    });
    ro.observe(host);
    return () => {
      scheme.removeEventListener('change', onScheme);
      ro.disconnect();
      view.port = null;
      stopScrollAnim();
      if (autoRaf) cancelAnimationFrame(autoRaf);
      clearTimeout(barsTimer);
      surface?.delete();
      surface = null;
    };
  });

  // ---- crop mode ----
  type Picture = ImageElement | VideoElement;
  /** The element in crop mode: its frame and where the whole image lies, in element space. */
  const cropping = $derived.by(() => {
    void ed.frame;
    const hit = ed.croppingId ? findElement(ed.doc, ed.croppingId) : null;
    const el = hit?.element;
    if (!hit || !el || (el.type !== 'image' && el.type !== 'video')) return null;
    const meta = ed.doc.assets[el.asset];
    const size = ed.renderer.imageSize(el) ?? (meta?.width && meta.height ? { width: meta.width, height: meta.height } : null);
    if (!size) return null;
    const frame = { x: el.x, y: el.y, w: el.w, h: el.h };
    return { el, i: pageIndexOf(hit.page.id), frame, img: imageBox(frame, cropOf(el, size.width, size.height)) };
  });

  /** Element space → screen. */
  function elScreen(el: Picture, i: number, p: Point): Point {
    const q = localToPage(el, p);
    return toScreen(q.x, q.y + pageTop(i));
  }
  function boxScreen(el: Picture, i: number, b: Rect): Point[] {
    return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }].map((p) => elScreen(el, i, p));
  }

  interface CropHandlePos { kind: 'frame' | 'image'; h: CropHandle; x: number; y: number }
  const cropHandles = $derived.by((): CropHandlePos[] => {
    if (!cropping) return [];
    const { el, i, frame: f, img } = cropping;
    const at = (b: Rect, h: CropHandle) => elScreen(el, i, {
      x: h.includes('w') ? b.x : h.includes('e') ? b.x + b.w : b.x + b.w / 2,
      y: h.includes('n') ? b.y : h.includes('s') ? b.y + b.h : b.y + b.h / 2,
    });
    const frameH: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const imgH: CropHandle[] = ['nw', 'ne', 'se', 'sw'];
    return [
      ...imgH.map((h) => ({ kind: 'image' as const, h, ...at(img, h) })),
      ...frameH.map((h) => ({ kind: 'frame' as const, h, ...at(f, h) })),
    ];
  });

  function cropHandleAt(s: Point): CropHandlePos | null {
    // frame handles win over image corners that sit on top of them
    for (const kind of ['frame', 'image'] as const)
      for (const h of cropHandles) if (h.kind === kind && Math.hypot(h.x - s.x, h.y - s.y) <= HANDLE_HIT) return h;
    return null;
  }

  function cropLocal(el: Picture, i: number, s: Point): Point {
    return pageToLocal(el, toPage(toWorld(s.x, s.y), i));
  }

  const inBox = (b: Rect, p: Point) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

  // ---- selection overlay ----
  const selected = $derived(ed.selected.map((el) => ({ el, i: pageIndexOf(findElement(ed.doc, el.id)!.page.id) })));
  const single = $derived(selected.length === 1 ? selected[0]! : null);
  const hover = $derived.by(() => {
    if (!ed.hoverId || ed.selection.includes(ed.hoverId) || (drag && drag.mode !== 'press')) return null;
    const hit = findElement(ed.doc, ed.hoverId);
    return hit ? { el: hit.element, i: pageIndexOf(hit.page.id) } : null;
  });

  /** Bounding box (screen) of a multi-selection, axis aligned. */
  const multiBox = $derived.by(() => {
    if (selected.length < 2) return null;
    const rects = selected.map(({ el, i }) => {
      const b = aabb(el);
      const p = toScreen(b.x, b.y + pageTop(i));
      return { x: p.x, y: p.y, w: b.w * zoom, h: b.h * zoom };
    });
    return union(rects);
  });

  interface HandlePos { h: Handle | 'rot' | 'start' | 'end'; x: number; y: number }

  const handles = $derived.by((): HandlePos[] => {
    if (ed.editingTextId || ed.croppingId || ed.framePanId) return [];
    if (single) {
      const { el, i } = single;
      if (el.locked) return [];
      if (el.type === 'line') {
        // a line has a handle on each end instead of a box
        const [a, b] = lineEnds(el);
        return [{ h: 'start', ...toScreen(a.x, a.y + pageTop(i)) }, { h: 'end', ...toScreen(b.x, b.y + pageTop(i)) }];
      }
      const [tl, tr, br, bl] = screenCorners(el, i) as [Point, Point, Point, Point];
      const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const all: HandlePos[] = [
        { h: 'nw', ...tl }, { h: 'ne', ...tr }, { h: 'se', ...br }, { h: 'sw', ...bl },
        { h: 'e', ...mid(tr, br) }, { h: 'w', ...mid(tl, bl) },
      ];
      const small = el.w * zoom < 28 || el.h * zoom < 28;
      if (childrenOf(el)) all.splice(4, 2); // groups scale from the corners only
      else if (el.type !== 'text' && !small) all.push({ h: 'n', ...mid(tl, tr) }, { h: 's', ...mid(bl, br) });
      // rotate handle: below the bottom edge
      const bm = mid(bl, br);
      const down = rotatePoint({ x: 0, y: 30 }, { x: 0, y: 0 }, el.rotation);
      all.push({ h: 'rot', x: bm.x + down.x, y: bm.y + down.y });
      return all;
    }
    if (multiBox && !selected.some(({ el }) => el.locked)) {
      const b = multiBox;
      return [
        { h: 'nw', x: b.x, y: b.y }, { h: 'ne', x: b.x + b.w, y: b.y },
        { h: 'se', x: b.x + b.w, y: b.y + b.h }, { h: 'sw', x: b.x, y: b.y + b.h },
      ];
    }
    return [];
  });

  const CURSOR: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab', start: 'crosshair', end: 'crosshair' };

  // ---- pointer interaction ----
  type Drag =
    | { mode: 'move'; start: Point; orig: Map<string, { x: number; y: number }>; key: string; moved: boolean; pageI: number; box: Rect | null; targets: SnapTargets;
        /** What a click (no drag) does: edit the text at the pointer, or pick the element behind. */
        click: 'edit' | 'behind' | null; client: Point; alt: boolean }
    /** Pressed on an element that is not selected: a click selects it, a drag draws a selection box (Canva). */
    | { mode: 'press'; start: Point; el: Element; i: number; mod: boolean }
    | { mode: 'resize'; handle: Handle; pageI: number; orig: Element[]; box: Rect; key: string; shift: boolean; targets: SnapTargets }
    | { mode: 'guide'; axis: 'x' | 'y'; pageI: number; index: number | null; key: string }
    | { mode: 'rotate'; pageI: number; orig: Element; key: string }
    | { mode: 'marquee'; start: Point; now: Point; pageI: number; base: string[] }
    | { mode: 'pan'; start: Point; panX: number; panY: number;
        /** Touch: a tap (no drag) on empty space selects the page under it, or nothing. */
        tap?: { pageId: string | undefined; onPage: boolean }; moved?: boolean }
    | { mode: 'crop-pan' | 'crop-frame' | 'crop-scale'; el: Picture; i: number; frame: Rect; img: Rect; start: Point; handle: CropHandle; key: string }
    | { mode: 'lineEnd'; id: string; which: 'start' | 'end'; pageI: number; key: string }
    | { mode: 'draw'; pageI: number; pts: Point[] }
    | { mode: 'framePan'; id: string; start: Point; crop: { x: number; y: number; w: number; h: number }; key: string };

  let drag = $state.raw<Drag | null>(null);
  /** While dragging a line's end: the element it would stick to, and the spot. */
  let snap = $state.raw<{ el: Element; i: number; point: { x: number; y: number } | null } | null>(null);
  let cursor = $state('default');
  /** Canva's live readout next to the pointer: "w × h" while resizing, degrees while rotating. */
  let tip = $state.raw<{ x: number; y: number; text: string } | null>(null);
  let spaceDown = false;

  function handleAt(s: Point): HandlePos | null {
    const r = touchUi ? TOUCH_HIT : HANDLE_HIT;
    // the nearest handle in reach (fingers reach further, so neighbours can overlap)
    let best: HandlePos | null = null, bd = Infinity;
    for (const h of handles) {
      const d = Math.hypot(h.x - s.x, h.y - s.y);
      if (d <= r && d < bd) { best = h; bd = d; }
    }
    return best;
  }

  /**
   * The element a click at `s` means. Normally the top-level element (a whole
   * group); once a child of a group is selected, its siblings are picked
   * directly (Canva: double-click into a group, then click around inside it).
   */
  function elementAt(s: Point): { el: Element; i: number; path: Element[] } | null {
    const w = toWorld(s.x, s.y);
    const i = pageAt(w);
    // outside the page elements may still stick out, so test anyway
    const path = hitTestPath(ed.doc.pages[i]!, toPage(w, i), 2 / zoom);
    if (!path) return null;
    const scope = ed.selection.length ? findElement(ed.doc, ed.selection[0]!)?.parent?.id : undefined;
    const k = scope ? path.findIndex((e) => e.id === scope) : -1;
    return { el: k >= 0 && path[k + 1] ? path[k + 1]! : path[0]!, i, path };
  }

  // ---- snapping and smart guides ----
  const SNAP_PX = 6;
  let snapShown = $state.raw<{ i: number; guides: SnapGuide[]; gaps: GapHint[] } | null>(null);

  /** Lines on page i to snap to: the page, other elements (not `moving`, nor groups holding them), ruler guides. */
  function targetsFor(i: number, moving: string[]): SnapTargets {
    const page = ed.doc.pages[i]!;
    const skip = new Set(moving);
    const rects: Rect[] = [];
    const visit = (els: Element[]) => {
      for (const e of els) {
        if (e.hidden || skip.has(e.id)) continue;
        const kids = childrenOf(e);
        if (kids && moving.some((id) => pathTo(kids, id))) visit(kids);
        else rects.push(aabb(e));
      }
    };
    visit(page.elements);
    return snapTargets(ed.doc.width, ed.doc.height, rects, view.rulers ? page.guides ?? [] : []);
  }

  /** Cmd/Ctrl held (or snapping off in View) = place freely. (Alt-drag makes a copy.) */
  const free = (e: PointerEvent | MouseEvent) => !view.snap || e.metaKey || e.ctrlKey;

  // ---- ruler guides ----
  function guideAt(s: Point): { i: number; index: number; axis: 'x' | 'y' } | null {
    if (!view.rulers) return null;
    const i = pageAt(toWorld(s.x, s.y));
    const gs = ed.doc.pages[i]!.guides ?? [];
    for (let index = gs.length - 1; index >= 0; index--) {
      const g = gs[index]!;
      const o = toScreen(0, pageTop(i));
      const d = g.axis === 'x' ? Math.abs(o.x + g.pos * zoom - s.x) : Math.abs(o.y + g.pos * zoom - s.y);
      const along = g.axis === 'x' ? s.y >= o.y && s.y <= o.y + ed.doc.height * zoom : s.x >= o.x && s.x <= o.x + ed.doc.width * zoom;
      if (d <= 4 && along) return { i, index, axis: g.axis };
    }
    return null;
  }

  /** Drag a new guide out of a ruler: from the top ruler a horizontal one (axis 'y'), from the left a vertical one. */
  function startGuide(axis: 'x' | 'y', e: PointerEvent): void {
    e.stopPropagation();
    host.setPointerCapture(e.pointerId);
    drag = { mode: 'guide', axis, pageI: ed.pageIndex, index: null, key: `guide:${Date.now()}` };
  }

  function dragGuide(d: Extract<Drag, { mode: 'guide' }>, s: Point): void {
    const page = ed.doc.pages[d.pageI]!;
    const p = toPage(toWorld(s.x, s.y), d.pageI);
    const pos = Math.round((d.axis === 'x' ? p.x : p.y) * 100) / 100;
    if (d.index === null) {
      const r = addGuide(ed.doc, page.id, { axis: d.axis, pos });
      ed.commit(r.doc, d.key);
      drag = { ...d, index: r.index };
    } else ed.commit(moveGuide(ed.doc, page.id, d.index, pos), d.key);
  }

  /** A guide let go off the page (or on a ruler) is deleted. */
  function dropGuide(d: Extract<Drag, { mode: 'guide' }>, s: Point): void {
    if (d.index === null) return;
    const page = ed.doc.pages[d.pageI]!;
    const g = page.guides?.[d.index];
    if (!g) return;
    const max = g.axis === 'x' ? ed.doc.width : ed.doc.height;
    const onRuler = view.rulers && (g.axis === 'x' ? s.x < RULER : s.y < RULER);
    if (g.pos < 0 || g.pos > max || onRuler) ed.commit(removeGuide(ed.doc, page.id, d.index), d.key);
  }

  // ---- touch: pinch zoom + two-finger pan, long press for the menu, double tap ----
  /** Fingers on the stage (stage px). */
  const touches = new Map<number, Point>();
  let lastTouch = 0;
  /** Two fingers down: the page spot under their midpoint stays under it while they zoom. */
  let pinch: { d0: number; z0: number; local: Point; i: number } | null = null;
  let pressTimer = 0;
  let pressAt: Point | null = null;
  let longPressed = false;
  let lastTap: { t: number; s: Point } | null = null;
  /** iOS opens the keyboard only for a focus inside the tap itself: focus this, then hand over to the editor. */
  let kbProxy = $state<HTMLTextAreaElement>();

  const pair = (): [Point, Point] => [...touches.values()].slice(0, 2) as [Point, Point];
  function startPinch(): void {
    const [a, b] = pair();
    const w = toWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
    const i = pageAt(w);
    stopScrollAnim();
    pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z0: zoom, local: toPage(w, i), i };
  }
  function movePinch(): void {
    if (!pinch || touches.size < 2) return;
    const [a, b] = pair();
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    zoom = clampZoom(pinch.z0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0);
    panX = m.x - pinch.local.x * zoom;
    panY = m.y - (pinch.local.y + pageTop(pinch.i)) * zoom;
    clampPan();
    view.mode = null;
    flashBars();
    syncCurrentPage();
  }
  function cancelPress(): void {
    clearTimeout(pressTimer);
    pressTimer = 0;
    pressAt = null;
  }
  function focusKeyboard(): void {
    if (touchUi) kbProxy?.focus({ preventScroll: true });
  }

  function onPointerDown(e: PointerEvent): void {
    menu = null;
    if (e.button === 2) return;
    touchUi = e.pointerType === 'touch';
    if (touchUi) {
      lastTouch = Date.now();
      touches.set(e.pointerId, localPoint(e));
      if (touches.size >= 2) {
        // a second finger turns whatever the first one started into a pinch
        cancelPress();
        host.setPointerCapture(e.pointerId);
        if (drag && drag.mode !== 'pan' && drag.mode !== 'press') ed.seal();
        drag = null;
        snapShown = null;
        snap = null;
        tip = null;
        if (touches.size === 2) startPinch();
        return;
      }
      longPressed = false;
      pressAt = localPoint(e);
      pressTimer = window.setTimeout(() => {
        pressTimer = 0;
        const at = pressAt;
        pressAt = null;
        if (!at || touches.size !== 1 || drag?.mode === 'draw' || (drag && 'moved' in drag && drag.moved)) return;
        // long press: Canva's element / page menu
        drag = null;
        longPressed = true;
        navigator.vibrate?.(10);
        openMenu(at);
      }, 500);
    }
    if (e.button === 1) e.preventDefault(); // no browser auto-scroll: middle-drag pans
    host.setPointerCapture(e.pointerId);
    const s = localPoint(e);
    if (e.button === 1 || spaceDown) {
      drag = { mode: 'pan', start: s, panX, panY };
      cursor = 'grabbing';
      return;
    }
    if (ed.editingTextId) ed.stopEditing();
    if (ed.editingCell) ed.stopCellEdit();
    const key = `drag:${Date.now()}`;

    if (cropping) {
      const { el, i, frame, img } = cropping;
      const start = cropLocal(el, i, s);
      const ch = cropHandleAt(s);
      if (ch) {
        drag = { mode: ch.kind === 'frame' ? 'crop-frame' : 'crop-scale', el, i, frame, img, start, handle: ch.h, key };
        return;
      }
      if (inBox(img, start)) {
        drag = { mode: 'crop-pan', el, i, frame, img, start, handle: 'nw', key };
        return;
      }
      ed.stopCrop(); // a click outside the image is "Done"
    }
    if (ed.tool && e.button === 0) {
      // freehand drawing: collect points until the pointer comes up
      const w = toWorld(s.x, s.y);
      const pageI = pageAt(w);
      drag = { mode: 'draw', pageI, pts: [toPage(w, pageI)] };
      return;
    }

    const h = handleAt(s);
    if (h) {
      if ((h.h === 'start' || h.h === 'end') && single) drag = { mode: 'lineEnd', id: single.el.id, which: h.h, pageI: single.i, key };
      else if (h.h === 'rot' && single) drag = { mode: 'rotate', pageI: single.i, orig: single.el, key };
      else if (h.h !== 'rot' && h.h !== 'start' && h.h !== 'end') {
        const orig = ed.selected;
        const pageI = selected[0]!.i;
        const box = single ? { x: single.el.x, y: single.el.y, w: single.el.w, h: single.el.h } : union(orig.map((el) => aabb(el)))!;
        drag = { mode: 'resize', handle: h.h, pageI, orig, box, key, shift: e.shiftKey, targets: targetsFor(pageI, ed.selection) };
      }
      return;
    }

    const g = guideAt(s);
    if (g) {
      drag = { mode: 'guide', axis: g.axis, pageI: g.i, index: g.index, key };
      return;
    }

    const hit = elementAt(s);
    if (hit && ed.framePanId === hit.el.id && hit.el.type === 'image') {
      // moving the photo inside its frame
      const el = hit.el, meta = ed.doc.assets[el.asset];
      const crop = el.crop ?? coverCrop(meta?.width ?? el.w, meta?.height ?? el.h, el.w, el.h);
      drag = { mode: 'framePan', id: el.id, start: toWorld(s.x, s.y), crop, key };
      return;
    }
    if (hit?.el.type === 'table') {
      // remember the cell for the properties panel
      const local = rotatePoint(toPage(toWorld(s.x, s.y), hit.i), center(hit.el), -hit.el.rotation);
      const c = tableCellAt(hit.el, local);
      if (c) ed.cell = { id: hit.el.id, ...c };
    }
    if (hit && e.shiftKey) {
      // Shift-click adds or removes an element
      const id = hit.el.id;
      ed.select(ed.selection.includes(id) ? ed.selection.filter((x) => x !== id) : [...ed.selection, id]);
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (onSelection(s, hit?.el ?? null)) {
      // Only what is already selected moves when dragged (Canva).
      const movable = ed.selected.filter((el) => !el.locked);
      const orig = new Map(movable.map((el) => [el.id, { x: el.x, y: el.y }]));
      const box = union(movable.map((el) => aabb(el)));
      const pageI = selected[0]!.i;
      const one = single?.el;
      const click = mod ? 'behind' : one?.type === 'text' && hit?.el.id === one.id && !one.curve ? 'edit' : null;
      drag = { mode: 'move', start: toWorld(s.x, s.y), orig, key, moved: false, pageI, box, targets: targetsFor(pageI, ed.selection), click, client: { x: e.clientX, y: e.clientY }, alt: e.altKey };
      return;
    }
    if (hit) {
      drag = { mode: 'press', start: s, el: hit.el, i: hit.i, mod };
      return;
    }

    // empty space: the page (selects it) or the workspace around it (selects nothing); a drag draws a selection box
    const w = toWorld(s.x, s.y);
    const pageI = pageAt(w);
    const p = toPage(w, pageI);
    const onPage = p.x >= 0 && p.y >= 0 && p.x <= ed.doc.width && p.y <= ed.doc.height;
    if (touchUi) {
      // a finger on empty space scrolls; a tap there selects the page (or nothing)
      drag = { mode: 'pan', start: s, panX, panY, tap: { pageId: onPage ? ed.doc.pages[pageI]!.id : undefined, onPage }, moved: false };
      return;
    }
    if (!e.shiftKey) {
      ed.select([], onPage ? ed.doc.pages[pageI]!.id : undefined);
      ed.pageSelected = onPage;
    }
    drag = { mode: 'marquee', start: s, now: s, pageI, base: e.shiftKey ? ed.selection : [] };
  }

  /** Is screen point `s` on the current selection (an element of it, or inside a multi-selection's box), and can it move? */
  function onSelection(s: Point, hitEl: Element | null): boolean {
    if (!selected.length || !ed.selected.some((el) => !el.locked)) return false;
    if (hitEl && ed.selection.includes(hitEl.id)) return true;
    if (multiBox) return s.x >= multiBox.x && s.x <= multiBox.x + multiBox.w && s.y >= multiBox.y && s.y <= multiBox.y + multiBox.h;
    if (single && single.el.type !== 'line') return contains(single.el, toPage(toWorld(s.x, s.y), single.i));
    return false;
  }

  /**
   * Cmd/Ctrl-click (Canva): the element under the pointer one level deeper —
   * inside a group, the element itself; clicked again, the one behind it.
   */
  function pickBehind(s: Point): void {
    const w = toWorld(s.x, s.y);
    const i = pageAt(w);
    const stack = hitTestAll(ed.doc.pages[i]!, toPage(w, i), 2 / zoom).map((path) => path[path.length - 1]!);
    if (!stack.length) return;
    const k = stack.findIndex((el) => ed.selection.includes(el.id));
    ed.select([stack[k < 0 ? 0 : (k + 1) % stack.length]!.id]);
  }

  /** Where a click into a text box should put the caret, once its editor is up (client px). */
  let caretAt: Point | null = null;

  function onPointerMove(e: PointerEvent): void {
    const s = localPoint(e);
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, s);
      if (pinch) return movePinch();
      if (touches.size > 1) return;
      if (pressAt && Math.hypot(s.x - pressAt.x, s.y - pressAt.y) > 8) cancelPress();
    }
    if (!drag) {
      const h = handleAt(s);
      const ch = cropping ? cropHandleAt(s) : null;
      const g = h || ch ? null : guideAt(s);
      if (ch) cursor = CURSOR[ch.h]!;
      else if (cropping && inBox(cropping.img, cropLocal(cropping.el, cropping.i, s))) cursor = 'move';
      else if (h) cursor = CURSOR[h.h]!;
      else if (g) cursor = g.axis === 'x' ? 'col-resize' : 'row-resize';
      else {
        const hit = elementAt(s);
        ed.hoverId = hit?.el.id ?? null;
        // the move cursor only over what a drag would move (the selection); elsewhere a drag selects
        cursor = spaceDown ? 'grab' : onSelection(s, hit?.el ?? null) ? 'move' : 'default';
      }
      return;
    }
    const w = toWorld(s.x, s.y);
    lastMove = e;
    if ((drag.mode === 'move' || drag.mode === 'resize') && !autoRaf) autoRaf = requestAnimationFrame(autoScroll);
    switch (drag.mode) {
      case 'pan':
        if (drag.tap && !drag.moved) {
          if (Math.hypot(s.x - drag.start.x, s.y - drag.start.y) < 6) return;
          drag.moved = true;
        }
        panX = drag.panX + (s.x - drag.start.x);
        panY = drag.panY + (s.y - drag.start.y);
        clampPan();
        flashBars();
        syncCurrentPage();
        break;
      case 'press': {
        // a drag that starts on an unselected element draws a selection box (Canva)
        if (Math.hypot(s.x - drag.start.x, s.y - drag.start.y) < (touchUi ? 6 : 3)) return;
        if (touchUi) {
          // a finger dragging over an unselected element scrolls (only the selection moves)
          drag = { mode: 'pan', start: drag.start, panX, panY, moved: true };
          onPointerMove(e);
          return;
        }
        ed.select([], ed.doc.pages[drag.i]!.id);
        drag = { mode: 'marquee', start: drag.start, now: drag.start, pageI: drag.i, base: [] };
        onPointerMove(e);
        return;
      }
      case 'move': {
        let dx = w.x - drag.start.x, dy = w.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx * zoom, dy * zoom) < (touchUi ? 6 : 3)) return;
        if (!drag.moved && drag.alt) {
          // Alt/Option-drag: move a copy, leave the original (Canva)
          const r = duplicateElements(ed.doc, [...drag.orig.keys()], 0);
          ed.commit(r.doc, drag.key);
          ed.select(r.ids);
          drag.orig = new Map(ed.selected.map((el) => [el.id, { x: el.x, y: el.y }]));
        }
        drag.moved = true;
        if (drag.box && !free(e)) {
          const r = snapMove({ ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy }, drag.targets, SNAP_PX / zoom);
          dx += r.dx;
          dy += r.dy;
          snapShown = { i: drag.pageI, guides: r.guides, gaps: r.gaps };
        } else snapShown = null;
        const orig = drag.orig;
        ed.commit(updateElements(ed.doc, [...orig.keys()], (el) => {
          const patch: Partial<LineElement> = { x: orig.get(el.id)!.x + dx, y: orig.get(el.id)!.y + dy };
          // a moved connector lets go of elements that stay behind
          if (el.type === 'line') {
            const keep = (end: LineElement['start']) => (end.attach && !orig.has(end.attach.elementId) ? (({ attach: _, ...rest }) => rest)(end) : end);
            patch.start = keep(el.start);
            patch.end = keep(el.end);
          }
          return patch;
        }), drag.key);
        break;
      }
      case 'lineEnd': {
        const p = toPage(w, drag.pageI);
        const target = snapTarget(drag.id, drag.pageI, p);
        snap = target;
        const attach: Attach | null = target?.point ? { elementId: target.el.id, point: target.point } : null;
        const at = target?.point ? boxPoint(target.el, target.point) : p;
        ed.setLineEnd(drag.id, drag.which, at, attach, drag.key);
        break;
      }
      case 'draw': {
        const p = toPage(w, drag.pageI);
        const last = drag.pts[drag.pts.length - 1]!;
        if (Math.hypot(p.x - last.x, p.y - last.y) * zoom >= 1.5) drag = { ...drag, pts: [...drag.pts, p] };
        break;
      }
      case 'framePan': {
        const hit = findElement(ed.doc, drag.id);
        if (hit?.element.type !== 'image') break;
        const el = hit.element, c = drag.crop;
        // the whole image is el.w / c.w px wide on the page
        const fx = (w.x - drag.start.x) / (el.w / c.w), fy = (w.y - drag.start.y) / (el.h / c.h);
        const crop = { ...c, x: Math.max(0, Math.min(1 - c.w, c.x - fx)), y: Math.max(0, Math.min(1 - c.h, c.y - fy)) };
        ed.commit(updateElements(ed.doc, [el.id], { crop }), drag.key);
        break;
      }
      case 'resize': {
        resizeTo(drag, toPage(w, drag.pageI), e.shiftKey, free(e));
        const now = drag.orig.length === 1 ? findElement(ed.doc, drag.orig[0]!.id)?.element : null;
        const b = now ?? union(ed.selected.map((el) => aabb(el)));
        if (b) tip = { x: s.x, y: s.y + 28, text: `w ${Math.round(b.w)} × h ${Math.round(b.h)}` };
        break;
      }
      case 'guide':
        dragGuide(drag, s);
        break;
      case 'crop-pan':
      case 'crop-frame':
      case 'crop-scale': {
        const d = drag;
        const p = cropLocal(d.el, d.i, s);
        let patch;
        if (d.mode === 'crop-pan') patch = { crop: cropFromBoxes(d.frame, panImage(d.frame, d.img, p.x - d.start.x, p.y - d.start.y)) };
        else if (d.mode === 'crop-scale') patch = { crop: cropFromBoxes(d.frame, scaleImage(d.frame, d.img, d.handle as 'nw', p)) };
        else patch = cropPatch(d.el, resizeFrame(d.frame, d.img, d.handle, p, 8 / zoom), d.img);
        ed.commit(updateElements(ed.doc, [d.el.id], patch), d.key);
        break;
      }
      case 'rotate': {
        const el = drag.orig;
        const c = center(el);
        // The handle sits below the box, so pointing straight down means 0°.
        let deg = (angleTo(c, toPage(w, drag.pageI)) + 180) % 360;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        else for (const snap of [0, 45, 90, 135, 180, 225, 270, 315, 360]) if (Math.abs(deg - snap) < 3) deg = snap;
        ed.commit(updateElements(ed.doc, [el.id], { rotation: deg % 360 }), drag.key);
        tip = { x: s.x, y: s.y + 28, text: `${Math.round(deg % 360)}°` };
        break;
      }
      case 'marquee': {
        drag = { ...drag, now: s };
        const a = toPage(toWorld(drag.start.x, drag.start.y), drag.pageI), b = toPage(w, drag.pageI);
        const r = normalizeRect(a, b);
        const page = ed.doc.pages[drag.pageI]!;
        const ids = marqueePick(page, r).map((el) => el.id);
        ed.select([...new Set([...drag.base, ...ids])], page.id);
        break;
      }
    }
  }

  /** Snap a resized (unrotated) box's moving edges; shows the guides. */
  function snapBox(d: Extract<Drag, { mode: 'resize' }>, box: Rect, keepRatio: boolean, off: boolean): Rect {
    if (off) {
      snapShown = null;
      return box;
    }
    const r = snapResize(box, d.handle, d.targets, SNAP_PX / zoom, keepRatio);
    snapShown = { i: d.pageI, guides: r.guides, gaps: [] };
    return r.rect;
  }

  function resizeTo(d: Extract<Drag, { mode: 'resize' }>, p: Point, shift: boolean, off = false): void {
    if (d.orig.length === 1) {
      const el = d.orig[0]!;
      const corner = d.handle.length === 2;
      const keepRatio = childrenOf(el) ? true : el.type === 'text' ? corner : el.type === 'image' ? corner !== shift : shift;
      let box = resizeBox(el, d.handle, p, { keepRatio, min: 8 / zoom });
      if (!el.rotation) box = snapBox(d, box, keepRatio && corner, off);
      let patch: Partial<Element> = box;
      if (el.type === 'text') {
        if (corner) {
          const s = box.w / el.w;
          const style = { ...el.style, fontSize: Math.max(4, Math.round(el.style.fontSize * s * 10) / 10) };
          patch = { ...box, style, h: ed.renderer.textHeight({ ...el, ...box, style }) } as Partial<Element>;
        } else {
          const h = ed.renderer.textHeight({ ...el, w: box.w });
          // keep the box anchored where resizeBox put it, adjust height only
          patch = { x: box.x, y: box.y + (box.h - h) / 2, w: box.w, h };
        }
      }
      ed.commit(updateElements(ed.doc, [el.id], patch as never), d.key);
      return;
    }
    // multi-select: scale every element from the fixed corner of the union box
    const b = d.box;
    const nb = snapBox(d, resizeBox({ ...b, rotation: 0 }, d.handle, p, { keepRatio: true, min: 8 / zoom }), true, off);
    const sx = nb.w / b.w, sy = nb.h / b.h;
    const map = new Map(d.orig.map((el) => [el.id, el]));
    ed.commit(updateElements(ed.doc, [...map.keys()], (cur) => {
      const el = map.get(cur.id)!;
      const patch: Record<string, unknown> = { x: nb.x + (el.x - b.x) * sx, y: nb.y + (el.y - b.y) * sy, w: el.w * sx, h: el.h * sy };
      if (el.type === 'line') {
        patch.start = { ...el.start, x: el.start.x * sx, y: el.start.y * sy };
        patch.end = { ...el.end, x: el.end.x * sx, y: el.end.y * sy };
      }
      if (el.type === 'text') {
        const style = { ...el.style, fontSize: Math.max(4, el.style.fontSize * sx) };
        patch.style = style;
        patch.h = ed.renderer.textHeight({ ...el, w: el.w * sx, style });
      }
      return patch as never;
    }), d.key);
  }

  /** The element a dragged line end is over, and the anchor it snaps to (if near one). */
  function snapTarget(lineId: string, pageI: number, p: Point): { el: Element; i: number; point: { x: number; y: number } | null } | null {
    const page = ed.doc.pages[pageI]!;
    const reach = 14 / zoom;
    for (let k = page.elements.length - 1; k >= 0; k--) {
      const el = page.elements[k]!;
      if (el.id === lineId || el.type === 'line' || el.hidden) continue;
      const near = ANCHORS.map((a) => ({ a, d: Math.hypot(boxPoint(el, a).x - p.x, boxPoint(el, a).y - p.y) })).sort((x, y) => x.d - y.d)[0]!;
      if (near.d <= reach) return { el, i: pageI, point: near.a };
      if (contains(el, p, reach)) return { el, i: pageI, point: null };
    }
    return null;
  }

  function onPointerUp(e: PointerEvent): void {
    if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
    let dbl = false;
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      lastTouch = Date.now();
      if (pinch || touches.size) {
        if (touches.size < 2) {
          pinch = null;
          // the finger still down carries on scrolling
          const rest = [...touches.values()][0];
          drag = rest ? { mode: 'pan', start: rest, panX, panY, moved: true } : null;
        }
        return;
      }
      cancelPress();
      if (longPressed) {
        longPressed = false;
        drag = null;
        // the click the browser makes from this touch must not close the menu it opened
        const eat = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
        addEventListener('click', eat, { capture: true, once: true });
        setTimeout(() => removeEventListener('click', eat, { capture: true }), 600);
        return;
      }
      if (drag?.mode === 'pan' && drag.tap && !drag.moved) {
        ed.select([], drag.tap.pageId);
        ed.pageSelected = drag.tap.onPage;
      }
      // a second tap on the same spot is a double-click (crop, step into a group, edit text)
      const s = localPoint(e);
      if (drag?.mode === 'press' || (drag?.mode === 'move' && !drag.moved)) {
        dbl = !!lastTap && Date.now() - lastTap.t < 350 && Math.hypot(s.x - lastTap.s.x, s.y - lastTap.s.y) < 30;
        lastTap = dbl ? null : { t: Date.now(), s };
      } else lastTap = null;
      if (dbl) {
        if (drag?.mode === 'press') ed.select([drag.el.id]);
        drag = null;
        dblAt(s);
        return;
      }
    }
    if (autoRaf) cancelAnimationFrame(autoRaf);
    autoRaf = 0;
    lastMove = null;
    if (drag?.mode === 'pan') cursor = spaceDown ? 'grab' : 'default';
    if (drag?.mode === 'guide') dropGuide(drag, localPoint(e));
    if (drag?.mode === 'draw') ed.addStroke(ed.doc.pages[drag.pageI]!.id, drag.pts);
    if (drag?.mode === 'press') {
      // a click: Cmd/Ctrl picks inside groups / behind, else the element under the pointer
      if (drag.mod) pickBehind(drag.start);
      else ed.select([drag.el.id]);
    }
    if (drag?.mode === 'move' && !drag.moved) {
      if (drag.click === 'behind') pickBehind(localPoint(e));
      else if (drag.click === 'edit' && single) {
        // a click on a selected text box edits it, caret where you clicked (Canva)
        caretAt = drag.client;
        focusKeyboard();
        ed.startEditing(single.el.id);
      }
    }
    snapShown = null;
    snap = null;
    tip = null;
    if (drag) ed.seal();
    drag = null;
  }

  function onDblClick(e: MouseEvent): void {
    // fingers: onPointerUp spots double taps itself
    if (Date.now() - lastTouch < 800) return;
    dblAt(localPoint(e));
  }

  function dblAt(s: Point): void {
    if (ed.croppingId) {
      ed.stopCrop();
      return;
    }
    if (ed.tool) return;
    const hit = elementAt(s);
    if (!hit) return;
    // a group: step in and select the child under the pointer
    if (childrenOf(hit.el)) {
      const next = hit.path[hit.path.indexOf(hit.el) + 1];
      if (next) ed.select([next.id]);
    } else if (hit.el.type === 'text') {
      // double-click: edit with all the text selected
      caretAt = null;
      if (ed.editingTextId === hit.el.id && editorNode) {
        const all = document.createRange();
        all.selectNodeContents(editorNode);
        document.getSelection()?.removeAllRanges();
        document.getSelection()?.addRange(all);
        const r = getSelectionOffsets(editorNode);
        if (r) ed.textSel = r; // now, not on the next selectionchange
      } else {
        focusKeyboard();
        ed.startEditing(hit.el.id);
      }
    }
    else if (hit.el.type === 'table') {
      const local = rotatePoint(toPage(toWorld(s.x, s.y), hit.i), center(hit.el), -hit.el.rotation);
      const c = tableCellAt(hit.el, local);
      if (c) ed.editCell(hit.el.id, c.r, c.c);
    } else if (hit.el.type === 'image' && hit.el.mask) {
      // a frame: move the photo inside its shape
      if (hit.el.asset && !hit.el.locked) {
        ed.select([hit.el.id]);
        ed.framePanId = hit.el.id;
      }
    } else if (hit.el.type === 'image' || hit.el.type === 'video') ed.startCrop(hit.el.id);
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    menu = null;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vh : 1;
    let dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      // pinch (small deltas) or ⌘/Ctrl + wheel: zoom around the pointer, then centre / clamp
      zoomAt(zoom * Math.exp(-dy * (Math.abs(dy) < 50 ? 0.01 : 0.002)), localPoint(e));
      syncCurrentPage();
      return;
    }
    // Shift + wheel scrolls sideways (only does anything once the page is wider than the workspace)
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    scrollBy(dx, dy);
  }

  // ---- drag & drop from the side panel and the desktop ----
  function dropPoint(e: DragEvent): Point {
    const s = localPoint(e);
    const w = toWorld(s.x, s.y);
    const i = pageAt(w);
    ed.select([], ed.doc.pages[i]!.id);
    return toPage(w, i);
  }

  async function onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    const at = dropPoint(e);
    // an image dropped on a frame fills it
    const page = ed.doc.pages.find((p) => p.id === ed.pageId)!;
    const under = hitTest(page, at);
    const frameId = under && isFrame(under) && !under.locked ? under.id : null;
    const data = e.dataTransfer?.getData('application/x-digital-canvas');
    if (data) {
      if (await handlePanelDrop(ed, data, at, frameId)) return; // side-panel content (Elements, Text, Photos, Videos, Audio)
      const d = JSON.parse(data) as { kind: 'shape'; shape: ShapeKind } | { kind: 'text'; preset: keyof typeof TEXT_PRESETS } | { kind: 'asset'; id: string } | { kind: 'photo'; photo: Photo };
      if (d.kind === 'shape') ed.addShape(d.shape, at);
      else if (d.kind === 'text') ed.addText(d.preset, at);
      else if (d.kind === 'photo') {
        const got = await fetchPhoto(d.photo).catch(() => null);
        const id = got && (await ed.addAsset(got.bytes, got.mime, attribution(d.photo)));
        if (id) frameId ? ed.fillFrame(frameId, id) : ed.addImageAsset(id, at);
      } else if (frameId) ed.fillFrame(frameId, d.id);
      else ed.addImageAsset(d.id, at);
      return;
    }
    for (const f of e.dataTransfer?.files ?? []) {
      if (frameId && f.type.startsWith('image/')) {
        const id = await ed.addAsset(new Uint8Array(await f.arrayBuffer()), f.type, f.name);
        if (id) ed.fillFrame(frameId, id);
      } else await ed.addMediaFile(f, at);
    }
  }

  // ---- keyboard: space to pan ----
  function onKey(e: KeyboardEvent, down: boolean): void {
    if (e.code !== 'Space') return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    if (down) e.preventDefault();
    spaceDown = down;
    if (!drag) cursor = down ? 'grab' : 'default';
  }

  // ---- text editing ----
  const editing = $derived.by(() => {
    if (!ed.editingTextId) return null;
    const hit = findElement(ed.doc, ed.editingTextId);
    if (!hit || hit.element.type !== 'text') return null;
    return { el: hit.element, i: pageIndexOf(hit.page.id) };
  });

  let editorNode: HTMLDivElement | null = null;

  /** Keep the text being edited in view when the workspace shrinks (the phone keyboard opened). */
  function revealEditing(): void {
    const t = editing;
    if (!t || !vh) return;
    const ys = screenCorners(t.el, t.i).map((p) => p.y);
    const top = Math.min(...ys), bottom = Math.max(...ys), pad = 16;
    let dy = 0;
    if (bottom > vh - pad) dy = vh - pad - bottom;
    if (top + dy < pad) dy = pad - top;
    if (!dy) return;
    stopScrollAnim();
    panY += dy;
    clampPan();
  }

  /** A collapsed range at client point `at` inside the editor, if the point is over its text. */
  function caretRange(node: HTMLElement, at: Point): Range | null {
    const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
    let r: Range | null = null;
    if (d.caretPositionFromPoint) {
      const pos = d.caretPositionFromPoint(at.x, at.y);
      if (pos) { r = document.createRange(); r.setStart(pos.offsetNode, pos.offset); }
    } else r = document.caretRangeFromPoint?.(at.x, at.y) ?? null;
    if (!r || !node.contains(r.startContainer)) return null;
    r.collapse(true);
    return r;
  }

  /**
   * The rich text editor. It builds its DOM once, then only on a style change
   * from outside (`textRev`) or a zoom change, keeping the caret/selection.
   */
  function richEditor(node: HTMLDivElement, p: { id: string; rev: number; zoom: number }) {
    const el = () => {
      const hit = findElement(ed.doc, p.id);
      return hit?.element.type === 'text' ? hit.element : null;
    };
    const first = el();
    if (first) renderRich(node, first, p.zoom);
    editorNode = node;
    node.focus();
    // a click puts the caret there; a double-click (or Enter) selects everything, like Canva
    const at = caretAt;
    caretAt = null;
    const range = at ? caretRange(node, at) : null;
    const all = range ?? document.createRange();
    if (!range) all.selectNodeContents(node);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(all);
    const track = () => {
      const r = getSelectionOffsets(node);
      if (r) ed.textSel = r;
    };
    track();
    document.addEventListener('selectionchange', track);
    return {
      update(next: { id: string; rev: number; zoom: number }) {
        const changed = next.rev !== p.rev || next.zoom !== p.zoom;
        p = next;
        const e = el();
        if (!changed || !e) return;
        const sel = ed.textSel;
        renderRich(node, e, p.zoom);
        const active = document.activeElement;
        // put the selection back unless the user is typing in another field
        if (sel && (active === node || !active || active === document.body || active.tagName === 'BUTTON')) {
          setSelectionOffsets(node, sel.start, sel.end);
          if (active !== node) node.focus({ preventScroll: true });
        }
      },
      destroy() {
        if (editorNode === node) editorNode = null;
        document.removeEventListener('selectionchange', track);
      },
    };
  }

  function onRichInput(e: Event, id: string): void {
    const node = e.currentTarget as HTMLDivElement;
    const f = flatten(node);
    ed.setRich(id, f.text, f.runs);
    const r = getSelectionOffsets(node);
    if (r) ed.textSel = r;
    // Enter, deleting a whole line, etc. leave DOM the browser made up: rebuild it our way
    // (keeping the caret) so its line heights stay the canvas's.
    const hit = findElement(ed.doc, id);
    if (!(e as InputEvent).isComposing && hit?.element.type === 'text' && needsRebuild(node)) {
      renderRich(node, hit.element, zoom);
      if (r) setSelectionOffsets(node, r.start, r.end);
    }
  }

  function onRichKey(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') { e.preventDefault(); ed.stopEditing(); }
    else if (textShortcut(ed, e)) { /* handled */ }
    else if (mod && (k === 'b' || k === 'i' || k === 'u')) {
      // our own styling, not the browser's <b>/<i>/<u>
      e.preventDefault();
      const st = ed.textStyle ?? {};
      const prop = k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline';
      ed.updateTextStyle({ [prop]: !st[prop] });
      ed.seal();
    }
    e.stopPropagation();
  }

  function onRichPaste(e: ClipboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const t = e.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, t);
  }

  function onRichBlur(e: FocusEvent): void {
    // Keep editing while the user works in the properties panel (styling the selection).
    const to = e.relatedTarget as HTMLElement | null;
    if (to?.closest('[data-text-tools]')) return;
    ed.stopEditing();
  }

  // ---- tables: the picked cell and in-place cell editing ----
  const cellBox = $derived.by(() => {
    const c = ed.editingCell ?? ed.cell;
    if (!c) return null;
    const hit = findElement(ed.doc, c.id);
    if (hit?.element.type !== 'table' || !hit.element.cells[c.r]?.[c.c]) return null;
    const t = hit.element, i = pageIndexOf(hit.page.id);
    const r = tableCellRect(t, c.r, c.c);
    const tl = rotatePoint({ x: r.x, y: r.y }, center(t), t.rotation);
    // the cell's corners turn with the table, around the table's centre
    const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => {
      const q = rotatePoint({ x: x!, y: y! }, center(t), t.rotation);
      return toScreen(q.x, q.y + pageTop(i));
    });
    return { t, cell: t.cells[c.r]![c.c]!, rect: r, pos: toScreen(tl.x, tl.y + pageTop(i)), pts, ...c };
  });

  /** The stroke being drawn, in screen coordinates. */
  const ink = $derived.by(() => {
    if (drag?.mode !== 'draw') return '';
    const top = pageTop(drag.pageI);
    return drag.pts.map((p, k) => { const q = toScreen(p.x, p.y + top); return `${k ? 'L' : 'M'}${q.x} ${q.y}`; }).join('') + (drag.pts.length === 1 ? 'l0.01 0' : '');
  });

  function cellEditor(node: HTMLTextAreaElement) {
    node.focus();
    node.select();
  }

  function onCellKey(e: KeyboardEvent): void {
    e.stopPropagation();
    const c = ed.editingCell;
    if (!c) return;
    if (e.key === 'Escape') { e.preventDefault(); ed.stopCellEdit(); }
    else if (e.key === 'Tab') {
      // Tab / Shift+Tab walks the cells
      e.preventDefault();
      const hit = findElement(ed.doc, c.id);
      if (hit?.element.type !== 'table') return;
      const cols = hit.element.cols.length, n = hit.element.rows.length * cols;
      const k = (c.r * cols + c.c + (e.shiftKey ? n - 1 : 1)) % n;
      ed.stopCellEdit();
      ed.editCell(c.id, Math.floor(k / cols), k % cols);
    }
  }

  // ---- page toolbars ----
  const pageBars = $derived(
    ed.doc.pages.map((p, i) => ({ id: p.id, i, pos: toScreen(0, pageTop(i)) })).filter(({ pos }) => pos.y > -40 && pos.y < vh + 10),
  );
  const addPagePos = $derived(toScreen(0, pageTop(ed.doc.pages.length - 1) + ed.doc.height));
  const poly = (pts: Point[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

  /** A line in page i's coordinates, on screen. */
  function seg(i: number, axis: 'x' | 'y', pos: number, from: number, to: number) {
    const a = axis === 'x' ? toScreen(pos, pageTop(i) + from) : toScreen(from, pageTop(i) + pos);
    const b = axis === 'x' ? toScreen(pos, pageTop(i) + to) : toScreen(to, pageTop(i) + pos);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }
  /** Equal-spacing hint: the gap, drawn across at `at`. */
  const gapSeg = (i: number, g: GapHint) => seg(i, g.axis === 'x' ? 'y' : 'x', g.at, g.from, g.to);
  const visiblePages = $derived(ed.doc.pages.map((p, i) => ({ p, i, o: toScreen(0, pageTop(i)) })).filter(({ o }) => o.y < vh && o.y + ed.doc.height * zoom > 0));
  const margin = $derived(safeMargin(ed.doc));
  const rulerOrigin = $derived(toScreen(0, pageTop(ed.pageIndex)));
  /** Canva's small pill above the selection: lock, duplicate, delete, more. */
  const mini = $derived.by(() => {
    if (drag || ed.editingTextId || ed.croppingId || ed.editingCell || !selected.length) return null;
    const pts = single ? (single.el.type === 'line' ? lineOutline(single.el, single.i) : screenCorners(single.el, single.i)) : multiBox ? [{ x: multiBox.x, y: multiBox.y }, { x: multiBox.x + multiBox.w, y: multiBox.y + multiBox.h }] : null;
    if (!pts) return null;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, top = Math.min(...ys), bottom = Math.max(...ys);
    // above the element; below it when there is no room (the rotate handle sits below, so leave it space)
    const y = top - 56 >= 4 ? top - 56 : bottom + 52;
    if (cx < 0 || cx > vw || y > vh - 40) return null;
    return { x: Math.max(80, Math.min(vw - 80, cx)), y, locked: selected.some(({ el }) => el.locked) };
  });
  /** Screen px of print bleed shown around each page (page bars sit outside it). */
  const bleedPx = $derived(view.bleed ? ed.doc.bleed * zoom : 0);
</script>

<svelte:window onkeydown={(e) => onKey(e, true)} onkeyup={(e) => onKey(e, false)} />

<div
  class="stage"
  bind:this={host}
  style="cursor:{ed.tool ? 'crosshair' : ed.framePanId ? 'move' : cursor}"
  role="application"
  aria-label="Design canvas"
  data-testid="stage"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  ondblclick={onDblClick}
  onwheel={onWheel}
  oncontextmenu={onContextMenu}
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
  onpointerleave={() => (ed.hoverId = null)}
>
  <canvas bind:this={canvasEl} data-testid="canvas"></canvas>
  <textarea class="kbproxy" bind:this={kbProxy} tabindex="-1" aria-hidden="true"></textarea>

  <svg class="overlay" width={vw} height={vh}>
    {#each visiblePages as { p, i, o } (p.id)}
      {#if p.hidden}
        <rect x={o.x} y={o.y} width={ed.doc.width * zoom} height={ed.doc.height * zoom} class="hiddenpage" />
      {/if}
      {#if p.id === ed.pageId && ed.pageSelected && !ed.selection.length}
        <rect x={o.x - 2} y={o.y - 2} width={ed.doc.width * zoom + 4} height={ed.doc.height * zoom + 4} class="curpage" data-testid="current-page" />
      {/if}
      {#if view.bleed && ed.doc.bleed}
        <rect x={o.x} y={o.y} width={ed.doc.width * zoom} height={ed.doc.height * zoom} class="trim" data-testid="trim-line" />
      {/if}
      {#if view.margins}
        <rect x={o.x + margin * zoom} y={o.y + margin * zoom} width={(ed.doc.width - 2 * margin) * zoom} height={(ed.doc.height - 2 * margin) * zoom} class="margin" data-testid="margin-line" />
      {/if}
      {#if view.rulers}
        {#each p.guides ?? [] as g, gi (gi)}
          <line {...seg(i, g.axis, g.pos, 0, g.axis === 'x' ? ed.doc.height : ed.doc.width)} class="guide" />
        {/each}
      {/if}
    {/each}
    {#if snapShown}
      {#each snapShown.guides as g, gi (gi)}
        <line {...seg(snapShown.i, g.axis, g.pos, g.from, g.to)} class="snap" />
      {/each}
      {#each snapShown.gaps as g, gi (gi)}
        {@const l = gapSeg(snapShown.i, g)}
        <line {...l} class="snap gap" />
        <circle cx={l.x1} cy={l.y1} r="2" class="snap-dot" /><circle cx={l.x2} cy={l.y2} r="2" class="snap-dot" />
        <!-- the gap's size, like Canva's spacing label -->
        <g class="gaplabel" transform="translate({(l.x1 + l.x2) / 2},{(l.y1 + l.y2) / 2})" data-testid="gap-label">
          <rect x="-18" y="-10" width="36" height="20" rx="10" />
          <text text-anchor="middle" dy="4">{Math.round(g.to - g.from)}</text>
        </g>
      {/each}
    {/if}
    {#if hover}
      {#if hover.el.type === 'line'}
        <polyline points={poly(lineOutline(hover.el, hover.i))} class="hover" />
      {:else}
        <polygon points={poly(screenCorners(hover.el, hover.i))} class="hover" />
      {/if}
    {/if}
    {#each selected as { el, i } (el.id)}
      {#if el.type === 'line'}
        <polyline points={poly(lineOutline(el, i))} class="sel" class:locked={el.locked} />
      {:else}
        <polygon points={poly(screenCorners(el, i))} class="sel" class:locked={el.locked} />
      {/if}
    {/each}
    {#if multiBox}
      <rect x={multiBox.x} y={multiBox.y} width={multiBox.w} height={multiBox.h} class="sel dashed" />
    {/if}
    {#if cellBox && !ed.editingCell && ed.selection.includes(cellBox.id)}
      <polygon points={poly(cellBox.pts)} class="cell" />
    {/if}
    {#if snap}
      <polygon points={poly(screenCorners(snap.el, snap.i))} class="snap" />
      {#each ANCHORS as a}
        {@const q = boxPoint(snap.el, a)}
        {@const sp = toScreen(q.x, q.y + pageTop(snap.i))}
        <circle cx={sp.x} cy={sp.y} r={snap.point && snap.point.x === a.x && snap.point.y === a.y ? 6 : 4} class="anchor" class:on={snap.point && snap.point.x === a.x && snap.point.y === a.y} />
      {/each}
    {/if}
    {#if ink && ed.tool}
      <path d={ink} class="ink" stroke={ed.tool.color} stroke-width={ed.tool.size * zoom} opacity={ed.tool.opacity} />
    {/if}
    {#each handles as h (h.h)}
      {#if h.h === 'start' || h.h === 'end'}
        <circle cx={h.x} cy={h.y} r={touchUi ? 10 : 7} class="handle lineend" data-testid="handle-{h.h}" />
      {:else if h.h === 'rot'}
        <g class="rot" transform="translate({h.x},{h.y}) scale({touchUi ? 1.3 : 1})" data-testid="handle-rot">
          <circle r="10" />
          <path d="M-4 -1a4.5 4.5 0 1 0 1.5-3.5M-2.5-4.5h-2.5v-2.5" transform="translate(1,2)" />
        </g>
      {:else if h.h.length === 2}
        <circle cx={h.x} cy={h.y} r={touchUi ? 9 : 5.5} class="handle" data-testid="handle-{h.h}" />
      {:else}
        <rect x={h.x - (h.h === 'e' || h.h === 'w' ? 3.5 : 9)} y={h.y - (h.h === 'e' || h.h === 'w' ? 9 : 3.5)} width={h.h === 'e' || h.h === 'w' ? 7 : 18} height={h.h === 'e' || h.h === 'w' ? 18 : 7} rx="3.5" class="handle" />
      {/if}
    {/each}
    {#if cropping}
      {@const { el, i, frame, img } = cropping}
      <polygon points={poly(boxScreen(el, i, img))} class="cropimg" data-testid="crop-image" />
      <polygon points={poly(boxScreen(el, i, frame))} class="cropframe" data-testid="crop-frame" />
      {#each cropHandles as h (h.kind + h.h)}
        {#if h.kind === 'image'}
          <circle cx={h.x} cy={h.y} r="6" class="handle imgcorner" data-testid="crop-img-{h.h}" />
        {:else}
          <rect x={h.x - 6} y={h.y - 6} width="12" height="12" rx="2" class="handle cropcorner" data-testid="crop-{h.h}" />
        {/if}
      {/each}
    {/if}
    {#if drag?.mode === 'marquee'}
      {@const r = normalizeRect(drag.start, drag.now)}
      <rect x={r.x} y={r.y} width={r.w} height={r.h} class="marquee" />
    {/if}
  </svg>

  {#if view.rulers}
    <Rulers {zoom} origin={rulerOrigin} width={ed.doc.width} height={ed.doc.height} unit={ed.doc.unit} {vw} {vh} onstart={startGuide} />
  {/if}

  {#each pageBars as bar (bar.id)}
    {@const pg = ed.doc.pages[bar.i]!}
    {@const pageLocked = pg.elements.length > 0 && pg.elements.every((e) => e.locked)}
    <div class="pagebar" class:narrow={ed.doc.width * zoom < 360} role="toolbar" aria-label="Page actions" tabindex="-1" data-testid="page-header" style="left:{bar.pos.x}px;top:{bar.pos.y - 34 - bleedPx}px;width:{ed.doc.width * zoom}px" onpointerdown={(e) => e.stopPropagation()}>
      <div class="pagetitle" class:current={bar.id === ed.pageId}>
        <button class="pagename" onclick={() => { ed.select([], bar.id); ed.pageSelected = true; }}>Page {bar.i + 1}</button>
        <span class="dash">-</span>
        <input class="pagetitle-input" placeholder="Add page title" value={pg.name ?? ''} aria-label="Page {bar.i + 1} title" data-testid="page-title"
          onfocus={() => ed.select([], bar.id)}
          onchange={(e) => { ed.updatePage({ name: (e.currentTarget as HTMLInputElement).value.trim() || undefined }, null, bar.id); ed.seal(); }}
          onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur(); }} />
      </div>
      <div class="pagebtns">
        <button title="Move up" aria-label="Move page up" disabled={bar.i === 0} onclick={() => ed.movePage(bar.id, -1)}><Icon name="up" size={18} /></button>
        <button title="Move down" aria-label="Move page down" disabled={bar.i === ed.doc.pages.length - 1} onclick={() => ed.movePage(bar.id, 1)}><Icon name="down" size={18} /></button>
        <button title={pg.hidden ? 'Show page' : 'Hide page'} aria-label={pg.hidden ? 'Show page' : 'Hide page'} class:on={pg.hidden} data-testid="page-hide" onclick={() => { ed.updatePage({ hidden: pg.hidden ? undefined : true }, null, bar.id); ed.seal(); }}><Icon name={pg.hidden ? 'eyeoff' : 'eye'} size={18} /></button>
        <button title={pageLocked ? 'Unlock page' : 'Lock page'} aria-label={pageLocked ? 'Unlock page' : 'Lock page'} class:on={pageLocked} disabled={!pg.elements.length} data-testid="page-lock" onclick={() => { ed.update({ locked: !pageLocked }, null, pg.elements.map((e) => e.id)); ed.seal(); }}><Icon name={pageLocked ? 'lock' : 'unlock'} size={18} /></button>
        <button title="Duplicate page" aria-label="Duplicate page" onclick={() => ed.duplicatePage(bar.id)}><Icon name="copy" size={18} /></button>
        <button title="Delete page" aria-label="Delete page" disabled={ed.doc.pages.length === 1} onclick={() => ed.removePage(bar.id)}><Icon name="trash" size={18} /></button>
        <button title="Add page" aria-label="Add page after" onclick={() => { ed.select([], bar.id); ed.addPage(); }}><Icon name="addpage" size={18} /></button>
      </div>
    </div>
  {/each}

  {#if tip}
    <div class="tip" data-testid="drag-tip" style="left:{tip.x}px;top:{tip.y}px">{tip.text}</div>
  {/if}

  {#if mini}
    <div class="mini" role="toolbar" aria-label="Quick actions" tabindex="-1" data-testid="mini-toolbar" style="left:{mini.x}px;top:{mini.y}px" onpointerdown={(e) => e.stopPropagation()}>
      <button title={mini.locked ? 'Unlock' : 'Lock'} aria-label={mini.locked ? 'Unlock' : 'Lock'} onclick={() => { ed.update({ locked: !mini!.locked }); ed.seal(); }}><Icon name={mini.locked ? 'lock' : 'unlock'} size={18} /></button>
      <button title="Duplicate (⌘D)" aria-label="Duplicate" onclick={() => ed.duplicateSelection()}><Icon name="copy" size={18} /></button>
      <button title="Delete" aria-label="Delete" onclick={() => ed.deleteSelection()}><Icon name="trash" size={18} /></button>
      <button title="More" aria-label="More" data-more onclick={() => (ui.pop = ui.pop === 'more' ? null : 'more')}><Icon name="more" size={18} /></button>
    </div>
  {/if}

  {#if addPagePos.y < vh}
    <button class="addpage" data-testid="add-page" style="left:{addPagePos.x}px;top:{addPagePos.y + 16 + bleedPx}px;width:{ed.doc.width * zoom}px" onpointerdown={(e) => e.stopPropagation()} onclick={() => { ed.select([], ed.doc.pages[ed.doc.pages.length - 1]!.id); ed.addPage(); }}>
      <Icon name="plus" size={16} /> Add page
    </button>
  {/if}

  {#if cropping}
    {@const pts = [...boxScreen(cropping.el, cropping.i, cropping.frame), ...boxScreen(cropping.el, cropping.i, cropping.img)]}
    <div class="cropbar" style="left:{(Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2}px;top:{Math.max(...pts.map((p) => p.y)) + 16}px"
      role="toolbar" aria-label="Crop" tabindex="-1" onpointerdown={(e) => e.stopPropagation()}>
      <button class="btn" onclick={() => ed.update({ crop: undefined })}>Reset</button>
      <button class="btn primary" data-testid="crop-done" onclick={() => ed.stopCrop()}>Done</button>
    </div>
  {/if}

  {#if editing}
    {@const el = editing.el}
    {@const p = toScreen(el.x, el.y + pageTop(editing.i))}
    <div
      class="text-edit"
      class:curved={!!el.curve}
      data-testid="text-editor"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      tabindex="0"
      spellcheck="true"
      use:richEditor={{ id: el.id, rev: ed.textRev, zoom }}
      class:ghost={!el.curve}
      style="left:{p.x}px;top:{p.y}px;width:{el.w * zoom}px;{el.curve ? `min-height:${el.h * zoom}px` : `height:${el.h * zoom}px`};transform:rotate({el.rotation}deg);
        text-align:{el.style.align};font-size:0;line-height:0;color:{el.style.color}"
      oninput={(e) => onRichInput(e, el.id)}
      onpointerdown={(e) => e.stopPropagation()}
      onkeydown={onRichKey}
      onpaste={onRichPaste}
      onblur={onRichBlur}
    ></div>
  {/if}

  {#if ed.editingCell && cellBox}
    {@const c = cellBox}
    {@const st = { ...c.t.style, ...c.cell.style }}
    {@const pad = Math.min(c.t.padding, c.rect.w / 3, c.rect.h / 3) * zoom}
    <textarea
      class="cell-edit"
      data-testid="cell-editor"
      use:cellEditor
      value={c.cell.text}
      style="left:{c.pos.x}px;top:{c.pos.y}px;width:{c.rect.w * zoom}px;height:{c.rect.h * zoom}px;padding:{pad}px;transform:rotate({c.t.rotation}deg);
        background:{c.cell.fill ?? '#ffffff'};text-align:{st.align};color:{st.color};
        font:{st.italic ? 'italic' : 'normal'} {st.bold ? 700 : 400} {st.fontSize * zoom}px/{st.lineHeight} '{st.fontFamily}', Inter, sans-serif"
      oninput={(e) => ed.setCellText(c.id, c.r, c.c, (e.currentTarget as HTMLTextAreaElement).value)}
      onpointerdown={(e) => e.stopPropagation()}
      onkeydown={onCellKey}
      onblur={(e) => { if (!(e.relatedTarget as HTMLElement | null)?.closest('[data-text-tools]')) ed.stopCellEdit(); }}
    ></textarea>
  {/if}

  {#if scrollbars.x}
    {@const b = scrollbars.x}
    <div class="sb x" class:show={barsShown} data-testid="hscroll" tabindex="-1" role="scrollbar" aria-orientation="horizontal" aria-controls="stage" aria-valuenow={Math.round(((b.hi - panX) / (b.hi - b.lo)) * 100)}
      onpointerdown={(e) => barDown('x', e)} onpointermove={barMove} onpointerup={barUp} onpointercancel={barUp}>
      <div class="thumb" style="left:{b.at}px;width:{b.size}px"></div>
    </div>
  {/if}
  {#if scrollbars.y}
    {@const b = scrollbars.y}
    <div class="sb y" class:show={barsShown} data-testid="vscroll" tabindex="-1" role="scrollbar" aria-orientation="vertical" aria-controls="stage" aria-valuenow={Math.round(((b.hi - panY) / (b.hi - b.lo)) * 100)}
      onpointerdown={(e) => barDown('y', e)} onpointermove={barMove} onpointerup={barUp} onpointercancel={barUp}>
      <div class="thumb" style="top:{b.at}px;height:{b.size}px"></div>
    </div>
  {/if}

  {#if menu}
    <CanvasMenu {ed} x={menu.x} y={menu.y} kind={menu.kind} pageId={menu.pageId} {vw} {vh} onclose={() => (menu = null)} />
  {/if}
</div>

<style>
  .cell { fill: rgba(124, 92, 255, .08); stroke: var(--accent); stroke-width: 2; }
  .snap { fill: rgba(124, 92, 255, .06); stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 4 3; }
  .anchor { fill: #fff; stroke: var(--accent); stroke-width: 2; }
  .anchor.on { fill: var(--accent); }
  .ink { fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .lineend { stroke: var(--accent); stroke-width: 2; }
  .cell-edit {
    position: absolute; transform-origin: 0 0; margin: 0; border: 0; resize: none; overflow: hidden; box-sizing: border-box;
    outline: 2px solid var(--accent); background: #fff; white-space: pre-wrap; user-select: text; -webkit-user-select: text;
  }
  .sb { position: absolute; z-index: 6; opacity: 0; transition: opacity .25s; pointer-events: auto; }
  .sb.x { left: 0; right: 12px; bottom: 0; height: 12px; }
  .sb.y { top: 0; bottom: 12px; right: 0; width: 12px; }
  .sb.show, .sb:hover, .sb:active { opacity: 1; transition: opacity .05s; }
  .sb .thumb { position: absolute; border-radius: 99px; background: rgba(127, 127, 140, .55); }
  .sb.x .thumb { top: 3px; height: 6px; }
  .sb.y .thumb { left: 3px; width: 6px; }
  .sb:hover .thumb, .sb:active .thumb { background: rgba(127, 127, 140, .8); }
  .sb.x:hover .thumb, .sb.x:active .thumb { top: 2px; height: 8px; }
  .sb.y:hover .thumb, .sb.y:active .thumb { left: 2px; width: 8px; }
  .stage { position: relative; flex: 1; overflow: hidden; background: var(--stage); touch-action: none; user-select: none; }
  .kbproxy { position: absolute; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; border: 0; padding: 0; resize: none; pointer-events: none; font-size: 16px; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .overlay { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
  .hover { fill: none; stroke: var(--accent); stroke-width: 2; }
  .sel { fill: none; stroke: var(--accent); stroke-width: 2; }
  .sel.locked { stroke: #f59e0b; }
  .dashed { stroke-dasharray: 5 4; stroke-width: 1.5; }
  .handle { fill: #fff; stroke: rgba(15, 17, 21, .25); stroke-width: 1; filter: drop-shadow(0 1px 2px rgba(0,0,0,.25)); }
  /* phones: Android WebView (124, GPU-less) drops small filtered SVG shapes entirely; an outline reads as well */
  :global(.m-editor) .handle { filter: none; stroke: rgba(15, 17, 21, .4); stroke-width: 1.2; }
  .rot circle { fill: #fff; stroke: rgba(15, 17, 21, .2); filter: drop-shadow(0 1px 2px rgba(0,0,0,.25)); }
  .rot path { fill: none; stroke: var(--ink); stroke-width: 1.6; stroke-linecap: round; }
  .cropframe { fill: none; stroke: #fff; stroke-width: 2; filter: drop-shadow(0 0 1px rgba(0,0,0,.6)); }
  .cropimg { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 6 4; }
  .cropcorner { fill: #fff; }
  .imgcorner { fill: var(--accent); stroke: #fff; stroke-width: 2; }
  .cropbar { position: absolute; transform: translateX(-50%); display: flex; gap: 6px; padding: 6px; background: var(--pop); border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.18); pointer-events: auto; }
  .marquee { fill: rgba(124, 92, 255, .08); stroke: var(--accent); stroke-width: 1; }
  .snap { stroke: #ff2ec4; stroke-width: 1; }
  .snap.gap { stroke-width: 1.5; }
  .snap-dot { fill: #ff2ec4; }
  .gaplabel rect { fill: #ff2ec4; }
  .gaplabel text { fill: #fff; font: 600 11px/1 Inter, system-ui, sans-serif; }
  .tip { position: absolute; transform: translateX(-50%); padding: 4px 10px; border-radius: 999px; background: #1b1d22; color: #fff; font: 600 12px/1.3 Inter, system-ui, sans-serif; white-space: nowrap; pointer-events: none; z-index: 5; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
  .guide { stroke: #00b8c4; stroke-width: 1; }
  .trim { fill: none; stroke: #e5484d; stroke-width: 1; stroke-dasharray: 6 4; }
  .margin { fill: none; stroke: #7c5cff; stroke-width: 1; stroke-dasharray: 3 3; opacity: .8; }
  /* phones: the page actions live in the Pages sheet */
  :global(.m-editor) .pagebar { display: none; }
  .pagebar { position: absolute; display: flex; align-items: center; justify-content: space-between; gap: 6px; height: 30px; pointer-events: auto; color: var(--bar-ink); }
  .pagetitle { display: flex; align-items: center; min-width: 0; flex: 1; font-size: 14px; overflow: hidden; }
  .pagename { border: 0; background: none; font-weight: 600; color: inherit; font-size: 14px; padding: 4px 0; white-space: nowrap; }
  .pagetitle.current .pagename { color: var(--ink); }
  .dash { margin: 0 4px; font-weight: 600; }
  .pagetitle-input { flex: 1; min-width: 40px; height: 26px; border: 1px solid transparent; border-radius: 6px; background: none; color: var(--ink); font-size: 14px; padding: 0 4px; }
  .pagetitle-input::placeholder { color: var(--muted); }
  .pagetitle-input:hover { border-color: var(--line); }
  .pagetitle-input:focus { outline: none; border-color: var(--accent); }
  .pagebar.narrow .dash, .pagebar.narrow .pagetitle-input { display: none; }
  .pagebar.narrow .pagebtns button { width: 24px; }
  .pagebtns { display: flex; gap: 0; flex-shrink: 0; }
  .pagebtns button { width: 30px; height: 30px; display: grid; place-items: center; border: 0; background: none; border-radius: 6px; color: inherit; }
  .pagebtns button:hover:not(:disabled) { background: var(--hover); color: var(--ink); }
  .pagebtns button.on { color: var(--accent); }
  .pagebtns button:disabled { opacity: .3; cursor: default; }
  .curpage { fill: none; stroke: var(--accent); stroke-width: 2; }
  .hiddenpage { fill: rgba(127, 127, 127, .55); }
  .mini { position: absolute; transform: translateX(-50%); display: flex; gap: 2px; padding: 4px; background: var(--pop); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); pointer-events: auto; z-index: 4; }
  .mini button { width: 32px; height: 32px; display: grid; place-items: center; border: 0; background: none; border-radius: 7px; color: inherit; }
  .mini button:hover { background: var(--hover); }
  .addpage { position: absolute; height: 40px; display: flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-radius: 8px; background: var(--hover); font-weight: 600; color: var(--bar-ink); }
  .addpage:hover { background: var(--accent-soft); color: var(--accent); }
  .text-edit {
    position: absolute; transform-origin: center; margin: 0; padding: 0; border: 0; resize: none; overflow: visible;
    background: transparent; outline: 2px solid var(--accent); outline-offset: 0; caret-color: var(--accent); white-space: pre-wrap; word-break: break-word;
    user-select: text; -webkit-user-select: text; box-sizing: border-box;
  }
  /* the canvas draws the letters; the editor shows only the caret and the selection */
  .text-edit.ghost, .text-edit.ghost :global(*) { color: transparent !important; text-decoration-color: transparent !important; }
  .text-edit.ghost::selection, .text-edit.ghost :global(*::selection) { background: rgba(124, 92, 255, .32); color: transparent; }
  .text-edit.curved { white-space: pre; display: flex; flex-direction: column; justify-content: center; background: rgba(255,255,255,.85); }
  .text-edit :global(div) { margin: 0; }
</style>
