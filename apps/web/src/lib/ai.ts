/**
 * AI features, bring-your-own-key: the user's Anthropic API key lives only in
 * this browser (localStorage) and is sent only to api.anthropic.com, straight
 * from the browser (the SDK adds `anthropic-dangerous-direct-browser-access`).
 */
import Anthropic from '@anthropic-ai/sdk';
import { designFromReply, newId, parseSvg, type CompleteResult, type Doc, type Page, type PathElement, type PendingIcon } from '@digital-canvas/scene';

export const AI_MODEL = 'claude-sonnet-5-5';
const KEY = 'dc.anthropicKey';

export function getKey(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}
export function setKey(k: string): void {
  try { k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}
export const looksLikeKey = (k: string) => /^sk-ant-[\w-]{10,}$/.test(k.trim());

export class AIError extends Error {
  override name = 'AIError';
}

type Content = Anthropic.Beta.BetaContentBlockParam[];

/** One request to Claude; returns the text of the reply. */
export async function ask(opts: { system: string; content: Content | string; maxTokens?: number; effort?: 'low' | 'medium' | 'high' }): Promise<string> {
  const apiKey = getKey();
  if (!apiKey) throw new AIError('Add your Anthropic API key first.');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages: [{ role: 'user', content: opts.content }],
      output_config: { effort: opts.effort ?? 'low' },
      // a declined request is retried on a fallback model chosen by the API
      betas: ['server-side-fallback-2026-07-01'],
      ...({ fallbacks: 'default' } as object),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AIError('That API key was refused. Check it in AI settings.');
    if (e instanceof Anthropic.RateLimitError) throw new AIError('Too many requests right now. Try again in a minute.');
    if (e instanceof Anthropic.APIConnectionError) throw new AIError('Couldn’t reach Anthropic. Check your connection.');
    if (e instanceof Anthropic.APIError) throw new AIError(`Anthropic said: ${e.message}`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new AIError('Claude declined this request. Try wording it differently.');
  const out = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
  if (!out) throw new AIError('Claude sent back an empty reply.');
  if (res.stop_reason === 'max_tokens') throw new AIError('The reply was cut off. Try a shorter request.');
  return out;
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
  const reply = await ask({
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
  const reply = await ask({
    system: designSystem(size.width, size.height),
    content: `${prompt.trim()}${brandHint ? `\n\n${brandHint}` : ''}`,
    effort: 'medium',
  });
  try {
    return designFromReply(reply, size);
  } catch (e) {
    throw new AIError(`Claude’s design couldn’t be read (${e instanceof Error ? e.message : e}). Try again.`);
  }
}

// ---- Describe / alt text ----

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Alt text for a page, from a PNG of it plus its words. */
export async function describePage(png: Uint8Array, page: Page, doc: Doc): Promise<string> {
  const words = page.elements.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join(' | ').slice(0, 2000);
  return ask({
    system: 'You write alt text for graphic designs. One or two plain sentences (under 60 words) that say what the design is, its main message and its look. No preamble.',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64(png) } },
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
