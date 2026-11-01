/**
 * Text → the phoneme string Kokoro reads, for English and Hindi, inside one
 * line too: runs of Devanagari go to the Hindi rules, Latin words to the
 * dictionaries. Also the id table (Kokoro's tokenizer is one character = one
 * token) and the splitting of long text. Pure.
 */
import { englishNumber, englishOrdinal, englishWords, englishYear, type Lexicons } from './english.ts';
import { hindiNumber, hindiWord } from './hindi.ts';

/** Kokoro v1.0's tokenizer.json, as a string of [char, id] pairs would be: only these reach the model. */
export const VOCAB: Record<string, number> = {
  $: 0, ';': 1, ':': 2, ',': 3, '.': 4, '!': 5, '?': 6, '—': 9, '…': 10, '"': 11, '(': 12, ')': 13, '“': 14, '”': 15, ' ': 16, '̃': 17, ʣ: 18, ʥ: 19, ʦ: 20, ʨ: 21, ᵝ: 22, ꭧ: 23,
  A: 24, I: 25, O: 31, Q: 33, S: 35, T: 36, W: 39, Y: 41, ᵊ: 42, a: 43, b: 44, c: 45, d: 46, e: 47, f: 48, h: 50, i: 51, j: 52, k: 53, l: 54, m: 55, n: 56, o: 57, p: 58, q: 59, r: 60, s: 61, t: 62, u: 63, v: 64, w: 65, x: 66, y: 67, z: 68,
  ɑ: 69, ɐ: 70, ɒ: 71, æ: 72, β: 75, ɔ: 76, ɕ: 77, ç: 78, ɖ: 80, ð: 81, ʤ: 82, ə: 83, ɚ: 85, ɛ: 86, ɜ: 87, ɟ: 90, ɡ: 92, ɥ: 99, ɨ: 101, ɪ: 102, ʝ: 103, ɯ: 110, ɰ: 111, ŋ: 112, ɳ: 113, ɲ: 114, ɴ: 115, ø: 116, ɸ: 118, θ: 119, œ: 120,
  ɹ: 123, ɾ: 125, ɻ: 126, ʁ: 128, ɽ: 129, ʂ: 130, ʃ: 131, ʈ: 132, ʧ: 133, ʊ: 135, ʋ: 136, ʌ: 138, ɣ: 139, ɤ: 140, χ: 142, ʎ: 143, ʒ: 147, ʔ: 148, ˈ: 156, ˌ: 157, ː: 158, ʰ: 162, ʲ: 164, '↓': 169, '→': 171, '↗': 172, '↘': 173, ᵻ: 177,
};

/** The model takes 510 tokens between its two pad tokens; stay well under, it rushes near the limit. */
export const MAX_TOKENS = 400;

const HINDI_DIGITS = /[०-९]/g;
const WHOLE = /(\d{1,3}(?:,\d{2,3})+|\d+)/;

const isHindi = (s: string): boolean => /[ऀ-ॿ]/.test(s);

