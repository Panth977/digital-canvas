/** Browser entry: the tool core + the browser platform + the device bridge (no node:* imports). */
export * from '../core.ts';
export { browserPlatform, type BrowserPlatformOptions } from './platform.ts';
export { exportMp4Browser, mixSounds, webCodecsProblem } from './mp4.ts';
export { videoFrameWebCodecs, decodeStereo } from './media.ts';
