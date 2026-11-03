/**
 * Mockups made from a photo (mockup plugins): `quadMockupBuffers` turns the
 * photo + four print-area corners into format-v1 maps for the existing
 * compositor. From `@digital-canvas/render/mockup` (no CanvasKit), so the
 * mockup worker can import it.
 */
export { quadAspect, quadMockupBuffers } from '@digital-canvas/render/mockup';

export type Corners = [[number, number], [number, number], [number, number], [number, number]];
export interface QuadSpec { corners: Corners; shade?: number; width: number; height: number }
