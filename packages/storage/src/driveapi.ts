/**
 * The small Drive v3 HTTP layer shared by the design store (drive.ts) and
 * sharing (share.ts): authorised calls with one retry on 401, and reads that
 * fall back from OAuth to the browser API key.
 *
 * Why the fallback: the app only has `drive.file`, so it can read files it
 * created or that the user opened with it. A design someone shared with you
 * links its pictures and clips from the owner's `assets/` folder, which your
 * app was never granted. When a design is shared, those asset files are made
 * "anyone with the link: reader" (share.ts), and Drive serves files like that
 * to any caller with an API key (`files.get?alt=media&key=`), no sign-in.
 */

export const API = 'https://www.googleapis.com/drive/v3';

/** Returns a valid Drive access token (the caller caches and refreshes). */
export type TokenSource = (forceRefresh?: boolean) => Promise<string>;

export class DriveError extends Error {
  override name = 'DriveError';
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function fail(res: Response): Promise<never> {
  let msg = `${res.status}`;
  try { msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg; } catch { /* not JSON */ }
  throw new DriveError(`Google Drive: ${msg}`, res.status);
}

/** A Drive call with the user's token; a 401 refreshes the token once. Throws DriveError when not ok. */
export async function driveCall(token: TokenSource, url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await token(!retry)}` } });
  if (res.status === 401 && retry) return driveCall(token, url, init, false);
  if (!res.ok) await fail(res);
  return res;
}

/** A Drive GET with the API key only (files shared as "anyone with the link"). */
export async function keyCall(apiKey: string, url: string): Promise<Response> {
  const u = new URL(url);
  u.searchParams.set('key', apiKey);
  const res = await fetch(u.toString());
  if (!res.ok) await fail(res);
  return res;
}

export interface ReadVia {
  /** The signed-in user's token, tried first. */
  token?: TokenSource | null;
  /** Browser API key, tried when there is no token or Drive refuses it (401/403/404). */
  apiKey?: string;
}

/** Errors that mean "this token may not see the file", where the API key may still work. */
const NOT_YOURS = new Set([401, 403, 404]);

/**
 * GET a Drive URL: OAuth first, then the API key. Network errors and other
 * statuses are not retried with the key (the key would fail the same way).
 */
export async function readVia(url: string, via: ReadVia): Promise<Response> {
  let first: unknown = null;
  if (via.token) {
    try {
      return await driveCall(via.token, url);
    } catch (e) {
      // no token at all (signed out) counts as "not yours"; a 500 or offline does not
      const status = e instanceof DriveError ? e.status : 401;
      if (!via.apiKey || !NOT_YOURS.has(status)) throw e;
      first = e;
    }
  }
  if (!via.apiKey) throw first ?? new DriveError('Google Drive: not signed in', 401);
  return keyCall(via.apiKey, url);
}

/** A file's bytes (`files.get?alt=media`), OAuth first, then the API key. */
export async function readMedia(fileId: string, via: ReadVia): Promise<Uint8Array> {
  const res = await readVia(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, via);
  return new Uint8Array(await res.arrayBuffer());
}
