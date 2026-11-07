/**
 * Comment threads on a design, kept outside the design file so that people
 * (and agents) who comment never race the editor's autosave.
 *
 * - Drive: the file's own Drive comments (`files/{id}/comments`, works with
 *   `drive.file`). Google keeps the author, Drive's roles decide who may
 *   comment (owner, writer, commenter), and only the author may edit or
 *   delete. Our anchor (scene/comments.ts) rides in Drive's opaque `anchor`.
 *   Resolve/reopen are replies with an `action`, as in Google Docs.
 * - Local stores (browser, folder, desktop, memory, MCP folder): one JSON
 *   sidecar per design (`JsonComments`), read and rewritten per change.
 */
import { decodeAnchor, encodeAnchor, type CommentAnchor, type CommentAuthor, type CommentReply, type DesignComment } from '@digital-canvas/scene';
import { API, DriveError, driveCall, type TokenSource } from './driveapi.ts';

export interface ListCommentsOptions {
  /** Also resolved threads (default true). */
  resolved?: boolean;
}

export interface CommentStore {
  list(docId: string, opts?: ListCommentsOptions): Promise<DesignComment[]>;
  add(docId: string, text: string, anchor?: CommentAnchor): Promise<DesignComment>;
  reply(docId: string, commentId: string, text: string): Promise<CommentReply>;
  /** Change the text of a comment, or of one of its replies. Only the author may. */
  edit(docId: string, commentId: string, text: string, replyId?: string): Promise<void>;
  /** Resolve (true) or reopen (false), optionally with a reply text. */
  setResolved(docId: string, commentId: string, resolved: boolean, text?: string): Promise<void>;
  /** Delete a whole thread, or one reply. Only the author may. */
  remove(docId: string, commentId: string, replyId?: string): Promise<void>;
}

export class CommentError extends Error {
  override name = 'CommentError';
}

const clean = (text: string) => text.replace(/\r\n/g, '\n').trim();
const MAX = 30_000; // Drive's limit is ~30k characters

function checkText(text: string, allowEmpty = false): string {
  const t = clean(text);
  if (!t && !allowEmpty) throw new CommentError('A comment needs some text.');
  if (t.length > MAX) throw new CommentError(`A comment can be at most ${MAX} characters.`);
  return t;
}

// ---------------------------------------------------------------- Drive

interface DriveUser { displayName?: string; emailAddress?: string; photoLink?: string; me?: boolean }
interface DriveReply { id: string; content?: string; action?: 'resolve' | 'reopen'; author?: DriveUser; createdTime: string; modifiedTime?: string; deleted?: boolean }
interface DriveComment {
  id: string; content?: string; anchor?: string; author?: DriveUser; createdTime: string; modifiedTime: string;
  resolved?: boolean; deleted?: boolean; replies?: DriveReply[];
}

const USER = 'author(displayName,emailAddress,photoLink,me)';
const REPLY_FIELDS = `id,content,action,createdTime,modifiedTime,deleted,${USER}`;
const COMMENT_FIELDS = `id,content,anchor,createdTime,modifiedTime,resolved,deleted,${USER},replies(${REPLY_FIELDS})`;

function author(u: DriveUser | undefined): CommentAuthor {
  const a: CommentAuthor = { name: u?.displayName || u?.emailAddress || 'Someone' };
  if (u?.me) a.me = true;
  if (u?.photoLink) a.photo = u.photoLink.startsWith('//') ? `https:${u.photoLink}` : u.photoLink;
  if (u?.emailAddress) a.email = u.emailAddress;
  return a;
}

function fromDriveReply(r: DriveReply): CommentReply {
  const out: CommentReply = { id: r.id, text: r.content ?? '', author: author(r.author), createdAt: r.createdTime };
  if (r.modifiedTime && r.modifiedTime !== r.createdTime) out.updatedAt = r.modifiedTime;
  if (r.action) out.action = r.action;
  return out;
}

export function fromDriveComment(c: DriveComment): DesignComment {
  const out: DesignComment = {
    id: c.id,
    text: c.content ?? '',
    author: author(c.author),
    createdAt: c.createdTime,
    updatedAt: c.modifiedTime,
    resolved: !!c.resolved,
    replies: (c.replies ?? []).filter((r) => !r.deleted).map(fromDriveReply),
  };
  const a = decodeAnchor(c.anchor);
  if (a) out.anchor = a;
  return out;
}

