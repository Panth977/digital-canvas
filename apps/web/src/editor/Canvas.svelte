<script lang="ts">
  import { onMount } from 'svelte';
  import type { Surface } from 'canvaskit-wasm';
  import {
    aabb, angleTo, center, corners, cropFromBoxes, cropOf, cropPatch, findElement, hitTest, imageBox, intersects, localToPage, normalizeRect, pageToLocal,
    panImage, resizeBox, resizeFrame, rotatePoint, scaleImage, union, updateElements,
    type CropHandle, type Element, type Handle, type ImageElement, type Point, type Rect, type ShapeKind, type VideoElement,
  } from '@digital-canvas/scene';
  import type { EditorState } from '../lib/editor.svelte.ts';
  import { TEXT_PRESETS } from '../lib/editor.svelte.ts';
  import Icon from '../lib/Icon.svelte';
  import { flatten, getSelectionOffsets, renderRich, setSelectionOffsets } from '../lib/richtext.ts';

  let { ed, zoom = $bindable(1), fitRequest = 0 }: { ed: EditorState; zoom?: number; fitRequest?: number } = $props();

  const STAGE = [0.914, 0.918, 0.937, 1];
  const HANDLE_HIT = 11;

  let host: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;
  let surface: Surface | null = null;
  let vw = $state(0), vh = $state(0);
  let panX = $state(0), panY = $state(0);
  let dpr = 1;
  let drawQueued = false;
  let fitted = false;

  // ---- layout: pages stacked vertically in world space ----
  const gap = $derived(Math.max(48, ed.doc.height * 0.06));
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
  function localPoint(e: PointerEvent | MouseEvent | DragEvent): Point {
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Screen-space corners of an element on page i. */
  function screenCorners(el: Rect & { rotation: number }, i: number): Point[] {
    return corners(el).map((p) => toScreen(p.x, p.y + pageTop(i)));
  }

  // ---- view ----
  export function fit(): void {
    if (!vw || !vh) return;
    const W = ed.doc.width, H = ed.doc.height;
    zoom = Math.max(0.02, Math.min(4, Math.min((vw - 96) / W, (vh - 120) / H)));
    panX = (vw - W * zoom) / 2;
    panY = 64 - pageTop(ed.pageIndex) * zoom;
    queueDraw();
  }

  function zoomAt(next: number, s: Point): void {
    next = Math.max(0.02, Math.min(8, next));
    const w = toWorld(s.x, s.y);
    zoom = next;
    panX = s.x - w.x * zoom;
    panY = s.y - w.y * zoom;
    clampPan();
  }

  export function setZoom(next: number): void {
    zoomAt(next, { x: vw / 2, y: vh / 2 });
  }

  function clampPan(): void {
    const W = ed.doc.width * zoom;
    const total = (pageTop(ed.doc.pages.length - 1) + ed.doc.height) * zoom;
    panX = Math.min(vw - 80, Math.max(80 - W, panX));
    panY = Math.min(vh - 80, Math.max(80 - total, panY));
  }

  $effect(() => {
    void fitRequest;
    if (fitRequest) fit();
  });

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
    const skip = ed.editingTextId ? new Set([ed.editingTextId]) : undefined;
    const shadow = new ck.Paint();
    shadow.setColor(ck.Color4f(0.06, 0.07, 0.12, 0.14));
    shadow.setMaskFilter(ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, 6, true));
    ed.doc.pages.forEach((page, i) => {
      const s = toScreen(0, pageTop(i));
      const w = ed.doc.width * zoom, h = ed.doc.height * zoom;
      if (s.y > vh || s.y + h < 0 || s.x > vw || s.x + w < 0) return; // off screen
      c.drawRect(ck.XYWHRect(s.x, s.y + 2, w, h), shadow);
      c.save();
      c.translate(s.x, s.y);
      c.scale(zoom, zoom);
      ed.renderer.drawPage(c, ed.doc, page, { skip });
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
    void ed.doc; void ed.editingTextId; void ed.frame; void cropping; void zoom; void panX; void panY; void vw; void vh;
    queueDraw();
  });

  onMount(() => {
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      vw = r.width;
      vh = r.height;
      makeSurface();
      if (!fitted && vw > 0) {
        fitted = true;
        fit();
      }
      queueDraw();
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
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
    if (!ed.hoverId || ed.selection.includes(ed.hoverId)) return null;
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

  interface HandlePos { h: Handle | 'rot'; x: number; y: number }

  const handles = $derived.by((): HandlePos[] => {
    if (ed.editingTextId || ed.croppingId) return [];
    if (single) {
      const { el, i } = single;
      if (el.locked) return [];
      const [tl, tr, br, bl] = screenCorners(el, i) as [Point, Point, Point, Point];
      const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const all: HandlePos[] = [
        { h: 'nw', ...tl }, { h: 'ne', ...tr }, { h: 'se', ...br }, { h: 'sw', ...bl },
        { h: 'e', ...mid(tr, br) }, { h: 'w', ...mid(tl, bl) },
      ];
      const small = el.w * zoom < 28 || el.h * zoom < 28;
      if (el.type !== 'text' && !small) all.push({ h: 'n', ...mid(tl, tr) }, { h: 's', ...mid(bl, br) });
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

  const CURSOR: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab' };

  // ---- pointer interaction ----
  type Drag =
    | { mode: 'move'; start: Point; orig: Map<string, { x: number; y: number }>; key: string; moved: boolean }
    | { mode: 'resize'; handle: Handle; pageI: number; orig: Element[]; box: Rect; key: string; shift: boolean }
    | { mode: 'rotate'; pageI: number; orig: Element; key: string }
    | { mode: 'marquee'; start: Point; now: Point; pageI: number; base: string[] }
    | { mode: 'pan'; start: Point; panX: number; panY: number }
    | { mode: 'crop-pan' | 'crop-frame' | 'crop-scale'; el: Picture; i: number; frame: Rect; img: Rect; start: Point; handle: CropHandle; key: string };

  let drag = $state.raw<Drag | null>(null);
  let cursor = $state('default');
  let spaceDown = false;

  function handleAt(s: Point): HandlePos | null {
    for (const h of handles) if (Math.hypot(h.x - s.x, h.y - s.y) <= HANDLE_HIT) return h;
    return null;
  }

  function elementAt(s: Point): { el: Element; i: number } | null {
    const w = toWorld(s.x, s.y);
    const i = pageAt(w);
    const page = ed.doc.pages[i]!;
    const p = toPage(w, i);
    if (p.x < 0 || p.y < 0 || p.x > ed.doc.width || p.y > ed.doc.height) {
      // outside the page: elements may still stick out
      const el = hitTest(page, p, 2 / zoom);
      return el ? { el, i } : null;
    }
    const el = hitTest(page, p, 2 / zoom);
    return el ? { el, i } : null;
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button === 2) return;
    host.setPointerCapture(e.pointerId);
    const s = localPoint(e);
    if (e.button === 1 || spaceDown) {
      drag = { mode: 'pan', start: s, panX, panY };
      cursor = 'grabbing';
      return;
    }
    if (ed.editingTextId) ed.stopEditing();
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

    const h = handleAt(s);
    if (h) {
      if (h.h === 'rot' && single) drag = { mode: 'rotate', pageI: single.i, orig: single.el, key };
      else if (h.h !== 'rot') {
        const orig = ed.selected;
        const pageI = selected[0]!.i;
        const box = single ? { x: single.el.x, y: single.el.y, w: single.el.w, h: single.el.h } : union(orig.map((el) => aabb(el)))!;
        drag = { mode: 'resize', handle: h.h, pageI, orig, box, key, shift: e.shiftKey };
      }
      return;
    }

    const hit = elementAt(s);
    if (hit) {
      const id = hit.el.id;
      if (e.shiftKey) {
        ed.select(ed.selection.includes(id) ? ed.selection.filter((x) => x !== id) : [...ed.selection, id]);
        return;
      }
      if (!ed.selection.includes(id)) ed.select([id]);
      const orig = new Map(ed.selected.filter((el) => !el.locked).map((el) => [el.id, { x: el.x, y: el.y }]));
      drag = { mode: 'move', start: toWorld(s.x, s.y), orig, key, moved: false };
      return;
    }

    const w = toWorld(s.x, s.y);
    const pageI = pageAt(w);
    if (!e.shiftKey) ed.select([], ed.doc.pages[pageI]!.id);
    drag = { mode: 'marquee', start: s, now: s, pageI, base: e.shiftKey ? ed.selection : [] };
  }

  function onPointerMove(e: PointerEvent): void {
    const s = localPoint(e);
    if (!drag) {
      const h = handleAt(s);
      const ch = cropping ? cropHandleAt(s) : null;
      if (ch) cursor = CURSOR[ch.h]!;
      else if (cropping && inBox(cropping.img, cropLocal(cropping.el, cropping.i, s))) cursor = 'move';
      else if (h) cursor = CURSOR[h.h]!;
      else {
        const hit = elementAt(s);
        ed.hoverId = hit?.el.id ?? null;
        cursor = hit ? (hit.el.locked ? 'default' : 'move') : spaceDown ? 'grab' : 'default';
      }
      return;
    }
    const w = toWorld(s.x, s.y);
    switch (drag.mode) {
      case 'pan':
        panX = drag.panX + (s.x - drag.start.x);
        panY = drag.panY + (s.y - drag.start.y);
        break;
      case 'move': {
        const dx = w.x - drag.start.x, dy = w.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx * zoom, dy * zoom) < 3) return;
        drag.moved = true;
        const orig = drag.orig;
        ed.commit(updateElements(ed.doc, [...orig.keys()], (el) => ({ x: orig.get(el.id)!.x + dx, y: orig.get(el.id)!.y + dy })), drag.key);
        break;
      }
      case 'resize':
        resizeTo(drag, toPage(w, drag.pageI), e.shiftKey);
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
        break;
      }
      case 'marquee': {
        drag = { ...drag, now: s };
        const a = toPage(toWorld(drag.start.x, drag.start.y), drag.pageI), b = toPage(w, drag.pageI);
        const r = normalizeRect(a, b);
        const page = ed.doc.pages[drag.pageI]!;
        const ids = page.elements.filter((el) => !el.hidden && intersects(aabb(el), r)).map((el) => el.id);
        ed.select([...new Set([...drag.base, ...ids])], page.id);
        break;
      }
    }
  }

  function resizeTo(d: Extract<Drag, { mode: 'resize' }>, p: Point, shift: boolean): void {
    if (d.orig.length === 1) {
      const el = d.orig[0]!;
      const corner = d.handle.length === 2;
      const keepRatio = el.type === 'text' ? corner : el.type === 'image' ? corner !== shift : shift;
      const box = resizeBox(el, d.handle, p, { keepRatio, min: 8 / zoom });
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
    const nb = resizeBox({ ...b, rotation: 0 }, d.handle, p, { keepRatio: true, min: 8 / zoom });
    const sx = nb.w / b.w, sy = nb.h / b.h;
    const map = new Map(d.orig.map((el) => [el.id, el]));
    ed.commit(updateElements(ed.doc, [...map.keys()], (cur) => {
      const el = map.get(cur.id)!;
      const patch: Record<string, unknown> = { x: nb.x + (el.x - b.x) * sx, y: nb.y + (el.y - b.y) * sy, w: el.w * sx, h: el.h * sy };
      if (el.type === 'text') {
        const style = { ...el.style, fontSize: Math.max(4, el.style.fontSize * sx) };
        patch.style = style;
        patch.h = ed.renderer.textHeight({ ...el, w: el.w * sx, style });
      }
      return patch as never;
    }), d.key);
  }

  function onPointerUp(e: PointerEvent): void {
    if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
    if (drag?.mode === 'pan') cursor = spaceDown ? 'grab' : 'default';
    if (drag) ed.seal();
    drag = null;
  }

  function onDblClick(e: MouseEvent): void {
    if (ed.croppingId) {
      ed.stopCrop();
      return;
    }
    const hit = elementAt(localPoint(e));
    if (hit?.el.type === 'text') ed.startEditing(hit.el.id);
    else if (hit?.el.type === 'image' || hit?.el.type === 'video') ed.startCrop(hit.el.id);
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(zoom * Math.exp(-e.deltaY * 0.0025), localPoint(e));
    } else {
      panX -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      panY -= e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      clampPan();
    }
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
    const data = e.dataTransfer?.getData('application/x-digital-canvas');
    if (data) {
      const d = JSON.parse(data) as { kind: 'shape'; shape: ShapeKind } | { kind: 'text'; preset: keyof typeof TEXT_PRESETS } | { kind: 'asset'; id: string };
      if (d.kind === 'shape') ed.addShape(d.shape, at);
      else if (d.kind === 'text') ed.addText(d.preset, at);
      else ed.addImageAsset(d.id, at);
      return;
    }
    for (const f of e.dataTransfer?.files ?? []) await ed.addMediaFile(f, at);
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
    node.focus();
    // select everything, like double-click in Canva
    const all = document.createRange();
    all.selectNodeContents(node);
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
  }

  function onRichKey(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') { e.preventDefault(); ed.stopEditing(); }
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

  // ---- page toolbars ----
  const pageBars = $derived(
    ed.doc.pages.map((p, i) => ({ id: p.id, i, pos: toScreen(0, pageTop(i)) })).filter(({ pos }) => pos.y > -40 && pos.y < vh + 10),
  );
  const addPagePos = $derived(toScreen(0, pageTop(ed.doc.pages.length - 1) + ed.doc.height));
  const poly = (pts: Point[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');
</script>

<svelte:window onkeydown={(e) => onKey(e, true)} onkeyup={(e) => onKey(e, false)} />

<div
  class="stage"
  bind:this={host}
  style="cursor:{cursor}"
  role="application"
  aria-label="Design canvas"
  data-testid="stage"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  ondblclick={onDblClick}
  onwheel={onWheel}
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
  onpointerleave={() => (ed.hoverId = null)}
>
  <canvas bind:this={canvasEl} data-testid="canvas"></canvas>

  <svg class="overlay" width={vw} height={vh}>
    {#if hover}
      <polygon points={poly(screenCorners(hover.el, hover.i))} class="hover" />
    {/if}
    {#each selected as { el, i } (el.id)}
      <polygon points={poly(screenCorners(el, i))} class="sel" class:locked={el.locked} />
    {/each}
    {#if multiBox}
      <rect x={multiBox.x} y={multiBox.y} width={multiBox.w} height={multiBox.h} class="sel dashed" />
    {/if}
    {#each handles as h (h.h)}
      {#if h.h === 'rot'}
        <g class="rot" transform="translate({h.x},{h.y})">
          <circle r="10" />
          <path d="M-4 -1a4.5 4.5 0 1 0 1.5-3.5M-2.5-4.5h-2.5v-2.5" transform="translate(1,2)" />
        </g>
      {:else if h.h.length === 2}
        <circle cx={h.x} cy={h.y} r="5.5" class="handle" />
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

  {#each pageBars as bar (bar.id)}
    <div class="pagebar" role="toolbar" aria-label="Page actions" tabindex="-1" style="left:{bar.pos.x}px;top:{bar.pos.y - 34}px;width:{ed.doc.width * zoom}px" onpointerdown={(e) => e.stopPropagation()}>
      <button class="pagename" class:current={bar.id === ed.pageId} onclick={() => ed.select([], bar.id)}>Page {bar.i + 1}</button>
      <div class="pagebtns">
        <button title="Move up" aria-label="Move page up" disabled={bar.i === 0} onclick={() => ed.movePage(bar.id, -1)}><Icon name="up" size={16} /></button>
        <button title="Move down" aria-label="Move page down" disabled={bar.i === ed.doc.pages.length - 1} onclick={() => ed.movePage(bar.id, 1)}><Icon name="down" size={16} /></button>
        <button title="Duplicate page" aria-label="Duplicate page" onclick={() => ed.duplicatePage(bar.id)}><Icon name="copy" size={16} /></button>
        <button title="Delete page" aria-label="Delete page" disabled={ed.doc.pages.length === 1} onclick={() => ed.removePage(bar.id)}><Icon name="trash" size={16} /></button>
        <button title="Add page" aria-label="Add page after" onclick={() => { ed.select([], bar.id); ed.addPage(); }}><Icon name="plus" size={16} /></button>
      </div>
    </div>
  {/each}

  {#if addPagePos.y < vh}
    <button class="addpage" data-testid="add-page" style="left:{addPagePos.x}px;top:{addPagePos.y + 16}px;width:{ed.doc.width * zoom}px" onpointerdown={(e) => e.stopPropagation()} onclick={() => { ed.select([], ed.doc.pages[ed.doc.pages.length - 1]!.id); ed.addPage(); }}>
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
      style="left:{p.x}px;top:{p.y}px;width:{el.w * zoom}px;min-height:{el.h * zoom}px;transform:rotate({el.rotation}deg);
        text-align:{el.style.align};opacity:{el.opacity};line-height:{el.style.lineHeight};
        font:{el.style.italic ? 'italic' : 'normal'} {el.style.bold ? 700 : 400} {el.style.fontSize * zoom}px/{el.style.lineHeight} '{el.style.fontFamily}', Inter, sans-serif;color:{el.style.color}"
      oninput={(e) => onRichInput(e, el.id)}
      onpointerdown={(e) => e.stopPropagation()}
      onkeydown={onRichKey}
      onpaste={onRichPaste}
      onblur={onRichBlur}
    ></div>
  {/if}
</div>

<style>
  .stage { position: relative; flex: 1; overflow: hidden; background: var(--stage); touch-action: none; user-select: none; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .overlay { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
  .hover { fill: none; stroke: var(--accent); stroke-width: 1.5; opacity: .7; }
  .sel { fill: none; stroke: var(--accent); stroke-width: 2; }
  .sel.locked { stroke: #f59e0b; }
  .dashed { stroke-dasharray: 5 4; stroke-width: 1.5; }
  .handle { fill: #fff; stroke: rgba(15, 17, 21, .25); stroke-width: 1; filter: drop-shadow(0 1px 2px rgba(0,0,0,.25)); }
  .rot circle { fill: #fff; stroke: rgba(15, 17, 21, .2); filter: drop-shadow(0 1px 2px rgba(0,0,0,.25)); }
  .rot path { fill: none; stroke: var(--ink); stroke-width: 1.6; stroke-linecap: round; }
  .cropframe { fill: none; stroke: #fff; stroke-width: 2; filter: drop-shadow(0 0 1px rgba(0,0,0,.6)); }
  .cropimg { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 6 4; }
  .cropcorner { fill: #fff; }
  .imgcorner { fill: var(--accent); stroke: #fff; stroke-width: 2; }
  .cropbar { position: absolute; transform: translateX(-50%); display: flex; gap: 6px; padding: 6px; background: #fff; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.18); pointer-events: auto; }
  .marquee { fill: rgba(124, 92, 255, .08); stroke: var(--accent); stroke-width: 1; }
  .pagebar { position: absolute; display: flex; align-items: center; justify-content: space-between; height: 30px; pointer-events: auto; }
  .pagename { border: 0; background: none; font-weight: 600; color: var(--muted); font-size: 13px; padding: 4px 6px; border-radius: 6px; }
  .pagename.current { color: var(--ink); }
  .pagebtns { display: flex; gap: 2px; }
  .pagebtns button { width: 28px; height: 28px; display: grid; place-items: center; border: 0; background: none; border-radius: 6px; color: var(--ink-2); }
  .pagebtns button:hover:not(:disabled) { background: rgba(0,0,0,.07); }
  .pagebtns button:disabled { opacity: .3; cursor: default; }
  .addpage { position: absolute; height: 40px; display: flex; align-items: center; justify-content: center; gap: 6px; border: 1.5px dashed #c5c8d2; border-radius: 8px; background: rgba(255,255,255,.6); font-weight: 600; color: var(--ink-2); }
  .addpage:hover { background: #fff; border-color: var(--accent); color: var(--accent); }
  .text-edit {
    position: absolute; transform-origin: center; margin: 0; padding: 0; border: 0; resize: none; overflow: hidden;
    background: transparent; outline: 2px solid var(--accent); outline-offset: 0; caret-color: var(--accent); white-space: pre-wrap; word-break: break-word;
    user-select: text; -webkit-user-select: text; box-sizing: border-box;
  }
  .text-edit.curved { white-space: pre; display: flex; flex-direction: column; justify-content: center; background: rgba(255,255,255,.85); }
  .text-edit :global(div) { margin: 0; }
</style>
