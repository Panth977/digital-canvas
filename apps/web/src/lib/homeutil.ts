/**
 * Pure helpers for the Home page (Canva's home): design-type shortcuts,
 * the "Create a design" popular list, searching your designs, the
 * grid/list preference.
 */
import type { Preset } from '@digital-canvas/scene';

/** Canva's round shortcut row under the search bar. `preset` opens that size; `category` filters the size grid. */
export interface Shortcut {
  id: string;
  label: string;
  icon: 'text' | 'pen' | 'templates' | 'smile' | 'video' | 'image' | 'globe' | 'resize';
  /** Create straight away at this preset size. */
  preset?: string;
  /** Or show sizes of this category. */
  category?: string;
  /** Or create at a fixed size (whiteboard). */
  size?: { width: number; height: number };
}

export const SHORTCUTS: Shortcut[] = [
  { id: 'doc', label: 'Docs', icon: 'text', preset: 'a4' },
  { id: 'whiteboard', label: 'Whiteboards', icon: 'pen', size: { width: 5000, height: 3000 } },
  { id: 'presentation', label: 'Presentations', icon: 'templates', preset: 'presentation' },
  { id: 'social', label: 'Social media', icon: 'smile', category: 'Social' },
  { id: 'video', label: 'Videos', icon: 'video', category: 'Video' },
  { id: 'print', label: 'Print', icon: 'image', category: 'Print' },
  { id: 'website', label: 'Websites', icon: 'globe', category: 'Web' },
  { id: 'custom', label: 'Custom size', icon: 'resize' },
];

/** The sizes Canva lists first in "Create a design". */
export const POPULAR = ['instagram-post', 'story', 'presentation', 'a4', 'video', 'youtube-thumbnail', 'facebook-post', 'flyer-a4', 'poster-a3', 'logo', 'business-card', 'resume'];

export function popularPresets(all: Preset[]): Preset[] {
  return POPULAR.map((id) => all.find((p) => p.id === id)).filter((p): p is Preset => !!p);
}

/** Designs whose title contains every word of the query (case-insensitive). */
export function searchDesigns<T extends { title: string }>(list: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((d) => words.every((w) => d.title.toLowerCase().includes(w)));
}

export type HomeView = 'grid' | 'list';
const VIEW_KEY = 'dc:home-view';

export function loadView(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): HomeView {
  try {
    return storage?.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function saveView(v: HomeView, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(VIEW_KEY, v);
  } catch {
    // storage blocked: lasts this session
  }
}

/** A thumbnail box (max `max` px) with the design's aspect ratio. */
export function previewBox(p: { width: number; height: number }, max = 64): { w: number; h: number } {
  const r = p.width / p.height;
  return r >= 1 ? { w: max, h: Math.max(max / 6, max / r) } : { w: Math.max(max / 6, max * r), h: max };
}
