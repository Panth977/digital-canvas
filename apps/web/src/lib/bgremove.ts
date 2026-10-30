/**
 * Background remover: BiRefNet-lite at 512 px (MIT, any subject), run on the
 * device in a worker (`lib/vision`). Chosen in a bake-off of real product,
 * animal and people photos against MODNet and IS-Net (2026-10-31).
 *
 * `EditorState.bgRemover` can swap in another remover (tests use a stub).
 */
import { cutoutImage, inpaintImage, type Progress } from './vision/client.ts';

export type { Progress };

/** Turns an encoded image into a PNG of the same size with the background transparent. */
export type BackgroundRemover = (bytes: Uint8Array, mime: string, progress?: Progress) => Promise<Uint8Array>;

/** Fills the part of an image that `mask`'s alpha marks; returns a PNG of the same size. */
export type Inpainter = (bytes: Uint8Array, mime: string, mask: Uint8Array, progress?: Progress) => Promise<Uint8Array>;

export const removeBackground: BackgroundRemover = cutoutImage;
export const inpaintLocal: Inpainter = inpaintImage;
