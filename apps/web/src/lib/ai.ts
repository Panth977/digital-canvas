/**
 * AI features (Magic Write, Design for me, alt text) on whichever provider
 * the user picked for each task (AI panel ▸ AI providers). Bring-your-own-key:
 * keys stay in this browser and go only to that provider (lib/ai/).
 */
import { designFromReply, newId, parseSvg, type CompleteResult, type Doc, type Page, type PathElement, type PendingIcon } from '@digital-canvas/scene';
import { aiSettings } from './ai/settings.svelte.ts';
import { AIError, base64 } from './ai/http.ts';
import type { ChatPart, Task } from './ai/types.ts';

export { AIError };

/** One chat request on the task's provider + model; returns the reply text. */
export async function ask(task: Task, opts: { system: string; content: string | ChatPart[]; maxTokens?: number; effort?: 'low' | 'medium' | 'high'; json?: boolean; signal?: AbortSignal }): Promise<string> {
  const c = aiSettings.choice(task);
  if (!c) throw new AIError('Add an AI provider first (AI providers).');
  return aiSettings.provider(c.provider).chat!({ model: c.model, ...opts });
}

// ---- Magic Write ----

export type WriteAction = 'rewrite' | 'shorter' | 'longer' | 'formal' | 'fun' | 'fix' | 'translate' | 'continue' | 'custom';

export const WRITE_ACTIONS: { id: WriteAction; label: string }[] = [
  { id: 'rewrite', label: 'Rewrite' },
  { id: 'shorter', label: 'Shorter' },
  { id: 'longer', label: 'Longer' },
  { id: 'formal', label: 'More formal' },
  { id: 'fun', label: 'More fun' },
  { id: 'fix', label: 'Fix spelling' },
  { id: 'continue', label: 'Continue writing' },
];

const INSTRUCTIONS: Record<Exclude<WriteAction, 'translate' | 'custom'>, string> = {
  rewrite: 'Rewrite it with fresh wording, same meaning and length.',
  shorter: 'Make it noticeably shorter while keeping the point.',
  longer: 'Expand it with a little more detail (at most about twice as long).',
  formal: 'Make the tone more formal and professional.',
  fun: 'Make the tone playful and fun; an emoji is fine if it fits.',
  fix: 'Fix spelling, grammar and punctuation only; change nothing else.',
  continue: 'Return the original text followed by a natural continuation of one or two sentences.',
};

/** Rewrite design copy. `text` empty + 'custom' writes new copy from the prompt. */
export async function magicWrite(text: string, action: WriteAction, extra = ''): Promise<string> {
  const how = action === 'translate' ? `Translate it into ${extra || 'Hindi'}.` : action === 'custom' ? extra : INSTRUCTIONS[action];
  const reply = await ask('writing', {
    system: 'You edit short copy for graphic designs (posters, social posts, slides). Reply with only the new text — no quotes, no preamble, no notes. Keep line breaks where they help the layout.',
    content: text.trim() ? `${how}\n\nText:\n${text}` : `Write copy for a design. ${how}`,
    maxTokens: 2000,
  });
  return reply.replace(/^["“](.*)["”]$/s, '$1');
}

// ---- Design for me ----

/** The compact format the model writes (packages/scene/src/loose.ts reads it). */
export function designSystem(width: number, height: number): string {
  return `You are a senior graphic designer. You design one page for a design editor whose pages are ${Math.round(width)}×${Math.round(height)} px (origin top-left).
Answer with ONE JSON object in a \`\`\`json block and nothing else. Format:
{"pages":[{"background": <fill>, "elements": [<element>, ...]}]}
<fill> is "#rrggbb" or {"type":"linear","angle":deg,"colors":["#..","#.."]}.
Elements (all lengths px; later elements are drawn on top):
- {"type":"shape","shape":"rect|ellipse|triangle|diamond|pentagon|hexagon|star|arrow","x","y","w","h","fill":<fill>|null,"stroke":{"color","width"}|null,"radius":corner px,"opacity":0..1,"rotation":deg}
- {"type":"text","text":"…(\\n for new lines)","x","y","w","fontFamily":"<any Google Font>","fontSize","color","align":"left|center|right","bold","italic","uppercase","letterSpacing","lineHeight"}  (height is measured for you)
- {"type":"icon","icon":"<Iconify name, e.g. fluent-emoji-flat:hot-beverage, mdi:phone, ph:star>","x","y","w","h","color"}
- {"type":"line","x1","y1","x2","y2","stroke":{"color","width"},"endMarker":"none|arrow"}
- {"type":"chart","chart":"column|bar|line|pie|donut","x","y","w","h","labels":[…],"series":[{"name","values":[…]}],"colors":[…]}
- {"type":"table","x","y","w","rows":[["Head","Head"],["cell","cell"]],"headerFill":"#.."}
Rules: keep everything inside the page with comfortable margins; strong hierarchy (one big headline); 2–3 fonts at most; 3–5 harmonious colours with good contrast; prefer fluent-emoji-flat icons for illustrations; no images or photos; realistic, specific copy (no lorem ipsum).`;
}

