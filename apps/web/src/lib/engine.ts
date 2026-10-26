import CanvasKitInit from 'canvaskit-wasm/bin/canvaskit.js';
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';
import type { CanvasKit } from 'canvaskit-wasm';
import { FontLibrary } from '@digital-canvas/render';

export interface Engine {
  ck: CanvasKit;
  fonts: FontLibrary;
}

let loading: Promise<Engine> | null = null;

/** CanvasKit + the bundled fonts, loaded once per tab. */
export function engine(): Promise<Engine> {
  loading ??= (async () => {
    const ck = await CanvasKitInit({ locateFile: () => wasmUrl });
    const fonts = new FontLibrary(ck);
    await fonts.loadBundled(`${import.meta.env.BASE_URL}fonts/`);
    return { ck, fonts };
  })();
  return loading;
}
