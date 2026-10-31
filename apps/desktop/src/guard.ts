/**
 * Who may talk to the local server. It listens on loopback only, but any web
 * page the user visits can still aim requests at loopback, and DNS rebinding
 * can make a hostile page look same-origin. So, following the MCP transport
 * spec: the Host header must be one of our names (rebinding carries the
 * attacker's name), any Origin must be ours, and /mcp needs the access token.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export const HOSTNAME = 'digital-canvas.localhost';
const NAMES = [HOSTNAME, '127.0.0.1', 'localhost', '[::1]'];

export interface RequestHeaders {
  host?: string | undefined;
  origin?: string | undefined;
  authorization?: string | undefined;
}

export type Verdict = { ok: true } | { ok: false; status: number; error: string };

export function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return NAMES.some((n) => h === `${n}:${port}`);
}

/** No Origin = not a browser request (curl, an MCP client). A browser always sends one on POST. */
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  const o = origin.toLowerCase();
  return NAMES.some((n) => o === `http://${n}:${port}`);
}

/** Compares hashes, so neither length nor content leaks through timing. */
export function tokenMatches(authorization: string | undefined, token: string): boolean {
  if (!token) return false;
  const m = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? '');
  if (!m) return false;
  const sha = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(sha(m[1]!), sha(token));
}

/** Every request: a page that rebound its name to loopback stops here. */
export function checkRequest(h: RequestHeaders, port: number): Verdict {
  if (!hostAllowed(h.host, port)) return { ok: false, status: 403, error: 'host not allowed' };
  if (!originAllowed(h.origin, port)) return { ok: false, status: 403, error: 'origin not allowed' };
  return { ok: true };
}

/** /mcp: the checks above plus the token. */
export function checkMcp(h: RequestHeaders, port: number, token: string): Verdict {
  const base = checkRequest(h, port);
  if (!base.ok) return base;
  if (!tokenMatches(h.authorization, token)) return { ok: false, status: 401, error: 'missing or wrong access token (Digital Canvas › Settings › Local MCP)' };
  return { ok: true };
}
