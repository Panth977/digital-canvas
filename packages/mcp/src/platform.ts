/**
 * What the tools need from the machine they run on. The tool core (server,
 * tools, rendering, GIF, PDF) is plain TypeScript; everything that differs
 * between Node and a browser sits behind this interface:
 *
 *  - Node (src/node/platform.ts): CanvasKit from node_modules, fonts and
 *    templates from disk, ffmpeg for video frames and MP4, DNS checks for
 *    URL imports. Used by the stdio CLI and the Cloud Function.
 *  - Browser (src/browser/platform.ts): CanvasKit WASM from a URL, fonts and
 *    templates the web app ships, WebCodecs (Mediabunny) for frames and MP4.
 *    Used by the device worker (the user's own browser or phone runs the tools).
 *
 * Exactly one platform is set per process (`setPlatform`); Node entry points
 * set theirs on import.
 */
import type { CanvasKit } from 'canvaskit-wasm';
import type { FontLibrary } from '@digital-canvas/render';
import type { ProjectFile } from '@digital-canvas/storage';

export interface TemplateEntry {
  id: string;
  title: string;
  category: string;
  tags: string;
  width: number;
  height: number;
  pages: number;
  fonts: string[];
  video?: boolean;
}

export interface VideoExportOptions {
  fps?: number;
  /** Longest side in px (default 1920). */
  maxSide?: number;
  onProgress?: (fraction: number) => void;
}

export interface Platform {
  /** 'node' | 'browser' (shown in errors and device info). */
  readonly name: string;
  /** CanvasKit, loaded once. */
  canvasKit(): Promise<CanvasKit>;
  /** Add the bundled faces (Inter) to a new font library. */
  loadBundledFonts(fonts: FontLibrary): Promise<void>;
  /** The built-in template catalogue (index.json). */
  templateIndex(): TemplateEntry[];
  /** One template's document JSON (unparsed). */
  templateDoc(id: string): Promise<unknown>;
  /** One frame of a video file as PNG, or null when this machine can't decode it. */
  videoFrame(bytes: Uint8Array, at: number, mime?: string): Promise<Uint8Array | null>;
  /** Why MP4 export can't run here (shown to the agent), or null when it can. */
  videoProblem(): string | null;
  /** The design as an MP4 (H.264 + AAC where possible). */
  exportMp4(file: ProjectFile, opts: VideoExportOptions): Promise<Uint8Array>;
  /** IP addresses of a host (servers refuse private ones). Omitted where there is no DNS API. */
  lookup?(host: string): Promise<string[]>;
  /** No network for fonts (tests). */
  readonly offline?: boolean;
}

let current: Platform | null = null;

export function setPlatform(p: Platform): void {
  current = p;
}

export function platform(): Platform {
  if (!current) throw new Error('Digital Canvas MCP: no platform set (import "@digital-canvas/mcp" in Node, or call setPlatform(browserPlatform(…)) in a browser)');
  return current;
}

export function hasPlatform(): boolean {
  return current !== null;
}
