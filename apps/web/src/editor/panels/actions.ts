/** Small Svelte actions for the side panels. */

/** Call `fn` when the node scrolls into view (`once`: then stop watching). */
export function inview(node: Element, opts: { fn: () => void; once?: boolean; margin?: string }) {
  let o = opts;
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    o.fn();
    if (o.once) io.disconnect();
  }, { rootMargin: opts.margin ?? '200px' });
  io.observe(node);
  return {
    update(next: typeof opts) { o = next; },
    destroy() { io.disconnect(); },
  };
}
