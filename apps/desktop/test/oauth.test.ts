import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { authUrl, challengeOf, idClaims, pkcePair, refreshAccess, runLoopbackFlow, type OAuthEndpoints } from '../src/oauth.ts';
import { isNewer } from '../src/version.ts';

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B vector', () => {
    expect(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('makes a fresh, valid pair each time', () => {
    const a = pkcePair(), b = pkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.verifier).toMatch(/^[\w-]{43}$/);
    expect(a.challenge).toBe(createHash('sha256').update(a.verifier).digest('base64url'));
  });
});

describe('authorization URL', () => {
  it('asks for S256, offline access and only the scopes given', () => {
    const u = new URL(authUrl({ auth: 'https://g.example/auth', token: '', revoke: '' }, { clientId: 'cid', redirectUri: 'http://127.0.0.1:9/callback', scopes: ['openid', 'x'], state: 's', challenge: 'c' }));
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'cid', redirect_uri: 'http://127.0.0.1:9/callback', response_type: 'code', scope: 'openid x', state: 's', code_challenge: 'c', code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' });
  });
});

describe('loopback flow', () => {
  let google: Server | undefined;
  afterEach(() => { google?.close(); });

  /** A stand-in for Google's token endpoint: records the form. */
  async function fakeGoogle(reply: (form: URLSearchParams) => [number, unknown]) {
    const forms: URLSearchParams[] = [];
    google = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        forms.push(form);
        const [status, json] = reply(form);
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json));
      });
    });
    await new Promise<void>((r) => google!.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
    const endpoints: OAuthEndpoints = { auth: `${base}/auth`, token: `${base}/token`, revoke: `${base}/revoke` };
    return { endpoints, forms };
  }
  const client = { clientId: 'cid', clientSecret: 'shh' };

  /** Runs a flow; `consent` plays Google's browser redirect. */
  function flow(endpoints: OAuthEndpoints, consent: (u: URL) => Promise<void>, timeoutMs?: number) {
    let opened!: URL;
    const f = runLoopbackFlow({ endpoints, client, scopes: ['openid'], ...(timeoutMs ? { timeoutMs } : {}), open: (url) => { opened = new URL(url); void consent(opened); } });
    return { ...f, opened: () => opened };
  }

  it('exchanges the code with the verifier that matches the challenge', async () => {
    const { endpoints, forms } = await fakeGoogle(() => [200, { access_token: 'at', expires_in: 3600, refresh_token: 'rt' }]);
    const f = flow(endpoints, async (u) => {
      const r = await fetch(`${u.searchParams.get('redirect_uri')}?code=the-code&state=${u.searchParams.get('state')}`);
      expect(await r.text()).toContain('Connected');
    });
    expect(await f.result).toMatchObject({ access_token: 'at', refresh_token: 'rt' });
    const u = f.opened();
    expect(u.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const form = forms[0]!;
    expect(form.get('code')).toBe('the-code');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(challengeOf(form.get('code_verifier')!)).toBe(u.searchParams.get('code_challenge'));
  });

  it('ignores a redirect with the wrong state, then takes the right one', async () => {
    const { endpoints, forms } = await fakeGoogle(() => [200, { access_token: 'at', expires_in: 3600 }]);
    const f = flow(endpoints, async (u) => {
      const cb = u.searchParams.get('redirect_uri')!;
      expect((await fetch(`${cb}?code=stolen&state=wrong`)).status).toBe(404);
      await fetch(`${cb}?code=good&state=${u.searchParams.get('state')}`);
    });
    await f.result;
    expect(forms.map((x) => x.get('code'))).toEqual(['good']);
  });

  it('says when the user refuses', async () => {
    const { endpoints, forms } = await fakeGoogle(() => [200, {}]);
    const f = flow(endpoints, async (u) => { await fetch(`${u.searchParams.get('redirect_uri')}?error=access_denied&state=${u.searchParams.get('state')}`); });
    await expect(f.result).rejects.toThrow('not granted');
    expect(forms).toHaveLength(0);
  });

  it('times out, and the listener goes away', async () => {
    const { endpoints } = await fakeGoogle(() => [200, {}]);
    const f = flow(endpoints, async () => {}, 30);
    await expect(f.result).rejects.toMatchObject({ code: 'timeout' });
    await expect(fetch(`${f.opened().searchParams.get('redirect_uri')}?x=1`)).rejects.toThrow();
  });

  it('can be cancelled', async () => {
    const { endpoints } = await fakeGoogle(() => [200, {}]);
    const f = flow(endpoints, async () => {});
    await new Promise((r) => setTimeout(r, 20));
    f.abort();
    await expect(f.result).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('refresh reports invalid_grant by code', async () => {
    const { endpoints } = await fakeGoogle(() => [400, { error: 'invalid_grant' }]);
    await expect(refreshAccess(endpoints, client, 'rt')).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

describe('small things', () => {
  it('reads id token claims, and survives junk', () => {
    const t = `h.${Buffer.from(JSON.stringify({ sub: '1', email: 'a@b.c' })).toString('base64url')}.s`;
    expect(idClaims(t)).toEqual({ sub: '1', email: 'a@b.c' });
    expect(idClaims('nope')).toEqual({});
    expect(idClaims(undefined)).toEqual({});
  });
  it('compares versions', () => {
    expect(isNewer('v0.2.0', '0.1.9')).toBe(true);
    expect(isNewer('0.1.10', '0.1.9')).toBe(true);
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('v0.0.9', '0.1.0')).toBe(false);
  });
});
