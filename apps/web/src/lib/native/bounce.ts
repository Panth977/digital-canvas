import { APP_SCHEME, APP_STATE_PREFIX } from './platform.ts';

/**
 * Runs first in main.ts, before anything else boots. When Google sends the
 * system browser back to /auth/callback for a sign-in the native app started
 * (state `dcapp.…`), hand the code to the app through its URL scheme instead
 * of signing this browser in. True when the page was taken over (main.ts then
 * mounts nothing). Evaluated on import, so it runs before any other module.
 */
export const bounced = bounceToApp();

function bounceToApp(): boolean {
  if (location.pathname !== '/auth/callback') return false;
  const q = new URLSearchParams(location.search);
  const state = q.get('state') ?? '';
  if (!state.startsWith(APP_STATE_PREFIX)) return false;
  const out = new URLSearchParams({ state });
  for (const k of ['code', 'error', 'scope']) {
    const v = q.get(k);
    if (v) out.set(k, v);
  }
  const target = `${APP_SCHEME}://auth?${out}`;
  // Don't leave the code in history or the address bar.
  history.replaceState(null, '', '/auth/callback');
  document.title = 'Back to Digital Canvas';
  document.body.innerHTML = `
    <main style="font:16px/1.5 system-ui,-apple-system,sans-serif;min-height:100vh;display:grid;place-items:center;margin:0;padding:24px;box-sizing:border-box;text-align:center;background:linear-gradient(135deg,#00c4cc,#7d2ae8);color:#fff">
      <div>
        <p style="font-size:20px;font-weight:700;margin:0 0 8px">${q.get('error') ? 'Sign-in was cancelled' : 'You’re signed in'}</p>
        <p style="margin:0 0 24px;opacity:.9">Going back to the Digital Canvas app…</p>
        <a data-testid="return-to-app" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#fff;color:#5b21b6;font-weight:700;text-decoration:none">Return to Digital Canvas</a>
      </div>
    </main>`;
  document.querySelector<HTMLAnchorElement>('[data-testid="return-to-app"]')!.href = target;
  location.href = target;
  return true;
}
