import type { ProjectStore } from '@digital-canvas/storage';
import { tabs } from '../tabs.svelte.ts';
import { toast } from '../toast.svelte.ts';

const warned = new Set<string>();

/**
 * Something outside the window changed the folder. Open designs that changed on
 * disk reload, unless they hold edits not saved yet; those stay, with a warning
 * (saving then keeps this copy). Returns the ids that reloaded.
 */
export async function syncOpenDesigns(store: ProjectStore): Promise<string[]> {
  const metas = new Map((await store.list()).map((m) => [m.id, m]));
  const reloaded: string[] = [];
  for (const id of tabs.liveIds()) {
    const ed = tabs.session(id).ed;
    const m = metas.get(id);
    if (!ed || ed.store !== store || !m || m.updatedAt <= ed.doc.updatedAt) continue;
    if (ed.saveState === 'saved') {
      tabs.discard(id);
      reloaded.push(id);
    } else if (!warned.has(`${id}:${m.updatedAt}`)) {
      warned.add(`${id}:${m.updatedAt}`);
      toast.show(`“${m.title}” also changed on disk. Your next save replaces that change.`);
    }
  }
  return reloaded;
}
