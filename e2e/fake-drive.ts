import type { Page, Route } from '@playwright/test';

/**
 * A small in-memory Google Drive v3 behind page.route, enough for the app's
 * design store (app folder, assets folder, multipart uploads) and for picked
 * files (metadata, downloads, thumbnails).
 */
export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  trashed?: boolean;
  owned?: boolean;
  modifiedTime?: string;
  thumbnailLink?: string;
  imageMediaMetadata?: { width: number; height: number };
  body?: Buffer;
  /** Earlier contents, oldest first (Drive revisions). */
  revisions?: { id: string; modifiedTime: string; body: Buffer }[];
}

export const FOLDER = 'application/vnd.google-apps.folder';

export class FakeDrive {
  files = new Map<string, FakeFile>();
  /** Requests seen, "METHOD path?q". */
  log: string[] = [];
  private n = 0;
  thumb: Buffer = Buffer.alloc(0);

  add(f: Omit<FakeFile, 'id'> & { id?: string }): FakeFile {
    const file: FakeFile = { id: f.id ?? `f${++this.n}`, owned: true, trashed: false, modifiedTime: new Date().toISOString(), appProperties: {}, ...f };
    this.files.set(file.id, file);
    return file;
  }

  private match(f: FakeFile, q: string): boolean {
    if (/trashed\s*=\s*false/.test(q) && f.trashed) return false;
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    if (parent && !(f.parents ?? []).includes(parent)) return false;
    if (/'me' in owners/.test(q) && !f.owned) return false;
    if (/^sharedWithMe/.test(q) && f.owned) return false;
    const media = [...q.matchAll(/mimeType contains '([^']+)'/g)].map((m) => m[1]!);
    const exact = /mimeType\s*=\s*'([^']+)'/.exec(q)?.[1];
    if (media.length) {
      // browsing: usable media, plus folders when the query asks for them
      if (!media.some((m) => f.mimeType.startsWith(m)) && !(exact === FOLDER && f.mimeType === FOLDER)) return false;
    } else if (exact && f.mimeType !== exact) return false;
    const name = /name contains '((?:[^'\\]|\\.)*)'/.exec(q)?.[1];
    if (name && !f.name.toLowerCase().includes(name.replace(/\\(.)/g, '$1').toLowerCase())) return false;
    for (const m of q.matchAll(/key='([^']+)' and value='([^']*)'/g)) if (f.appProperties?.[m[1]!] !== m[2]) return false;
    return true;
  }

  private meta(f: FakeFile) {
    const { body, owned, trashed, ...rest } = f;
    return { ...rest, ...(body ? { size: String(body.length) } : {}) };
  }

  async install(page: Page): Promise<void> {
    await page.route('https://lh3.googleusercontent.com/**', (r) => r.fulfill({ body: this.thumb, contentType: 'image/png' }));
    await page.route('https://www.googleapis.com/**', (r) => this.handle(r));
  }

  private parseMultipart(buf: Buffer, ct: string): { meta: Record<string, any>; body: Buffer } {
    const boundary = /boundary=(\S+)/.exec(ct)![1]!;
    const text = buf.toString('latin1');
    const first = text.indexOf('\r\n\r\n') + 4;
    const metaEnd = text.indexOf(`\r\n--${boundary}`, first);
    const meta = JSON.parse(Buffer.from(text.slice(first, metaEnd), 'latin1').toString('utf8'));
    const start = text.indexOf('\r\n\r\n', metaEnd) + 4;
    const end = text.lastIndexOf(`\r\n--${boundary}--`);
    return { meta, body: buf.subarray(start, end) };
  }

  private async handle(route: Route): Promise<void> {
    const req = route.request();
    const url = new URL(req.url());
    const json = (v: unknown, status = 200) => route.fulfill({ status, body: JSON.stringify(v), contentType: 'application/json', headers: { 'access-control-allow-origin': '*' } });
    this.log.push(`${req.method()} ${url.pathname}${url.searchParams.get('q') ? `?${url.searchParams.get('q')}` : ''}${url.searchParams.get('pageToken') ? ` page=${url.searchParams.get('pageToken')}` : ''}`);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const id = /\/files\/([^/?]+)/.exec(url.pathname)?.[1];
    if (url.pathname === '/drive/v3/drives') return json({ drives: [] });
    if (url.pathname === '/drive/v3/files' && req.method() === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      let all = [...this.files.values()].filter((f) => this.match(f, q));
      if ((url.searchParams.get('orderBy') ?? '').startsWith('folder')) all = [...all.filter((f) => f.mimeType === FOLDER), ...all.filter((f) => f.mimeType !== FOLDER)];
      const size = Number(url.searchParams.get('pageSize') ?? 100);
      const from = Number(url.searchParams.get('pageToken') ?? 0);
      const page = all.slice(from, from + size);
      return json({ files: page.map((f) => this.meta(f)), ...(from + size < all.length ? { nextPageToken: String(from + size) } : {}) });
    }
    if (url.pathname === '/drive/v3/files' && req.method() === 'POST') return json({ id: this.add({ parents: ['root'], ...req.postDataJSON() }).id });
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      const { meta, body } = this.parseMultipart(req.postDataBuffer()!, req.headers()['content-type']!);
      const modifiedTime = new Date(Date.now() + this.n++).toISOString();
      if (id) {
        const f = this.files.get(id)!;
        Object.assign(f, meta, { body, modifiedTime, appProperties: { ...f.appProperties, ...meta.appProperties } });
        (f.revisions ??= []).push({ id: `r${this.n++}`, modifiedTime, body });
        return json({ id });
      }
      return json({ id: this.add({ parents: ['root'], ...meta, body, modifiedTime, revisions: [{ id: `r${this.n++}`, modifiedTime, body }] }).id });
    }
    const f = id ? this.files.get(id) : undefined;
    if (!f) return json({ error: { message: 'File not found' } }, 404);
    const rev = /\/revisions(?:\/([^/?]+))?$/.exec(url.pathname);
    if (rev && !rev[1]) return json({ revisions: (f.revisions ?? []).map((r) => ({ id: r.id, modifiedTime: r.modifiedTime, size: String(r.body.length) })) });
    if (rev) {
      const r = f.revisions?.find((x) => x.id === rev[1]);
      return r ? route.fulfill({ body: r.body, headers: { 'access-control-allow-origin': '*' } }) : json({ error: { message: 'Revision not found' } }, 404);
    }
    if (url.searchParams.get('alt') === 'media') return route.fulfill({ body: f.body ?? Buffer.alloc(0), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-length' } });
    if (req.method() === 'PATCH') {
      const { appProperties, ...rest } = req.postDataJSON();
      Object.assign(f, rest);
      for (const [k, v] of Object.entries((appProperties ?? {}) as Record<string, string | null>)) {
        if (v === null) delete f.appProperties![k];
        else f.appProperties![k] = v;
      }
      return json({ id });
    }
    return json(this.meta(f));
  }
}

/** Pretend to be signed in (no Firebase, no Google): a user and a cached drive.file access token. */
export async function fakeSignIn(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__account?.known);
  await page.evaluate(() => {
    const a = (window as any).__account;
    a.token = { value: 'fake-token', expires: Date.now() + 3600_000 };
    a.user = { uid: 'google:1', email: 'tester@example.com', name: 'Tester' };
  });
}
