import { describe, expect, it } from 'vitest';
import { checkMcp, checkRequest, hostAllowed, originAllowed, tokenMatches } from '../src/guard.ts';

const PORT = 4977, TOKEN = 'dc_secret';

describe('Host check (DNS rebinding)', () => {
  it('takes our names on our port', () => {
    for (const h of ['digital-canvas.localhost:4977', 'DIGITAL-CANVAS.localhost:4977', '127.0.0.1:4977', 'localhost:4977', '[::1]:4977']) expect(hostAllowed(h, PORT)).toBe(true);
  });
  it('refuses a rebound name, another port, and no Host', () => {
    for (const h of ['evil.example:4977', 'digital-canvas.localhost.evil.example:4977', 'digital-canvas.localhost:80', 'digital-canvas.localhost', '192.168.1.5:4977', undefined]) expect(hostAllowed(h, PORT)).toBe(false);
  });
});

describe('Origin check', () => {
  it('lets non-browser clients through (they send no Origin)', () => expect(originAllowed(undefined, PORT)).toBe(true));
  it('takes the app itself', () => {
    expect(originAllowed('http://digital-canvas.localhost:4977', PORT)).toBe(true);
    expect(originAllowed('http://127.0.0.1:4977', PORT)).toBe(true);
  });
  it('refuses other sites, other ports, https lookalikes and sandboxed frames', () => {
    for (const o of ['https://evil.example', 'http://digital-canvas.localhost:5000', 'https://digital-canvas.localhost:4977', 'http://digital-canvas.localhost.evil.example:4977', 'null', '']) expect(originAllowed(o, PORT)).toBe(false);
  });
});

describe('Access token', () => {
  it('needs the exact bearer token', () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenMatches(`bearer ${TOKEN}`, TOKEN)).toBe(true);
    for (const a of [undefined, '', 'Bearer', 'Bearer wrong', `Basic ${TOKEN}`, `Bearer ${TOKEN}x`, `Bearer ${TOKEN} x`]) expect(tokenMatches(a, TOKEN)).toBe(false);
  });
  it('never matches an empty configured token', () => expect(tokenMatches('Bearer ', '')).toBe(false));
});

describe('whole checks', () => {
  const host = 'digital-canvas.localhost:4977', authorization = `Bearer ${TOKEN}`;
  it('static requests need no token', () => expect(checkRequest({ host }, PORT).ok).toBe(true));
  it('/mcp passes with all three right', () => expect(checkMcp({ host, authorization }, PORT, TOKEN).ok).toBe(true));
  it('a right token does not excuse a wrong origin', () => expect(checkMcp({ host, authorization, origin: 'https://evil.example' }, PORT, TOKEN)).toMatchObject({ ok: false, status: 403 }));
  it('a wrong host fails first', () => expect(checkMcp({ host: 'evil.example:4977', authorization }, PORT, TOKEN)).toMatchObject({ ok: false, status: 403 }));
  it('no token is a 401', () => expect(checkMcp({ host }, PORT, TOKEN)).toMatchObject({ ok: false, status: 401 }));
});
