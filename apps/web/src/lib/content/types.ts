/**
 * Free content for the side panels (Elements, Photos, Videos, Audio): one
 * shape for every result, whichever open source it came from.
 */

/** What a result is, which decides how it goes into the design. */
export type Kind = 'graphic' | 'sticker' | 'icon' | 'illustration' | 'photo' | 'video' | 'audio';

export type SourceId = 'iconify' | 'openverse' | 'commons' | 'nasa';

/** Who made it and under which licence: kept with the asset in the design. */
export interface Credit {
  title: string;
  creator?: string;
  /** e.g. "CC BY 4.0", "CC0", "Public domain", "MIT". */
  license: string;
  /** The item's page at its source. */
  page?: string;
  /** Source name, e.g. "Openverse", "Wikimedia Commons". */
  source: string;
}

export interface Item {
  /** Unique across sources: `<source>:<id>`. */
  key: string;
  kind: Kind;
  source: SourceId;
  title: string;
  /** Small picture for the tile. */
  thumb: string;
  /** The file to download (photo, video, audio). Graphics use `icon` instead. */
  url?: string;
  /** Tried when `url` can't be downloaded (e.g. a host that refuses cross-origin requests). */
  fallback?: string;
  /** Small playable file for hover / play previews (videos, audio). */
  preview?: string;
  /** Iconify name (`prefix:name`) for graphics, stickers and icons. */
  icon?: string;
  /** NASA: the item's file list; the real file URLs are read from it on demand. */
  manifest?: string;
  width?: number;
  height?: number;
  /** Seconds (videos, audio). */
  duration?: number;
  /** Bytes, when the source says. */
  size?: number;
  credit: Credit;
}

/** One page of results and where the next page starts (`null`: no more). */
export interface Page<C = unknown> {
  items: Item[];
  next: C | null;
}

export type Fetch = typeof fetch;
