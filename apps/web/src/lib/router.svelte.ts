/** Hash routes: `#/` home, `#/d/<id>` editor. */
export type Route = { name: 'home' } | { name: 'editor'; id: string };

function parse(hash: string): Route {
  const m = /^#\/d\/([\w-]+)/.exec(hash);
  return m ? { name: 'editor', id: m[1]! } : { name: 'home' };
}

class Router {
  route = $state<Route>(parse(location.hash));

  constructor() {
    addEventListener('hashchange', () => (this.route = parse(location.hash)));
  }

  go(to: Route): void {
    location.hash = to.name === 'editor' ? `#/d/${to.id}` : '#/';
    this.route = parse(location.hash); // now, not at hashchange: quick key presses (Ctrl+Tab Ctrl+Tab) build on it
  }
}

export const router = new Router();
