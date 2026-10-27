import type { ProjectFile } from './file.ts';
import { MemoryBrand, type BrandData } from './brand.ts';

export interface ProjectMeta {
  id: string;
  title: string;
  updatedAt: string;
  width: number;
  height: number;
  thumbnail?: Uint8Array;
  /** A thumbnail the store serves itself (Drive). */
  thumbnailUrl?: string;
}

/**
 * Where projects live. The browser store, a local folder and (in M2) the
 * user's Google Drive all implement this, so the editor doesn't care.
 */
export interface ProjectStore {
  readonly kind: 'memory' | 'browser' | 'folder' | 'drive';
  /** Shown in the UI, e.g. the folder name. */
  readonly label: string;
  list(): Promise<ProjectMeta[]>;
  open(id: string): Promise<ProjectFile>;
  save(file: ProjectFile): Promise<void>;
  remove(id: string): Promise<void>;
  /** The brand kit kept alongside the designs (see brand.ts). */
  loadBrand?(): Promise<BrandData | null>;
  saveBrand?(data: BrandData): Promise<void>;
}

export function metaOf(file: ProjectFile): ProjectMeta {
  const { doc } = file;
  return { id: doc.id, title: doc.title, updatedAt: doc.updatedAt, width: doc.width, height: doc.height, thumbnail: file.thumbnail };
}

export function byRecent(a: ProjectMeta, b: ProjectMeta): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/** In-memory store, for tests. */
export class MemoryStore implements ProjectStore {
  readonly kind = 'memory';
  readonly label = 'Memory';
  private files = new Map<string, ProjectFile>();

  async list() { return [...this.files.values()].map(metaOf).sort(byRecent); }
  async open(id: string) {
    const f = this.files.get(id);
    if (!f) throw new Error(`no project ${id}`);
    return f;
  }
  async save(file: ProjectFile) { this.files.set(file.doc.id, file); }
  async remove(id: string) { this.files.delete(id); }
  private brand = new MemoryBrand();
  loadBrand() { return this.brand.loadBrand(); }
  saveBrand(data: BrandData) { return this.brand.saveBrand(data); }
}
