/**
 * The seam between template catalogues and the library build.
 *
 * A source turns one catalogue (Penpot Hub today) into `SourceBoard`s: a scene
 * document, its image files, who made it and under which licence. `build.ts`
 * does the rest (render, compare with `preview`, drop what breaks, write the
 * library, LICENSES and the credits data) and knows nothing about the source.
 *
 * Figma Community (approved, needs a token from Panth): add `figma.ts` with a
 * `figmaSource(token): TemplateSource` that reads `GET /v1/files/:key`, maps
 * nodes to scene elements the way `convert.ts` does, uses the Images API for
 * `preview` and image fills, and reads author and licence from the community
 * page. Then list it in `SOURCES` in `build.ts`. Nothing else changes.
 */
import type { Doc } from '@digital-canvas/scene';

export interface Credit {
  /** Name of the person or team, as the catalogue gives it. */
  author: string;
  authorUrl?: string;
  /** Catalogue the template came from, e.g. "Penpot Hub". */
  catalog: string;
  /** Page of the design in the catalogue. */
  sourceUrl: string;
  /** Direct link to the original file. */
  fileUrl?: string;
  /** SPDX id, e.g. CC-BY-4.0. */
  licence: string;
  licenceUrl: string;
  /** What we changed (CC BY asks for this). */
  note?: string;
}

export interface SourceBoard {
  /** Stable library id, also the file name. */
  id: string;
  title: string;
  category: string;
  tags: string;
  doc: Doc;
  /** Image bytes by `doc.assets` key. */
  assets: Map<string, Uint8Array>;
  credit: Credit;
  /** The source's own rendering of this design, when it ships one. */
  preview?: Uint8Array;
  /** Names of the pictures in the source design, so a person can check their rights. */
  images: string[];
  /** What didn't convert exactly (shown in the build report). */
  lossy: string[];
  /** Fixed-size text boxes whose text is centred or bottom-aligned: fitted after measuring. */
  valign: Map<string, 'center' | 'bottom'>;
}

export interface TemplateSource {
  name: string;
  /** Licences this source may publish; anything else is refused by the build. */
  boards(): AsyncIterable<SourceBoard>;
}

/** Only these may enter the library: they all allow redistribution with changes. */
export const ALLOWED_LICENCES = new Set(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'CC-BY-SA-4.0', 'MIT', 'Apache-2.0', 'OFL-1.1', 'ISC']);
