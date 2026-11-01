/**
 * English text → Kokoro phonemes (the misaki phoneme set the model was trained
 * on). Words come from misaki's Apache-2.0 pronunciation dictionaries; a word
 * they lack goes through suffix rules and then our letter-to-sound rules. eSpeak
 * NG (GPL-3), which misaki and kokoro-js fall back to, is not used. Pure: the
 * dictionaries are passed in.
 */

export type Entry = string | Record<string, string | null> | null;
export type Lexicon = Record<string, Entry>;
export interface Lexicons { gold: Lexicon; silver: Lexicon }

const VOWELS = 'AIOWYQaiuæɑɒɔəɛɜɪʊʌᵻᵊ';
const startsVowel = (ps: string): boolean => VOWELS.includes(ps.replace(/^[ˈˌ]/, '')[0] ?? '');

const text = (e: Entry | undefined): string | null => (e == null ? null : typeof e === 'string' ? e : e.DEFAULT ?? e.None ?? null);

function look(lex: Lexicons, w: string): string | null {
  for (const v of [w, w.toLowerCase(), w[0]!.toUpperCase() + w.slice(1).toLowerCase()]) {
    const hit = text(lex.gold[v]) ?? text(lex.silver[v]);
    if (hit) return hit;
  }
  return null;
}

/** Suffix sounds as misaki's rules: voicing follows the stem's last sound. */
function plural(stem: string): string {
  const l = stem[stem.length - 1]!;
  if ('szʃʒʧʤ'.includes(l)) return `${stem}ᵻz`;
  return 'ptkfθ'.includes(l) ? `${stem}s` : `${stem}z`;
}
function past(stem: string): string {
  const l = stem[stem.length - 1]!;
  if ('td'.includes(l)) return `${stem}ᵻd`;
  return 'pkfθʃsʧ'.includes(l) ? `${stem}t` : `${stem}d`;
}

function suffixed(lex: Lexicons, w: string): string | null {
  const low = w.toLowerCase();
  const tryStem = (...c: string[]): string | null => { for (const s of c) { if (s.length < 2) continue; const p = look(lex, s); if (p) return p; } return null; };
  let m: string | null;
  if (/'s$/.test(low)) { m = wordPhonemes(lex, w.slice(0, -2)); return m ? plural(m) : null; }
  if (low.endsWith('ies') && (m = tryStem(`${low.slice(0, -3)}y`))) return plural(m);
  if (low.endsWith('es') && (m = tryStem(low.slice(0, -2), low.slice(0, -1)))) return plural(m);
  if (low.endsWith('s') && !low.endsWith('ss') && (m = tryStem(low.slice(0, -1)))) return plural(m);
  if (low.endsWith('ied') && (m = tryStem(`${low.slice(0, -3)}y`))) return past(m);
  if (low.endsWith('ed') && (m = tryStem(low.slice(0, -2), low.slice(0, -1), low.slice(0, -3)))) return past(m);
  if (low.endsWith('ing') && (m = tryStem(low.slice(0, -3), `${low.slice(0, -3)}e`, low.slice(0, -4)))) return `${m}ɪŋ`;
  if (low.endsWith('ly') && (m = tryStem(low.slice(0, -2)))) return `${m}li`;
  if (low.endsWith('er') && (m = tryStem(low.slice(0, -2), low.slice(0, -1)))) return `${m}əɹ`;
  return null;
}

/** Letter-to-sound for names and new words: longest pattern first. */
const RULES: [RegExp, string][] = [
  [/^tion/, 'ʃən'], [/^sion/, 'ʒən'], [/^ture/, 'ʧəɹ'], [/^ough/, 'O'], [/^augh/, 'ɔ'], [/^igh/, 'I'], [/^eigh/, 'A'],
  [/^tch/, 'ʧ'], [/^sch/, 'ʃ'], [/^ch/, 'ʧ'], [/^sh/, 'ʃ'], [/^th/, 'θ'], [/^ph/, 'f'], [/^wh/, 'w'], [/^ck/, 'k'], [/^ng/, 'ŋ'], [/^qu/, 'kw'], [/^kn/, 'n'], [/^wr/, 'ɹ'],
  [/^ee/, 'i'], [/^ea/, 'i'], [/^oo/, 'u'], [/^ai/, 'I'], [/^ay/, 'A'], [/^au/, 'W'], [/^aw/, 'ɔ'], [/^oa/, 'O'], [/^oi/, 'Y'], [/^oy/, 'Y'], [/^ou/, 'W'], [/^ow/, 'O'], [/^ie/, 'i'], [/^ei/, 'A'], [/^ey/, 'A'], [/^ue/, 'u'], [/^ui/, 'u'],
  [/^ar/, 'ɑɹ'], [/^er/, 'əɹ'], [/^ir/, 'ɜɹ'], [/^or/, 'ɔɹ'], [/^ur/, 'ɜɹ'],
  [/^a/, 'ɑ'], [/^e/, 'ɛ'], [/^i/, 'i'], [/^o/, 'O'], [/^u/, 'u'], [/^y/, 'j'],
  [/^c(?=[eiy])/, 's'], [/^g(?=[ei])/, 'ʤ'], [/^j/, 'ʤ'], [/^x/, 'ks'], [/^c/, 'k'], [/^g/, 'ɡ'], [/^r/, 'ɹ'], [/^q/, 'k'],
  [/^([bdfhklmnpstvwz])\1?/, '$1'],
];

/** Say an unknown word by its letters' usual sounds, stressed on the first vowel. */
export function spellOut(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length > 3) w = w.replace(/([^aeiou])e$/, '$1');
  let out = '';
  while (w) {
    const rule = RULES.find(([re]) => re.test(w));
    if (!rule) { w = w.slice(1); continue; }
    const m = rule[0].exec(w)!;
    out += m[0].replace(rule[0], rule[1]);
    w = w.slice(m[0].length);
  }
  const i = [...out].findIndex((c) => VOWELS.includes(c));
  return i < 0 ? out : `${[...out].slice(0, i).join('')}ˈ${[...out].slice(i).join('')}`;
}