/** Drive comments of the design files a `DriveStore` knows. */
export class DriveComments implements CommentStore {
  constructor(private token: TokenSource, private fileIdOf: (docId: string) => Promise<string | undefined>) {}

  private async base(docId: string): Promise<string> {
    const id = await this.fileIdOf(docId);
    if (!id) throw new CommentError('This design is not in Google Drive yet (save it first).');
    return `${API}/files/${encodeURIComponent(id)}/comments`;
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    try {
      const res = await driveCall(this.token, url, init);
      return (res.status === 204 ? {} : await res.json()) as T;
    } catch (e) {
      if (e instanceof DriveError && e.status === 403) throw new CommentError('You can\'t do that here: Google Drive allows it only to people who may comment on this design (and edits/deletes only to the author).');
      if (e instanceof DriveError && e.status === 404) throw new CommentError('That comment (or design) is gone.');
      throw e;
    }
  }

  private send(url: string, method: string, body?: unknown) {
    return this.json<Record<string, unknown>>(url, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  }

  async list(docId: string, opts: ListCommentsOptions = {}): Promise<DesignComment[]> {
    const base = await this.base(docId);
    const out: DesignComment[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ fields: `nextPageToken,comments(${COMMENT_FIELDS})`, pageSize: '100', includeDeleted: 'false' });
      if (pageToken) q.set('pageToken', pageToken);
      const r = await this.json<{ comments?: DriveComment[]; nextPageToken?: string }>(`${base}?${q}`);
      for (const c of r.comments ?? []) if (!c.deleted) out.push(fromDriveComment(c));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return opts.resolved === false ? out.filter((c) => !c.resolved) : out;
  }

  async add(docId: string, text: string, anchor?: CommentAnchor): Promise<DesignComment> {
    const body: Record<string, string> = { content: checkText(text) };
    if (anchor) body.anchor = encodeAnchor(anchor);
    const c = await this.send(`${await this.base(docId)}?fields=${encodeURIComponent(COMMENT_FIELDS)}`, 'POST', body);
    return fromDriveComment(c as unknown as DriveComment);
  }

  async reply(docId: string, commentId: string, text: string): Promise<CommentReply> {
    const r = await this.send(`${await this.base(docId)}/${encodeURIComponent(commentId)}/replies?fields=${encodeURIComponent(REPLY_FIELDS)}`, 'POST', { content: checkText(text) });
    return fromDriveReply(r as unknown as DriveReply);
  }

  async edit(docId: string, commentId: string, text: string, replyId?: string): Promise<void> {
    const base = `${await this.base(docId)}/${encodeURIComponent(commentId)}`;
    const url = replyId ? `${base}/replies/${encodeURIComponent(replyId)}?fields=id` : `${base}?fields=id`;
    await this.send(url, 'PATCH', { content: checkText(text) });
  }

  async setResolved(docId: string, commentId: string, resolved: boolean, text = ''): Promise<void> {
    const body: Record<string, string> = { action: resolved ? 'resolve' : 'reopen' };
    const t = checkText(text, true);
    if (t) body.content = t;
    await this.send(`${await this.base(docId)}/${encodeURIComponent(commentId)}/replies?fields=id`, 'POST', body);
  }

  async remove(docId: string, commentId: string, replyId?: string): Promise<void> {
    const base = `${await this.base(docId)}/${encodeURIComponent(commentId)}`;
    await this.send(replyId ? `${base}/replies/${encodeURIComponent(replyId)}` : base, 'DELETE');
  }
}

// ---------------------------------------------------------------- local (JSON sidecar)

/** Reads and writes one design's comment file (`null` = none yet). */
export interface CommentFileIO {
  read(docId: string): Promise<string | null>;
  write(docId: string, json: string): Promise<void>;
}

interface CommentFile { format: 'dcanvas-comments'; version: 1; comments: StoredComment[] }
interface StoredComment extends Omit<DesignComment, 'author' | 'replies'> { author: CommentAuthor; replies: (Omit<CommentReply, 'author'> & { author: CommentAuthor })[] }

