<script lang="ts">
  import { onMount } from 'svelte';
  import type { Surface } from 'canvaskit-wasm';
  import {
    aabb, angleTo, center, corners, findElement, hitTest, intersects, normalizeRect, resizeBox, rotatePoint, union, updateElements,
    ANCHORS, boxPoint, contains, coverCrop, isFrame, lineEnds, lineRoute, routePoints, tableCellAt, tableCellRect,
    type Attach, type Element, type Handle, type LineElement, type Point, type Rect, type ShapeKind,
  } from '@digital-canvas/scene';
  import { fetchPhoto, attribution, type Photo } from '../lib/stock.ts';
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

  /** Screen points along a line's route (for its outline). */
  function lineOutline(el: LineElement, i: number): Point[] {
    return routePoints(lineRoute(el), 16).map((p) => rotatePoint(p, center(el), el.rotation)).map((p) => toScreen(p.x, p.y + pageTop(i)));
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
    c.restore();
    surface.flush();
  }

  $effect(() => {
    // Redraw whenever anything visible changes.
    void ed.doc; void ed.editingTextId; void ed.frame; void zoom; void panX; void panY; void vw; void vh;
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

  interface HandlePos { h: Handle | 'rot' | 'start' | 'end'; x: number; y: number }

  const handles = $derived.by((): HandlePos[] => {
    if (ed.editingTextId || ed.framePanId) return [];
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

  const CURSOR: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab', start: 'crosshair', end: 'crosshair' };

  // ---- pointer interaction ----
  type Drag =
    | { mode: 'move'; start: Point; orig: Map<string, { x: number; y: number }>; key: string; moved: boolean }
    | { mode: 'resize'; handle: Handle; pageI: number; orig: Element[]; box: Rect; key: string; shift: boolean }
    | { mode: 'rotate'; pageI: number; orig: Element; key: string }
    | { mode: 'marquee'; start: Point; now: Point; pageI: number; base: string[] }
    | { mode: 'pan'; start: Point; panX: number; panY: number }
    | { mode: 'lineEnd'; id: string; which: 'start' | 'end'; pageI: number; key: string }
    | { mode: 'draw'; pageI: number; pts: Point[] }
    | { mode: 'framePan'; id: string; start: Point; crop: { x: number; y: number; w: number; h: number }; key: string };

  let drag = $state.raw<Drag | null>(null);
  /** While dragging a line's end: the element it would stick to, and the spot. */
  let snap = $state.raw<{ el: Element; i: number; point: { x: number; y: number } | null } | null>(null);
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
    if (ed.editingCell) ed.stopCellEdit();
    const key = `drag:${Date.now()}`;

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
        drag = { mode: 'resize', handle: h.h, pageI, orig, box, key, shift: e.shiftKey };
      }
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
    if (hit) {
      const id = hit.el.id;
      if (hit.el.type === 'table') {
        // remember the cell for the properties panel
        const local = rotatePoint(toPage(toWorld(s.x, s.y), hit.i), center(hit.el), -hit.el.rotation);
        const c = tableCellAt(hit.el, local);
        if (c) ed.cell = { id, ...c };
      }
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
      if (h) cursor = CURSOR[h.h]!;
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
      case 'resize':
        resizeTo(drag, toPage(w, drag.pageI), e.shiftKey);
        break;
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
    if (drag?.mode === 'pan') cursor = spaceDown ? 'grab' : 'default';
    if (drag?.mode === 'draw') ed.addStroke(ed.doc.pages[drag.pageI]!.id, drag.pts);
    snap = null;
    if (drag) ed.seal();
    drag = null;
  }

  function onDblClick(e: MouseEvent): void {
    if (ed.tool) return;
    const s = localPoint(e);
    const hit = elementAt(s);
    if (hit?.el.type === 'text') ed.startEditing(hit.el.id);
    else if (hit?.el.type === 'table') {
      const local = rotatePoint(toPage(toWorld(s.x, s.y), hit.i), center(hit.el), -hit.el.rotation);
      const c = tableCellAt(hit.el, local);
      if (c) ed.editCell(hit.el.id, c.r, c.c);
    } else if (hit && isFrame(hit.el) && hit.el.asset && !hit.el.locked) {
      ed.select([hit.el.id]);
      ed.framePanId = hit.el.id;
    }
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
    // an image dropped on a frame fills it
    const page = ed.doc.pages.find((p) => p.id === ed.pageId)!;
    const under = hitTest(page, at);
    const frameId = under && isFrame(under) && !under.locked ? under.id : null;
    const data = e.dataTransfer?.getData('application/x-digital-canvas');
    if (data) {
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
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
  onpointerleave={() => (ed.hoverId = null)}
>
  <canvas bind:this={canvasEl} data-testid="canvas"></canvas>

  <svg class="overlay" width={vw} height={vh}>
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
        <circle cx={h.x} cy={h.y} r="7" class="handle lineend" data-testid="handle-{h.h}" />
      {:else if h.h === 'rot'}
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
