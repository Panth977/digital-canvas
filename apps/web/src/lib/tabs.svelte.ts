/**
 * Design tabs (Canva's desktop app): several designs open in one window.
 *
 * The route stays the source of truth: `#/d/<id>` is the active tab, `#/`
 * is Home. Every way of opening a design (Home, Projects panel, Drive "Open
 * with", a deep link) goes through the router, so any editor route opens or
 * focuses its tab.
 *
 * Only the active editor is mounted, so background tabs never draw (no
 * CanvasKit surface, no rAF). Their EditorState (doc, undo history,
 * selection, autosave) stays in memory, with the chrome around it (side
 * panel, zoom and scroll) kept as snapshots and given back when the tab is
 * shown again. At most MAX_LIVE editors stay alive; older tabs are saved,
 * disposed and reloaded from storage when reactivated.
 */
import type { ProjectStore } from '@digital-canvas/storage';
import type { EditorState } from './editor.svelte.ts';
import type { FitMode } from './view.svelte.ts';
import type { ColorTarget, Panel, RailTab } from './ui.svelte.ts';
import { router } from './router.svelte.ts';
import { MAX_LIVE, afterClose, cycle, nth, parseSaved, reorder, toEvict, type DesignTab } from './tabmodel.ts';

const KEY = 'dc.tabs';

/** The canvas viewport of a tab (see Canvas.svelte). */
export interface ViewSnap {
  zoom: number;
  panX: number;
  panY: number;
  mode: FitMode | null;
  vw: number;
  vh: number;
}

/** Editor chrome of a tab (see ui.svelte.ts). */
export interface UISnap {
  panel: Panel | null;
  color: ColorTarget | null;
  lastRail: RailTab;
  positionTab: 'arrange' | 'layers';
  pagesStrip: boolean;
  gridView: boolean;
  notes: boolean;
}

/** What a tab keeps while it is not shown. */
export interface Session {
  ed: EditorState | null;
  view: ViewSnap | null;
  ui: UISnap | null;
  used: number;
}

class Tabs {
  list = $state<DesignTab[]>(parseSaved(localStorage.getItem(KEY)));
  /** "+" asked Home to open its "Create a design" menu. */
  createRequested = $state(false);
  /** Number of editors alive in memory (for tests and the console). */
  liveCount = $state(0);
  private sessions = new Map<string, Session>();
  private clock = 0;
  /**
   * Open tab ids, outside Svelte's state: teardown code (an editor leaving the
   * screen) reads state as it was before the change that unmounted it.
   */
  private openIds = new Set(this.list.map((t) => t.id));

  constructor() {
    addEventListener('beforeunload', (e) => {
      let dirty = false;
      for (const s of this.sessions.values()) {
        if (s.ed && s.ed.saveState !== 'saved') {
          dirty = true;
          void s.ed.save();
        }
      }
      if (dirty) e.preventDefault();
    });
  }

  /** The design shown now, or null on Home. */
  get activeId(): string | null {
    return router.route.name === 'editor' ? router.route.id : null;
  }

  get ids(): string[] {
    return this.list.map((t) => t.id);
  }

  /** The route moved to a design: make sure it has a tab (new ones go right of the current tab). */
  ensure(id: string, title?: string, after?: string | null): void {
    const at = this.list.findIndex((t) => t.id === id);
    if (at >= 0) {
      if (title && this.list[at]!.title !== title) this.list[at]!.title = title;
    } else {
      const i = after ? this.list.findIndex((t) => t.id === after) : -1;
      const tab = { id, title: title ?? 'Untitled design' };
      if (i >= 0) this.list.splice(i + 1, 0, tab);
      else this.list.push(tab);
      this.openIds.add(id);
    }
    this.persist();
  }

  /** Open or focus a design's tab. */
  open(id: string): void {
    router.go({ name: 'editor', id });
  }

  home(): void {
    router.go({ name: 'home' });
  }

  /** "+": Home with its create menu open (Canva). */
  create(): void {
    this.createRequested = true;
    this.home();
  }

