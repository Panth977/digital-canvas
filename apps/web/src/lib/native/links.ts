/**
 * App links for the native shell (also handy for scripted simulator runs):
 *   com.panth977.digitalcanvas://new[?w=1080&h=1350&title=…]  → new design, opened in the editor
 *   com.panth977.digitalcanvas://open/d/<id>                  → open a design
 * Sign-in URLs (…://auth) are handled by oauth.ts. For scripted runs without taps
 * (iOS asks before opening a URL from outside), the start page also accepts
 * `?applink=new` / `?applink=open/d/<id>` (Capacitor `server.appStartPath`).
 */
import { createDoc } from '@digital-canvas/scene';
import { APP_SCHEME } from './platform.ts';

export async function installAppLinks(): Promise<void> {
  const { App } = await import('@capacitor/app');
  const handle = (url: string | undefined) => void (url ? openAppLink(url) : undefined);
  await App.addListener('appUrlOpen', ({ url }) => handle(url));
  handle((await App.getLaunchUrl())?.url);
  const start = new URLSearchParams(location.search).get('applink');
  if (start) {
    history.replaceState(null, '', '/' + location.hash);
    handle(`${APP_SCHEME}://${start}`);
  }
}

async function openAppLink(url: string): Promise<void> {
  if (!url.startsWith(`${APP_SCHEME}://`)) return;
  const u = new URL(url.replace(`${APP_SCHEME}://`, 'https://app/'));
  const [, verb, ...rest] = u.pathname.split('/');
  if (verb === 'open' && rest[0] === 'd' && rest[1]) {
    location.hash = `#/d/${rest[1]}`;
  } else if (verb === 'new') {
    const { library } = await import('../library.svelte.ts');
    const n = (k: string, d: number) => Number(u.searchParams.get(k)) || d;
    const doc = createDoc({ width: n('w', 1080), height: n('h', 1080), unit: 'px', title: u.searchParams.get('title') ?? 'Untitled design' });
    await library.store.save({ doc, assets: new Map() });
    location.hash = `#/d/${doc.id}`;
  }
}
