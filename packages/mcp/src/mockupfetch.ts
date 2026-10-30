/** Where the mockup library is published, and the plain HTTP read the platforms share (no other imports: platforms load it). */

/** The deployed site's library. */
export const MOCKUPS_URL = 'https://digital-canvas-p977.web.app/mockups/';

/** GET `<base><path>`. */
export async function fetchMockupFile(base: string, path: string): Promise<Uint8Array> {
  const res = await fetch(new URL(path, base));
  if (!res.ok) throw new Error(`mockup file ${path}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
