/**
 * Review comments in the editor (Canva/Figma-style): pins on the page, a
 * thread card per pin, a panel listing every thread, time-coded comments on
 * video.
 *
 * The threads come from the store (`ProjectStore.comments`): on Drive they are
 * the design file's own Drive comments, so a manager commenting through the
 * MCP connector and an editor working in the app see each other's comments
 * without any save racing another. They are fetched when the design opens,
 * every POLL_MS while the window is visible, and when it gets focus back.
 */
import { formatTime, isVideo, makeAnchor, pageAtTime, pageStart, pinPlace, sortComments, type CommentAnchor, type DesignComment } from '@digital-canvas/scene';
import type { CommentStore } from '@digital-canvas/storage';
import type { EditorState } from './editor.svelte.ts';
import { toast } from './toast.svelte.ts';
import { view } from './view.svelte.ts';

const POLL_MS = 15_000;

/** A new comment being written: where it goes. */
export interface Draft {
  anchor: CommentAnchor;
}

export class CommentsState {
  list = $state<DesignComment[]>([]);
  loaded = $state(false);
  error = $state('');
  /** The thread whose card is open. */
  active = $state<string | null>(null);
  draft = $state<Draft | null>(null);
  /** Comment mode: the next click on the page drops a pin. */
  placing = $state(false);
  panelOpen = $state(false);
  filter = $state<'open' | 'resolved' | 'all'>('open');
  busy = $state(false);
  private timer: ReturnType<typeof setInterval> | null = null;
  private loading: Promise<void> | null = null;
  private onFocus = () => { if (document.visibilityState === 'visible') void this.refresh(); };

  constructor(readonly ed: EditorState, readonly store: CommentStore) {}

  /** Whether you may write comments here (Drive: owner, writer or commenter). */
  get canComment(): boolean {
    return this.ed.access ? this.ed.access.canComment || this.ed.access.canEdit : true;
  }

  get open(): DesignComment[] { return this.list.filter((c) => !c.resolved); }

  /** Reading order (pages, then top to bottom), numbered over every thread. */
  get sorted(): DesignComment[] { return sortComments(this.ed.doc, this.list); }

  get numbers(): Map<string, number> { return new Map(this.sorted.map((c, i) => [c.id, i + 1])); }

  get shown(): DesignComment[] {
    return this.sorted.filter((c) => this.filter === 'all' || (this.filter === 'open') === !c.resolved);
  }

  find(id: string | null): DesignComment | undefined {
    return id ? this.list.find((c) => c.id === id) : undefined;
  }

