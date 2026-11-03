/**
 * Routes. Hash routes inside the app: `#/` home, `#/d/<docId>` editor.
 * Path routes for links people send (by Drive file id, see storage `shareLink`):
 * `/d/<fileId>` open a shared design, `/view/<fileId>` public read-only view,
 * `/template/<fileId>` make your own copy, `/plugin/<fileId>` install a shared plugin.
 */
export type Route =
  | { name: 'home' }
  | { name: 'editor'; id: string }
  | { name: 'shared'; fileId: string }
  | { name: 'view'; fileId: string }
  | { name: 'template'; fileId: string }
  | { name: 'plugin'; fileId: string }
  | { name: 'download' };

const PATHS = { d: 'shared', view: 'view', template: 'template', plugin: 'plugin' } as const;

export function parseRoute(pathname: string, hash: string): Route {
  if (/^\/download\/?$/.test(pathname)) return { name: 'download' };
  const p = /^\/(d|view|template|plugin)\/([\w-]+)\/?$/.exec(pathname);
  if (p) return { name: PATHS[p[1] as keyof typeof PATHS], fileId: p[2]! };
  const m = /^#\/d\/([\w-]+)/.exec(hash);
  return m ? { name: 'editor', id: m[1]! } : { name: 'home' };
}

const current = () => parseRoute(location.pathname, location.hash);

class Router {
  route = $state<Route>(current());

  constructor() {
    addEventListener('hashchange', () => (this.route = current()));
    addEventListener('popstate', () => (this.route = current()));
  }

  go(to: Route): void {
    if (to.name === 'download') history.pushState(null, '', '/download');
    else if (to.name === 'shared' || to.name === 'view' || to.name === 'template' || to.name === 'plugin') {
      const seg = to.name === 'shared' ? 'd' : to.name;
      history.pushState(null, '', `/${seg}/${to.fileId}`);
    } else {
      const hash = to.name === 'editor' ? `#/d/${to.id}` : '#/';
      // leaving a link page (/view/…): back to the app's own address
      if (location.pathname !== '/') history.replaceState(null, '', `/${hash}`);
      else location.hash = hash;
    }
    this.route = current(); // now, not at hashchange: quick key presses (Ctrl+Tab Ctrl+Tab) build on it
  }
}

export const router = new Router();
