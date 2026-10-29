/**
 * Which AI providers this browser uses, and the default model per task.
 * Everything is in localStorage, on this device only:
 *   dc.ai.providers      [{id, kind, label, baseUrl?}]   (no keys)
 *   dc.ai.key.<id>       the provider's key
 *   dc.ai.defaults       {writing: {provider, model}, …}
 *   dc.ai.models.<id>    model list cache (12 h)
 * A key is only ever sent to its provider's endpoint (see the adapters).
 */
import { createProvider, kindInfo } from './registry.ts';
import { TASKS, type Cap, type ModelInfo, type Provider, type ProviderKind, type Task } from './types.ts';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl?: string;
}

export interface Choice {
  provider: string;
  model: string;
}

const P = 'dc.ai.providers', D = 'dc.ai.defaults', K = (id: string) => `dc.ai.key.${id}`, M = (id: string) => `dc.ai.models.${id}`;
const LEGACY = 'dc.anthropicKey';
const MODELS_TTL = 12 * 3600_000;

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch { return fallback; }
}
function write(k: string, v: unknown): void {
  try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ }
}
function readKey(id: string): string {
  try { return localStorage.getItem(K(id)) ?? ''; } catch { return ''; }
}

export const taskCap = (t: Task): Cap => TASKS.find((x) => x.id === t)!.cap;

/** Masked for display: never show a whole key. */
export const maskKey = (k: string) => (!k ? '' : k.length <= 12 ? '••••' : `${k.slice(0, 6)}…${k.slice(-4)}`);

class AISettings {
  providers = $state<ProviderConfig[]>([]);
  defaults = $state<Partial<Record<Task, Choice>>>({});
  /** Model lists read from the providers (by provider id). */
  models = $state<Record<string, ModelInfo[]>>({});
  /** Last "Test connection" per provider id. */
  status = $state<Record<string, { busy: boolean; ok?: boolean; text?: string }>>({});
  /** Bumped when keys change (keys aren't reactive state on purpose). */
  version = $state(0);

  constructor() {
    this.load();
  }

  load(): void {
    let list = read<ProviderConfig[]>(P, []);
    // r3 kept one Anthropic key: carry it over
    try {
      const legacy = localStorage.getItem(LEGACY);
      if (legacy && !list.some((p) => p.kind === 'anthropic')) {
        list = [{ id: 'anthropic', kind: 'anthropic', label: 'Anthropic' }, ...list];
        localStorage.setItem(K('anthropic'), legacy);
        write(P, list);
      }
      if (legacy) localStorage.removeItem(LEGACY);
    } catch { /* private mode */ }
    this.providers = list.filter((p) => p && p.id && p.kind);
    this.defaults = read(D, {});
    const models: Record<string, ModelInfo[]> = {};
    for (const p of this.providers) {
      const c = read<{ at: number; list: ModelInfo[] } | null>(M(p.id), null);
      if (c && Date.now() - c.at < MODELS_TTL) models[p.id] = c.list;
    }
    this.models = models;
    this.version++;
  }

  get any(): boolean {
    return this.providers.length > 0;
  }

  get(id: string): ProviderConfig | undefined {
    return this.providers.find((p) => p.id === id);
  }

  key(id: string): string {
    void this.version;
    return readKey(id);
  }

  /** Add (or replace the key of) a provider. Returns its id. */
  add(kind: ProviderKind, key: string, opts: { label?: string; baseUrl?: string } = {}): string {
    const info = kindInfo(kind);
    const base = opts.baseUrl?.trim().replace(/\/+$/, '');
    // one of each hosted kind; compatible endpoints are one per base URL
    const same = this.providers.find((p) => p.kind === kind && (kind !== 'compatible' || p.baseUrl === base));
    const id = same?.id ?? (kind === 'compatible' ? `compatible-${Math.random().toString(36).slice(2, 8)}` : kind);
    const cfg: ProviderConfig = { id, kind, label: opts.label?.trim() || same?.label || info.short, ...(base ? { baseUrl: base } : {}) };
    this.providers = same ? this.providers.map((p) => (p.id === id ? cfg : p)) : [...this.providers, cfg];
    write(P, this.providers);
    try { key.trim() ? localStorage.setItem(K(id), key.trim()) : localStorage.removeItem(K(id)); } catch { /* private mode */ }
    this.version++;
    return id;
  }

