import { AnthropicProvider, ANTHROPIC_MODELS } from './anthropic.ts';
import { CompatibleProvider, OpenRouterProvider } from './compat.ts';
import { GeminiProvider, GEMINI_MODELS } from './gemini.ts';
import { KieProvider, KIE_MODELS } from './kie.ts';
import { OpenAIProvider, OPENAI_MODELS } from './openai.ts';
import type { AdapterOptions, Cap, ModelInfo, Provider, ProviderKind, Task } from './types.ts';

export interface KindInfo {
  kind: ProviderKind;
  label: string;
  blurb: string;
  keyUrl?: string;
  keyHint: string;
  /** Rough shape check for a pasted key (null = anything). */
  keyPattern: RegExp | null;
  needsBaseUrl?: boolean;
  /** What it can do at all. */
  caps: Cap[];
  /** Curated models (used when the models endpoint can't be read). */
  models: ModelInfo[];
  /** Default model per task. */
  defaults: Partial<Record<Task, string>>;
  /** The one host the key is sent to (shown in the UI). */
  host: string;
}

export const KINDS: KindInfo[] = [
  {
    kind: 'anthropic', label: 'Anthropic (Claude)', blurb: 'Claude for writing, designs and alt text.', keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…', keyPattern: /^sk-ant-[\w-]{10,}$/,
    caps: ['text', 'vision', 'json'], models: ANTHROPIC_MODELS, host: 'api.anthropic.com',
    defaults: { writing: 'claude-sonnet-5-5', design: 'claude-sonnet-5-5', vision: 'claude-sonnet-5-5' },
  },
  {
    kind: 'openai', label: 'OpenAI (GPT, GPT Image, Sora)', blurb: 'GPT for text and vision, GPT Image for pictures, Sora for video.', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…', keyPattern: /^sk-[\w-]{10,}$/,
    caps: ['text', 'vision', 'json', 'image', 'video'], models: OPENAI_MODELS, host: 'api.openai.com',
    defaults: { writing: 'gpt-6.1-terra', design: 'gpt-6.1-sol', vision: 'gpt-6.1-terra', image: 'gpt-image-2.5-flare', video: 'sora-2' },
  },
  {
    kind: 'gemini', label: 'Google Gemini', blurb: 'Gemini for text and vision, Nano Banana for pictures, Omni Flash for video.', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…', keyPattern: /^[\w-]{30,}$/,
    caps: ['text', 'vision', 'json', 'image', 'video'], models: GEMINI_MODELS, host: 'generativelanguage.googleapis.com',
    defaults: { writing: 'gemini-3.8-flash', design: 'gemini-3.8-flash', vision: 'gemini-3.8-flash', image: 'gemini-nano-banana-2.1', video: 'gemini-omni-1.1-flash' },
  },
  {
    kind: 'openrouter', label: 'OpenRouter (any model)', blurb: 'One key for hundreds of models from every lab, including image models.', keyUrl: 'https://openrouter.ai/settings/keys', keyHint: 'sk-or-…', keyPattern: /^sk-or-[\w-]{10,}$/,
    caps: ['text', 'vision', 'json', 'image'], host: 'openrouter.ai',
    models: [
      { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', caps: ['text', 'vision', 'json'] },
      { id: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol', caps: ['text', 'vision', 'json'] },
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', caps: ['text', 'vision', 'json'] },
      { id: 'google/gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', caps: ['image'] },
    ],
    defaults: { writing: 'google/gemini-3.8-flash', design: 'anthropic/claude-sonnet-5.5', vision: 'google/gemini-3.8-flash', image: 'google/gemini-3.1-flash-image' },
  },
  {
    kind: 'kie', label: 'kie.ai (image & video models)', blurb: 'Nano Banana, Seedream, GPT Image, Imagen, Grok Imagine and Kling through one key.', keyUrl: 'https://kie.ai/api-key', keyHint: 'your kie.ai API key', keyPattern: /^[\w-]{16,}$/,
    caps: ['image', 'video'], models: KIE_MODELS.map(({ id, label, caps }) => ({ id, ...(label ? { label } : {}), caps })), host: 'api.kie.ai',
    defaults: { image: 'google/nano-banana', video: 'kling-2.6/text-to-video' },
  },
  {
    kind: 'compatible', label: 'OpenAI-compatible endpoint', blurb: 'Groq, Together, Mistral, DeepSeek, Ollama, LM Studio or any /v1 endpoint.', keyHint: 'API key (blank for local servers)', keyPattern: null, needsBaseUrl: true,
    caps: ['text', 'vision', 'json', 'image'], models: [], host: '',
    defaults: {},
  },
];

export const kindInfo = (k: ProviderKind): KindInfo => KINDS.find((x) => x.kind === k)!;

export function createProvider(kind: ProviderKind, o: AdapterOptions): Provider {
  switch (kind) {
    case 'anthropic': return new AnthropicProvider(o);
    case 'openai': return new OpenAIProvider(o);
    case 'gemini': return new GeminiProvider(o);
    case 'openrouter': return new OpenRouterProvider(o);
    case 'kie': return new KieProvider(o);
    case 'compatible': return new CompatibleProvider(o);
  }
}