/** Numbers, money, abbreviations and symbols as words. Hindi lines say them in Hindi. */
export function normalize(input: string): string {
  let s = input.normalize('NFC').replace(HINDI_DIGITS, (d) => String(d.charCodeAt(0) - 0x966));
  const hi = isHindi(s);
  const num = (v: string): string => { const n = Number(v.replace(/,/g, '')); return hi ? hindiNumber(n) : englishNumber(n); };
  s = s.replace(/[‘’]/g, "'").replace(/[«»]/g, '"').replace(/\s+/g, ' ').replace(/\s*[-–—]{2,}\s*/g, ' — ').replace(/\s–\s/g, ' — ').replace(/\.{3}/g, '…').replace(/।|॥/g, '.');
  if (!hi) {
    s = s.replace(/\bDr\.(?= )/g, 'Doctor').replace(/\bMr\.(?= )/g, 'Mister').replace(/\bMrs\.(?= )/g, 'Missus').replace(/\bMs\.(?= )/g, 'Miss').replace(/\bSt\.(?= [A-Z])/g, 'Saint').replace(/\betc\./g, 'et cetera').replace(/\bvs\.?(?= )/g, 'versus');
    s = s.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_, n: string) => englishOrdinal(Number(n)));
    s = s.replace(/\b(1\d{3}|20\d{2})s\b/g, (_, y: string) => `${englishYear(Number(y))}s`.replace(/ys$/, 'ies'));
    s = s.replace(/(?<![\d,.])\b(1[1-9]\d{2}|20\d{2})\b(?![\d,.%])/g, (_, y: string) => englishYear(Number(y)));
    s = s.replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h: string, m: string) => `${englishNumber(Number(h))} ${m === '00' ? "o'clock" : m[0] === '0' ? `oh ${englishNumber(Number(m))}` : englishNumber(Number(m))}`);
  }
  const money: [RegExp, string, string][] = hi
    ? [[/₹\s*/, 'रुपये', ''], [/\$\s*/, 'डॉलर', '']]
    : [[/₹\s*/, 'rupees', 'rupee'], [/\$\s*/, 'dollars', 'dollar'], [/€\s*/, 'euros', 'euro'], [/£\s*/, 'pounds', 'pound']];
  for (const [re, many, one] of money) {
    s = s.replace(new RegExp(`${re.source}${WHOLE.source}`, 'g'), (_, v: string) => `${num(v)} ${Number(v.replace(/,/g, '')) === 1 && one ? one : many}`);
  }
  s = s.replace(new RegExp(`${WHOLE.source}\\.(\\d+)`, 'g'), (_, a: string, b: string) => `${num(a)} ${hi ? 'दशमलव' : 'point'} ${[...b].map((d) => num(d)).join(' ')}`);
  s = s.replace(new RegExp(`${WHOLE.source}\\s*%`, 'g'), (_, v: string) => `${num(v)} ${hi ? 'प्रतिशत' : 'percent'}`);
  s = s.replace(new RegExp(WHOLE.source, 'g'), (_, v: string) => num(v));
  return s.replace(/&/g, hi ? ' और ' : ' and ').replace(/\+/g, hi ? ' प्लस ' : ' plus ').replace(/@/g, hi ? ' ऐट ' : ' at ').replace(/#/g, ' ').replace(/\s+/g, ' ').trim();
}

const TOKEN = /[ऀ-ॿ]+|[A-Za-z][A-Za-z'-]*|[;:,.!?—…"()“”]+|\s+|[\s\S]/gu;

/** Phonemes of one piece of text. */
export function phonemize(input: string, lex: Lexicons): string {
  const parts = normalize(input).match(TOKEN) ?? [];
  const out: string[] = [];
  let run: { words: string[]; at: number[] } | null = null;
  const flush = (): void => {
    if (!run) return;
    englishWords(lex, run.words).forEach((p, i) => (out[run!.at[i]!] = p));
    run = null;
  };
  for (const p of parts) {
    if (/^[ऀ-ॿ]/.test(p)) { flush(); out.push(hindiWord(p)); }
    else if (/^[A-Za-z]/.test(p)) { (run ??= { words: [], at: [] }).words.push(p); run.at.push(out.length); out.push(''); }
    else if (/^\s/.test(p)) out.push(' ');
    else if (/^[;:,.!?—…"()“”]/.test(p)) { if (/[.!?;:]/.test(p)) flush(); out.push(p); }
    // anything else (emoji, symbols) has no sound
  }
  flush();
  return out.join('').replace(/ +/g, ' ').replace(/ ([;:,.!?…])/g, '$1').trim();
}

/** Token ids: pad, phonemes the model knows, pad. */
export function tokenize(ps: string): number[] {
  const ids = [0];
  for (const c of ps) { const id = VOCAB[c]; if (id !== undefined) ids.push(id); }
  ids.push(0);
  return ids;
}

/** Cut phonemes into pieces the model can read: at sentence ends, then commas, then spaces. */
export function chunk(ps: string, max = MAX_TOKENS): string[] {
  const out: string[] = [];
  let rest = ps.trim();
  while ([...rest].length > max) {
    const head = [...rest].slice(0, max).join('');
    const at = Math.max(...['.', '!', '?', ';'].map((c) => head.lastIndexOf(`${c} `)));
    const comma = at > max / 3 ? at : Math.max(head.lastIndexOf(', '), head.lastIndexOf(': '));
    const cut = comma > max / 3 ? comma + 1 : Math.max(head.lastIndexOf(' '), 1);
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export const hasHindi = isHindi;