  remove(id: string): void {
    this.providers = this.providers.filter((p) => p.id !== id);
    write(P, this.providers);
    write(K(id), null);
    write(M(id), null);
    const d = { ...this.defaults };
    for (const t of Object.keys(d) as Task[]) if (d[t]?.provider === id) delete d[t];
    this.defaults = d;
    write(D, d);
    const { [id]: _, ...rest } = this.models;
    this.models = rest;
    const { [id]: __, ...st } = this.status;
    this.status = st;
    this.version++;
  }

  setDefault(task: Task, choice: Choice | null): void {
    const d = { ...this.defaults };
    if (choice) d[task] = choice;
    else delete d[task];
    this.defaults = d;
    write(D, d);
  }

  /** The adapter for a configured provider. */
  provider(id: string): Provider {
    const cfg = this.get(id);
    if (!cfg) throw new Error('That AI provider was removed.');
    return createProvider(cfg.kind, { key: readKey(id), ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}) });
  }

  /** Models of a provider that can do `cap` (read list, else the curated one). */
  modelsFor(id: string, cap: Cap): ModelInfo[] {
    const cfg = this.get(id);
    if (!cfg) return [];
    const list = this.models[id] ?? kindInfo(cfg.kind).models;
    return list.filter((m) => m.caps.includes(cap));
  }

  canDo(id: string, cap: Cap): boolean {
    const cfg = this.get(id);
    if (!cfg) return false;
    if (!kindInfo(cfg.kind).caps.includes(cap)) return false;
    const read = this.models[id];
    return !read || read.some((m) => m.caps.includes(cap)) || cfg.kind === 'compatible';
  }

  /** Check the key works (and read the model list). */
  async test(id: string): Promise<void> {
    this.status = { ...this.status, [id]: { busy: true } };
    try {
      const text = await this.provider(id).test();
      this.status = { ...this.status, [id]: { busy: false, ok: true, text } };
      await this.refreshModels(id).catch(() => {});
    } catch (e) {
      this.status = { ...this.status, [id]: { busy: false, ok: false, text: e instanceof Error ? e.message : String(e) } };
    }
  }

  /** Read the model list from the provider (cached 12 h). */
  async refreshModels(id: string): Promise<ModelInfo[]> {
    const list = await this.provider(id).listModels();
    this.models = { ...this.models, [id]: list };
    write(M(id), { at: Date.now(), list });
    return list;
  }

  /** The provider + model a task runs on: the chosen default, else the first provider that can do it. */
  choice(task: Task): Choice | null {
    const cap = taskCap(task);
    const d = this.defaults[task];
    if (d && this.get(d.provider)) return d;
    for (const p of this.providers) {
      if (!this.canDo(p.id, cap)) continue;
      const preferred = kindInfo(p.kind).defaults[task];
      const model = preferred ?? this.modelsFor(p.id, cap)[0]?.id;
      if (model) return { provider: p.id, model };
    }
    return null;
  }

  /** "Claude Sonnet 5.5 · Anthropic" for a task. */
  describe(task: Task): string {
    const c = this.choice(task);
    if (!c) return '';
    const cfg = this.get(c.provider)!;
    const m = [...(this.models[c.provider] ?? []), ...kindInfo(cfg.kind).models].find((x) => x.id === c.model);
    return `${m?.label ?? c.model} · ${cfg.label}`;
  }
}

export const aiSettings = new AISettings();
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __aiSettings?: AISettings }).__aiSettings = aiSettings;
