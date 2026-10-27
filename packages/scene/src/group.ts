import type { Doc, Element, GroupElement } from './types.ts';
import { newId } from './doc.ts';
import { boundsOf, childrenOf, mapLists, pathTo } from './tree.ts';

/**
 * Group and ungroup. A group's children keep their page coordinates, so
 * grouping only moves elements into a new list; nothing is re-laid out.
 */

const touch = (doc: Doc, pages: Doc['pages']): Doc => ({ ...doc, pages, updatedAt: new Date().toISOString() });

/**
 * Put `ids` into one new group, where the topmost of them was. They must share
 * a list (a page, or one group); returns null when fewer than two do.
 */
export function groupElements(doc: Doc, ids: string[]): { doc: Doc; id: string } | null {
  const set = new Set(ids);
  for (const page of doc.pages) {
    const first = ids.map((id) => pathTo(page.elements, id)).find(Boolean);
    if (!first) continue;
    const parentId = first.length > 1 ? first[first.length - 2]!.id : null;
    const list = parentId ? childrenOf(first[first.length - 2]!)! : page.elements;
    const members = list.filter((e) => set.has(e.id));
    if (members.length < 2) return null;
    const box = boundsOf(members)!;
    const group: GroupElement = { id: newId('e_'), type: 'group', ...box, rotation: 0, opacity: 1, children: members };
    const top = Math.max(...members.map((m) => list.indexOf(m)));
    const regroup = (l: Element[]): Element[] => {
      if (l !== list) return l;
      const out: Element[] = [];
      l.forEach((e, i) => {
        if (i === top) out.push(group);
        else if (!set.has(e.id)) out.push(e);
      });
      return out;
    };
    const pages = doc.pages.map((p) => (p === page ? { ...p, elements: mapLists(p.elements, regroup) } : p));
    return { doc: touch(doc, pages), id: group.id };
  }
  return null;
}

/**
 * Replace the groups among `ids` with their children, in place. The group's
 * opacity is multiplied into each child; a hidden or locked group passes that on.
 */
export function ungroupElements(doc: Doc, ids: string[]): { doc: Doc; ids: string[] } {
  const set = new Set(ids);
  const out: string[] = [];
  const pages = doc.pages.map((p) => {
    const elements = mapLists(p.elements, (list) => {
      if (!list.some((e) => set.has(e.id) && childrenOf(e))) return list;
      return list.flatMap((e) => {
        const kids = set.has(e.id) ? childrenOf(e) : undefined;
        if (!kids) return [e];
        return kids.map((k) => {
          out.push(k.id);
          const c: Element = { ...k, opacity: k.opacity * e.opacity };
          if (e.hidden) c.hidden = true;
          if (e.locked) c.locked = true;
          return c;
        });
      });
    });
    return elements === p.elements ? p : { ...p, elements };
  });
  return { doc: out.length ? touch(doc, pages) : doc, ids: out };
}