  close(id: string): void {
    const next = afterClose(this.ids, id, this.activeId);
    this.list = this.list.filter((t) => t.id !== id);
    this.openIds.delete(id);
    this.persist();
    // the active editor saves and lets go when it unmounts (see release)
    if (id !== this.activeId) this.drop(id);
    if (next !== this.activeId) {
      if (next) this.open(next);
      else this.home();
    }
  }

  /** A design is gone (deleted): close its tab without switching anywhere first. */
  forget(id: string): void {
    if (!this.openIds.has(id)) return;
    this.list = this.list.filter((t) => t.id !== id);
    this.openIds.delete(id);
    this.persist();
    if (id !== this.activeId) this.drop(id, false);
  }

  move(from: number, to: number): void {
    this.list = reorder(this.list, from, to);
    this.persist();
  }

  /** Ctrl+Tab / Ctrl+Shift+Tab. */
  step(dir: 1 | -1): void {
    const next = cycle(this.ids, this.activeId, dir);
    if (next) this.open(next);
    else this.home();
  }

  /** ⌘1..⌘9. */
  goNth(n: number): boolean {
    const id = nth(this.ids, n);
    if (!id) return false;
    this.open(id);
    return true;
  }

  setTitle(id: string, title: string): void {
    const t = this.list.find((x) => x.id === id);
    if (t && t.title !== title) {
      t.title = title;
      this.persist();
    }
  }

  // ---- sessions: editors kept in memory ----

  /** The kept session of a tab (made on first use). */
  session(id: string): Session {
    let s = this.sessions.get(id);
    if (!s) {
      s = { ed: null, view: null, ui: null, used: 0 };
      this.sessions.set(id, s);
    }
    return s;
  }

  /** A live editor for this design and store, if one is kept. */
  liveEditor(id: string, store: ProjectStore): EditorState | null {
    const s = this.sessions.get(id);
    if (s?.ed && s.ed.store !== store) {
      // signed in or out since: that editor belongs to the other store
      const old = s.ed;
      s.ed = null;
      s.view = null;
      void old.save().finally(() => old.dispose());
      this.count();
    }
    return s?.ed ?? null;
  }

  /** The editor of the active tab is up: keep it, and suspend the oldest beyond MAX_LIVE. */
  adopt(id: string, ed: EditorState): void {
    const s = this.session(id);
    s.ed = ed;
    s.used = ++this.clock;
    const used = new Map<string, number>();
    for (const [k, v] of this.sessions) if (v.ed) used.set(k, v.used);
    for (const k of toEvict(used, id, MAX_LIVE)) this.suspend(k);
    this.count();
  }

  /**
   * The editor of `id` is leaving the screen. It saves either way; it stays in
   * memory while its tab is open, else it is disposed.
   */
  release(id: string, ed: EditorState): void {
    if (ed.player.playing) ed.player.pause(); // a background tab stays quiet
    if (this.isOpen(id) && this.sessions.get(id)?.ed === ed) {
      void ed.save();
      return;
    }
    void ed.save().finally(() => ed.dispose());
    if (this.sessions.get(id)?.ed === ed) this.sessions.delete(id);
    this.count();
  }

  /** Save and free a background tab's editor; the tab stays and reloads when shown. */
  suspend(id: string): void {
    const s = this.sessions.get(id);
    const ed = s?.ed;
    if (!s || !ed) return;
    s.ed = null;
    void ed.save().finally(() => ed.dispose());
    this.count();
  }

  /** The design has a tab (safe to call from teardown code). */
  isOpen(id: string): boolean {
    return this.openIds.has(id);
  }

  /** Live tab ids (tests). */
  liveIds(): string[] {
    return [...this.sessions.entries()].filter(([, s]) => s.ed).map(([k]) => k);
  }

  private drop(id: string, save = true): void {
    const s = this.sessions.get(id);
    this.sessions.delete(id);
    const ed = s?.ed;
    if (ed && save) void ed.save().finally(() => ed.dispose());
    else ed?.dispose();
    this.count();
  }

  private count(): void {
    this.liveCount = this.liveIds().length;
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.list.map((t) => ({ id: t.id, title: t.title }))));
    } catch {
      // storage blocked: tabs last for this session
    }
  }
}

export const tabs = new Tabs();
if (import.meta.env.DEV) (window as unknown as { __tabs?: Tabs }).__tabs = tabs;
