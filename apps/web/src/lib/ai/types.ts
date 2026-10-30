/**
 * The provider layer: one interface for chat (text, vision, JSON) and for
 * media generation (images, videos), with one adapter per provider.
 * Keys live in this browser only and go to that provider's endpoint only.
 */

/** What a model can do. */
export type Cap = 'text' | 'vision' | 'json' | 'image' | 'video';

/** The jobs the user picks a default model for. */
export type Task = 'writing' | 'design' | 'vision' | 'image' | 'video';

export const TASKS: { id: Task; label: string; cap: Cap }[] = [
  { id: 'writing', label: 'Writing (Magic Write)', cap: 'text' },
  { id: 'design', label: 'Design for me', cap: 'text' },
  { id: 'vision', label: 'Vision (alt text)', cap: 'vision' },
  { id: 'image', label: 'Image generation', cap: 'image' },
  { id: 'video', label: 'Video generation', cap: 'video' },
];

export type ProviderKind = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'kie' | 'compatible';

export interface ModelInfo {
  id: string;
  label?: string;
  caps: Cap[];
}

export type ChatPart = { type: 'text'; text: string } | { type: 'image'; mime: string; data: string /* base64 */ };

export interface ChatRequest {
  model: string;
  system: string;
  content: string | ChatPart[];
  maxTokens?: number;
  /** Ask for a JSON object (structured output where the API has it; the caller still extracts + validates). */
  json?: boolean;
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

export interface Media {
  bytes: Uint8Array;
  mime: string;
}

export interface Progress {
  /** 0..1, or null when the provider doesn't say. */
  fraction: number | null;
  message: string;
}

export interface ImageRequest {
  model: string;
  prompt: string;
  /** Wanted width:height (the page's); adapters pick the nearest size they support. */
  aspect: { w: number; h: number };
  count: number;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
}

export interface ImageEditRequest {
  model: string;
  prompt: string;
  image: Media;
  /** PNG, the picture's size: clear where the model may paint. */
  mask: Media;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
}

export interface VideoRequest {
  model: string;
  prompt: string;
  aspect: { w: number; h: number };
  /** Seconds wanted; adapters round to what the model allows. */
  duration: number;
  /** Image-to-video: the first frame / reference. */
  image?: Media;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
}

export interface Provider {
  readonly kind: ProviderKind;
  /** Short check that the key works; resolves to a line for the user ("OK · 42 models"). */
  test(): Promise<string>;
  listModels(): Promise<ModelInfo[]>;
  chat?(req: ChatRequest): Promise<string>;
  images?(req: ImageRequest): Promise<Media[]>;
  /** Change the masked part of a picture from a prompt (Magic Edit, Magic Expand). */
  editImage?(req: ImageEditRequest): Promise<Media>;
  video?(req: VideoRequest): Promise<Media>;
}

export interface AdapterOptions {
  key: string;
  baseUrl?: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  /** Injectable for tests (polling). */
  sleep?: (ms: number) => Promise<void>;
}