export async function designForMe(prompt: string, size: { width: number; height: number }, brandHint = ''): Promise<CompleteResult> {
  const system = designSystem(size.width, size.height);
  const brief = `${prompt.trim()}${brandHint ? `\n\n${brandHint}` : ''}`;
  const reply = await ask('design', { system, content: brief, effort: 'medium', json: true });
  try {
    return designFromReply(reply, size);
  } catch (e) {
    // one more try, telling the model what was wrong (models without structured output slip sometimes)
    const why = e instanceof Error ? e.message : String(e);
    const again = await ask('design', {
      system,
      content: `${brief}\n\nYour previous answer could not be used: ${why}.\nPrevious answer (start):\n${reply.slice(0, 4000)}\n\nAnswer again with ONE valid JSON object in the format above and nothing else.`,
      effort: 'medium',
      json: true,
    });
    try {
      return designFromReply(again, size);
    } catch (e2) {
      throw new AIError(`The AI’s design couldn’t be read (${e2 instanceof Error ? e2.message : e2}). Try again or pick another model.`);
    }
  }
}

// ---- Describe / alt text ----

/** Alt text for a page, from a PNG of it plus its words. */
export async function describePage(png: Uint8Array, page: Page, doc: Doc): Promise<string> {
  const words = page.elements.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join(' | ').slice(0, 2000);
  return ask('vision', {
    system: 'You write alt text for graphic designs. One or two plain sentences (under 60 words) that say what the design is, its main message and its look. No preamble.',
    content: [
      { type: 'image', mime: 'image/png', data: base64(png) },
      { type: 'text', text: `Design "${doc.title}", ${Math.round(doc.width)}×${Math.round(doc.height)} px. Words on it: ${words || '(none)'}` },
    ],
    maxTokens: 1000,
  });
}

/** Fetch the icons a generated design asked for and put them in as vectors (missing ones are skipped). */
export async function resolveIcons(doc: Doc, icons: PendingIcon[], fetchSvg: (name: string) => Promise<string>): Promise<Doc> {
  const pages = doc.pages.map((p) => ({ ...p, elements: [...p.elements] }));
  const made = await Promise.all(icons.map(async (ic) => {
    try {
      const parsed = parseSvg(await fetchSvg(ic.icon), ic.color);
      if (!parsed) return null;
      const s = Math.min(ic.box.w / parsed.viewBox.w, ic.box.h / parsed.viewBox.h);
      const w = parsed.viewBox.w * s, h = parsed.viewBox.h * s;
      const el: PathElement = {
        id: newId('e_'), type: 'path', name: ic.icon, x: ic.box.x + (ic.box.w - w) / 2, y: ic.box.y + (ic.box.h - h) / 2, w, h, rotation: ic.box.rotation, opacity: ic.box.opacity,
        viewBox: parsed.viewBox, paths: parsed.paths.map((p) => (p.stroke ? { ...p, stroke: { ...p.stroke, width: p.stroke.width * s } } : p)),
      };
      return { ic, el };
    } catch {
      return null;
    }
  }));
  const shift = new Map<number, number>();
  for (const m of made.filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.ic.page - b.ic.page || a.ic.index - b.ic.index)) {
    const k = shift.get(m.ic.page) ?? 0;
    pages[m.ic.page]?.elements.splice(m.ic.index + k, 0, m.el);
    shift.set(m.ic.page, k + 1);
  }
  return { ...doc, pages };
}