function letters(lex: Lexicons, w: string): string {
  return [...w].map((c) => look(lex, c.toUpperCase()) ?? spellOut(c)).join(' ');
}

function wordPhonemes(lex: Lexicons, w: string): string {
  if (!w) return '';
  const hit = look(lex, w) ?? suffixed(lex, w);
  if (hit) return hit;
  if (/^[A-Z]{2,5}s?$/.test(w)) return letters(lex, w.replace(/s$/, ''));
  if (w.includes('-')) return w.split('-').filter(Boolean).map((p) => wordPhonemes(lex, p)).join(' ');
  return spellOut(w);
}

/**
 * Words said differently by what follows (misaki's rules): "the apple", "to
 * eat"; "a" as a word is weak, the letter is not.
 */
function inContext(w: string, ps: string, nextPs: string | undefined): string {
  const low = w.toLowerCase();
  if (low === 'the') return nextPs && startsVowel(nextPs) ? 'ði' : 'ðə';
  if (low === 'to') return nextPs && startsVowel(nextPs) ? 'tu' : 'tə';
  if (w === 'a' || w === 'A') return nextPs ? 'ɐ' : ps;
  return ps;
}

/** One run of English words, split by the caller into words and the marks between. */
export function englishWords(lex: Lexicons, words: string[]): string[] {
  const ps = words.map((w) => wordPhonemes(lex, w));
  return ps.map((p, i) => inContext(words[i]!, p, ps[i + 1]));
}

const SMALL = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = ' ten twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');

/** A whole number in English words. */
export function englishNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1e15) return String(n);
  n = Math.floor(n);
  if (n < 20) return SMALL[n]!;
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${SMALL[n % 10]}` : ''}`;
  if (n < 1000) return `${SMALL[Math.floor(n / 100)]} hundred${n % 100 ? ` ${englishNumber(n % 100)}` : ''}`;
  for (const [u, name] of [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']] as const) {
    if (n >= u) { const r = n % u; return `${englishNumber(Math.floor(n / u))} ${name}${r ? ` ${englishNumber(r)}` : ''}`; }
  }
  return String(n);
}

/** 1999 → "nineteen ninety nine"; 2005 → "two thousand five". */
export function englishYear(y: number): string {
  if (y < 1100 || y >= 2100 || y % 1000 < 10 || y % 100 === 0) return englishNumber(y);
  return `${englishNumber(Math.floor(y / 100))} ${y % 100 < 10 ? 'oh ' : ''}${englishNumber(y % 100)}`;
}

const ORD: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
export function englishOrdinal(n: number): string {
  const w = englishNumber(n).split(' ');
  const l = w.pop()!;
  w.push(ORD[l] ?? (l.endsWith('y') ? `${l.slice(0, -1)}ieth` : `${l}th`));
  return w.join(' ');
}