let seq = 0;
const newCommentId = () => `c${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Comments in a JSON file per design. Without accounts everyone on this
 * device is "you" (`me`), so you may edit and delete everything; `author`
 * names who wrote it (e.g. an agent through MCP).
 */
export class JsonComments implements CommentStore {
  constructor(private io: CommentFileIO, private who: () => CommentAuthor = () => ({ name: 'You' })) {}

  /** Change one design's comments: read, apply, write (reads again each time, so two writers rarely clash). */
  private async change<T>(docId: string, fn: (list: StoredComment[]) => T): Promise<T> {
    const list = await this.load(docId);
    const out = fn(list);
    const file: CommentFile = { format: 'dcanvas-comments', version: 1, comments: list };
    await this.io.write(docId, JSON.stringify(file, null, 1));
    return out;
  }

  private async load(docId: string): Promise<StoredComment[]> {
    const s = await this.io.read(docId);
    if (!s) return [];
    try {
      const f = JSON.parse(s) as Partial<CommentFile>;
      return Array.isArray(f.comments) ? f.comments : [];
    } catch {
      return [];
    }
  }

  private find(list: StoredComment[], id: string): StoredComment {
    const c = list.find((x) => x.id === id);
    if (!c) throw new CommentError('That comment is gone.');
    return c;
  }

  private me(a: CommentAuthor): CommentAuthor {
    return { ...a, me: true };
  }

  async list(docId: string, opts: ListCommentsOptions = {}): Promise<DesignComment[]> {
    const all = (await this.load(docId)).map((c) => ({ ...c, author: this.me(c.author), replies: c.replies.map((r) => ({ ...r, author: this.me(r.author) })) }));
    return opts.resolved === false ? all.filter((c) => !c.resolved) : all;
  }

  async add(docId: string, text: string, anchor?: CommentAnchor): Promise<DesignComment> {
    const t = checkText(text);
    const now = new Date().toISOString();
    const c: StoredComment = { id: newCommentId(), text: t, author: this.who(), createdAt: now, updatedAt: now, resolved: false, replies: [] };
    if (anchor) c.anchor = anchor;
    await this.change(docId, (list) => list.push(c));
    return { ...c, author: this.me(c.author) };
  }

  async reply(docId: string, commentId: string, text: string): Promise<CommentReply> {
    const t = checkText(text);
    const now = new Date().toISOString();
    const r = { id: newCommentId(), text: t, author: this.who(), createdAt: now };
    await this.change(docId, (list) => {
      const c = this.find(list, commentId);
      c.replies.push(r);
      c.updatedAt = now;
    });
    return { ...r, author: this.me(r.author) };
  }

  async edit(docId: string, commentId: string, text: string, replyId?: string): Promise<void> {
    const t = checkText(text);
    const now = new Date().toISOString();
    await this.change(docId, (list) => {
      const c = this.find(list, commentId);
      if (replyId) {
        const r = c.replies.find((x) => x.id === replyId);
        if (!r) throw new CommentError('That reply is gone.');
        r.text = t;
        r.updatedAt = now;
      } else c.text = t;
      c.updatedAt = now;
    });
  }

  async setResolved(docId: string, commentId: string, resolved: boolean, text = ''): Promise<void> {
    const t = checkText(text, true);
    const now = new Date().toISOString();
    await this.change(docId, (list) => {
      const c = this.find(list, commentId);
      c.resolved = resolved;
      c.replies.push({ id: newCommentId(), text: t, author: this.who(), createdAt: now, action: resolved ? 'resolve' : 'reopen' });
      c.updatedAt = now;
    });
  }

  async remove(docId: string, commentId: string, replyId?: string): Promise<void> {
    await this.change(docId, (list) => {
      const i = list.findIndex((x) => x.id === commentId);
      if (i < 0) return;
      if (replyId) list[i]!.replies = list[i]!.replies.filter((r) => r.id !== replyId);
      else list.splice(i, 1);
    });
  }
}

/** Comment files kept in memory (tests, MemoryStore). */
export class MemoryCommentFiles implements CommentFileIO {
  files = new Map<string, string>();
  async read(id: string) { return this.files.get(id) ?? null; }
  async write(id: string, json: string) { this.files.set(id, json); }
}

/** Drive allows only the author to edit/delete; local stores allow everything. */
export function canChange(c: { author: CommentAuthor }): boolean {
  return !!c.author.me;
}