  start(): void {
    void this.refresh();
    if (this.timer) return;
    this.timer = setInterval(() => { if (document.visibilityState === 'visible') void this.refresh(); }, POLL_MS);
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onFocus);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('focus', this.onFocus);
    document.removeEventListener('visibilitychange', this.onFocus);
  }

  async refresh(force = false): Promise<void> {
    if (this.loading) return this.loading;
    if (this.pending && !force) return; // our own changes are on their way: the next poll catches up
    this.loading = (async () => {
      try {
        const got = await this.store.list(this.ed.doc.id);
        if (this.pending && !force) return;
        // threads still being sent stay on screen
        this.list = [...got, ...this.list.filter((c) => this.unsynced.has(c.id) && !got.some((g) => g.id === this.real(c.id)))];
        this.error = '';
      } catch (e) {
        // a design not saved to Drive yet has no comments: not an error to show
        const msg = e instanceof Error ? e.message : String(e);
        this.error = /save it first/.test(msg) ? '' : msg;
      } finally {
        this.loaded = true;
        this.loading = null;
      }
    })();
    return this.loading;
  }

  // ---- changes: shown at once, sent to the store in the background, in order ----

  /** Ids of threads and replies not in the store yet (shown as "Sending…"). */
  unsynced = $state(new Set<string>());
  /** Changes waiting to reach the store. */
  pending = $state(0);
  private ops: Promise<unknown> = Promise.resolve();
  /** Temporary id → the store's id, once a new comment or reply has been sent. */
  private ids = new Map<string, string>();
  private real = (id: string) => this.ids.get(id) ?? id;

  /** Queue a store call; on failure say so and reload what the store has. */
  private send(what: string, fn: () => Promise<unknown>): void {
    this.pending++;
    this.ops = this.ops.then(fn).catch((e) => {
      toast.show(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      return this.refresh(true);
    }).finally(() => { this.pending--; });
  }

  private mark(id: string, on: boolean): void {
    const next = new Set(this.unsynced);
    if (on) next.add(id); else next.delete(id);
    this.unsynced = next;
  }

  private patch(id: string, fn: (c: DesignComment) => DesignComment | null): void {
    const out: DesignComment[] = [];
    for (const c of this.list) {
      if (c.id !== id) { out.push(c); continue; }
      const n = fn(c);
      if (n) out.push(n);
    }
    this.list = out;
  }

  private tmpId(): string {
    return `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  private me() {
    const a = this.list.find((c) => c.author.me)?.author;
    return a ? { ...a } : { name: 'You', me: true };
  }

  /** The moment a new comment on a video is about: the playhead, inside its scene. */
  private videoTime(pageId: string): number | undefined {
    if (!isVideo(this.ed.doc)) return undefined;
    const t = this.ed.player.time - pageStart(this.ed.doc, pageId);
    const dur = this.ed.doc.pages.find((p) => p.id === pageId)?.duration ?? 5;
    return t >= 0 && t <= dur ? t : undefined;
  }

  /** Open a new-comment card: at a point of a page, on an element, or (none) on the selection / current page. */
  begin(spot?: { page: string; element?: string; point?: { x: number; y: number } }): void {
    if (!this.canComment) return;
    const ed = this.ed;
    if (!spot) {
      const el = ed.selected[0];
      spot = el ? { page: ed.pageId, element: el.id } : { page: ed.pageId, point: { x: ed.doc.width - 24, y: 24 } };
    }
    if (ed.doc.pages.length && !ed.doc.pages.some((p) => p.id === spot!.page)) spot.page = ed.pageId;
    if (isVideo(ed.doc)) spot.page = pageAtTime(ed.doc, ed.player.time).page.id;
    try {
      this.draft = { anchor: makeAnchor(ed.doc, { ...spot, time: this.videoTime(spot.page) }) };
    } catch {
      this.draft = { anchor: makeAnchor(ed.doc, { page: ed.pageId, point: spot.point }) };
    }
    this.active = null;
    this.placing = false;
  }

  /** Toggle comment mode (Canva's comment tool). */
  togglePlacing(): void {
    if (!this.canComment) return;
    this.placing = !this.placing;
    if (this.placing) { this.draft = null; this.active = null; }
  }

  cancel(): void {
    this.draft = null;
    this.active = null;
  }

  /** New comment: on screen at once, sent in the background. */
  async submit(text: string, timed = true): Promise<boolean> {
    const d = this.draft;
    const body = text.trim();
    if (!d || !body) return false;
    const anchor = { ...d.anchor };
    if (!timed) { delete anchor.t; delete anchor.t1; }
    const tmp = this.tmpId(), now = new Date().toISOString();
    this.list = [...this.list, { id: tmp, text: body, author: this.me(), createdAt: now, updatedAt: now, resolved: false, anchor, replies: [] }];
    this.mark(tmp, true);
    this.draft = null;
    this.active = tmp;
    this.send('Comment not sent', async () => {
      // the design must exist in the store before it can carry comments (Drive)
      if (this.ed.saveState !== 'saved') await this.ed.save(true);
      const c = await this.store.add(this.ed.doc.id, body, anchor);
      this.ids.set(tmp, c.id);
      // keep what happened locally meanwhile (replies, resolve), under the real id
      this.patch(tmp, (cur) => ({ ...c, text: cur.text, resolved: cur.resolved, replies: cur.replies }));
      if (this.active === tmp) this.active = c.id;
      this.mark(tmp, false);
    });
    return true;
  }

  async reply(id: string, text: string): Promise<boolean> {
    const body = text.trim();
    if (!body) return false;
    const tmp = this.tmpId(), now = new Date().toISOString();
    this.patch(id, (c) => ({ ...c, replies: [...c.replies, { id: tmp, text: body, author: this.me(), createdAt: now }] }));
    this.mark(tmp, true);
    this.send('Reply not sent', async () => {
      const r = await this.store.reply(this.ed.doc.id, this.real(id), body);
      this.ids.set(tmp, r.id);
      this.patch(this.real(id), (c) => ({ ...c, replies: c.replies.map((x) => (x.id === tmp ? { ...r, text: x.text } : x)) }));
      this.mark(tmp, false);
    });
    return true;
  }

  async edit(id: string, text: string, replyId?: string): Promise<boolean> {
    const t = text.trim();
    if (!t) return false;
    this.patch(id, (c) => (replyId ? { ...c, replies: c.replies.map((r) => (r.id === replyId ? { ...r, text: t } : r)) } : { ...c, text: t }));
    this.send('Edit not saved', () => this.store.edit(this.ed.doc.id, this.real(id), t, replyId && this.real(replyId)));
    return true;
  }

  async resolve(id: string, resolved = true): Promise<void> {
    const now = new Date().toISOString();
    this.patch(id, (c) => ({ ...c, resolved, replies: [...c.replies, { id: this.tmpId(), text: '', author: this.me(), createdAt: now, action: resolved ? 'resolve' : 'reopen' }] }));
    if (resolved && this.active === id && this.filter === 'open') this.active = null;
    this.send(resolved ? 'Not resolved' : 'Not reopened', () => this.store.setResolved(this.ed.doc.id, this.real(id), resolved));
  }

  async remove(id: string, replyId?: string): Promise<void> {
    if (replyId) this.patch(id, (c) => ({ ...c, replies: c.replies.filter((r) => r.id !== replyId) }));
    else this.patch(id, () => null);
    if (!replyId && this.active === id) this.active = null;
    this.send('Not deleted', () => this.store.remove(this.ed.doc.id, this.real(id), replyId && this.real(replyId)));
  }

  /** Go to a thread: its page (and its moment in a video), open its card. */
  focus(id: string): void {
    const c = this.find(id);
    if (!c) return;
    this.draft = null;
    this.active = id;
    const ed = this.ed;
    const place = pinPlace(ed.doc, c.anchor);
    if (!place.page) return;
    if (isVideo(ed.doc)) {
      const t = pageStart(ed.doc, place.page) + (c.anchor?.t ?? 0);
      void ed.player.seek(t);
    } else {
      if (ed.pageId !== place.page) ed.select([], place.page);
      view.goToPage(ed.doc.pages.findIndex((p) => p.id === place.page));
    }
  }

  /** "Page 2 · 0:03.5" */
  where(c: DesignComment): string {
    if (!c.anchor) return 'Whole design';
    const place = pinPlace(this.ed.doc, c.anchor);
    const i = this.ed.doc.pages.findIndex((p) => p.id === place.page);
    const parts = [i < 0 ? 'Deleted page' : isVideo(this.ed.doc) ? `Scene ${i + 1}` : `Page ${i + 1}`];
    if (c.anchor.t != null && place.page) {
      const s = pageStart(this.ed.doc, place.page);
      parts.push(formatTime(s + c.anchor.t) + (c.anchor.t1 != null ? `–${formatTime(s + c.anchor.t1)}` : ''));
    }
    if (place.orphan) parts.push('element deleted');
    return parts.join(' · ');
  }
}

const states = new WeakMap<EditorState, CommentsState>();

/** The comments of an editor's design (one state per editor; null when its store has none). */
export function commentsOf(ed: EditorState): CommentsState | null {
  const store = ed.store.comments;
  if (!store) return null;
  let s = states.get(ed);
  if (!s) states.set(ed, (s = new CommentsState(ed, store)));
  (globalThis as { __dcComments?: CommentsState }).__dcComments = s; // tests and the console
  return s;
}

/** "5 min ago", "Yesterday", "3 Nov" */
export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'Yesterday';
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
