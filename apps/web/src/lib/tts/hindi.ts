/**
 * Hindi text → Kokoro phonemes. Our own rules for Devanagari, written from the
 * script's spelling and the standard account of Hindi schwa deletion (Ohala,
 * 1983); no eSpeak NG code or data (GPL-3) is used or needed. Pure.
 *
 * Approximate: schwa deletion is by rule, so compounds and some loan words can
 * keep or drop the wrong schwa. Word stress is a weight heuristic.
 */

const C: Record<string, string> = {
  क: 'k', ख: 'kʰ', ग: 'ɡ', घ: 'ɡʰ', ङ: 'ŋ', च: 'c', छ: 'cʰ', ज: 'ɟ', झ: 'ɟʰ', ञ: 'ɲ', ट: 'ʈ', ठ: 'ʈʰ', ड: 'ɖ', ढ: 'ɖʰ', ण: 'ɳ',
  त: 't', थ: 'tʰ', द: 'd', ध: 'dʰ', न: 'n', प: 'p', फ: 'pʰ', ब: 'b', भ: 'bʰ', म: 'm', य: 'j', र: 'ɾ', ल: 'l', ळ: 'l', व: 'ʋ', श: 'ʃ', ष: 'ʂ', स: 's', ह: 'h',
};
/** With a nukta (after NFD, a separate mark): the Perso-Arabic sounds and the flaps. */
const NUKTA: Record<string, string> = { क: 'q', ख: 'x', ग: 'ɣ', ज: 'z', झ: 'ʒ', ड: 'ɽ', ढ: 'ɽʰ', फ: 'f' };
const V: Record<string, string> = { अ: 'ə', आ: 'aː', इ: 'ɪ', ई: 'iː', उ: 'ʊ', ऊ: 'uː', ऋ: 'ɾɪ', ए: 'eː', ऐ: 'ɛː', ओ: 'oː', औ: 'ɔː', ऑ: 'ɔː', ऍ: 'ɛː' };
const M: Record<string, string> = { 'ा': 'aː', 'ि': 'ɪ', 'ी': 'iː', 'ु': 'ʊ', 'ू': 'uː', 'ृ': 'ɾɪ', 'े': 'eː', 'ै': 'ɛː', 'ो': 'oː', 'ौ': 'ɔː', 'ॉ': 'ɔː', 'ॅ': 'ɛː' };
const VIRAMA = '्', NUKTA_MARK = '़', ANUSVARA = 'ं', CANDRABINDU = 'ँ', VISARGA = 'ः', AVAGRAHA = 'ऽ';

/** A consonant, or a vowel that may carry nasality. */
type Seg = { c: string } | { v: string; nasal?: boolean };
const isV = (s: Seg | undefined): s is { v: string; nasal?: boolean } => !!s && 'v' in s;

/** A nasal consonant before a stop takes the stop's place (अंग → əŋɡ); elsewhere the vowel is nasal. */
function homorganic(next: string | undefined): string | null {
  if (!next) return null;
  const c = next[0]!;
  if ('kɡ'.includes(c)) return 'ŋ';
  if ('cɟ'.includes(c)) return 'ɲ';
  if ('ʈɖ'.includes(c)) return 'ɳ';
  if ('td'.includes(c)) return 'n';
  if ('pb'.includes(c)) return 'm';
  return null;
}

function segments(word: string): Seg[] {
  const ch = [...word.normalize('NFD')];
  const out: Seg[] = [];
  for (let i = 0; i < ch.length; i++) {
    const x = ch[i]!;
    if (C[x]) {
      const nukta = ch[i + 1] === NUKTA_MARK;
      if (nukta) i++;
      out.push({ c: (nukta && NUKTA[x]) || C[x]! });
      const n = ch[i + 1];
      if (n === VIRAMA) { i++; continue; }
      if (n && M[n]) { i++; out.push({ v: M[n]! }); } else out.push({ v: 'ə' });
    } else if (V[x]) out.push({ v: V[x]! });
    else if (x === ANUSVARA || x === CANDRABINDU) {
      const last = out[out.length - 1];
      const nextC = C[ch[i + 1] ?? ''];
      const nasal = x === ANUSVARA ? homorganic(nextC) : null;
      if (nasal) out.push({ c: nasal });
      else if (isV(last)) last.nasal = true;
    } else if (x === VISARGA) out.push({ c: 'h' });
    // the avagraha and marks we don't know add no sound
    else if (x === AVAGRAHA) continue;
  }
  // क्ष and ज्ञ are said kʃ and ɡj in Hindi, not as their letters
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i]!, b = out[i + 1]!;
    if (isV(a) || isV(b)) continue;
    if (a.c === 'k' && b.c === 'ʂ') b.c = 'ʃ';
    if (a.c === 'ɟ' && b.c === 'ɲ') { a.c = 'ɡ'; b.c = 'j'; }
  }
  return out;
}

/** Schwa deletion: the word's last schwa, then VC_CV from the right. */
function dropSchwas(s: Seg[]): Seg[] {
  const out = s.slice();
  const last = out.length - 1;
  const lastSeg = out[last];
  if (isV(lastSeg) && lastSeg.v === 'ə' && !lastSeg.nasal && out.filter(isV).length > 1) {
    // मित्र, शुक्र keep it: a final cluster closing in r or j needs a vowel
    const c1 = out[last - 1], c2 = out[last - 2];
    const cluster = c1 && c2 && !isV(c1) && !isV(c2);
    const keep = cluster && 'c' in c1 && (c1.c === 'ɾ' || c1.c === 'j');
    if (!keep) out.pop();
  }
  for (let i = out.length - 2; i > 1; i--) {
    const seg = out[i];
    if (!isV(seg) || seg.v !== 'ə' || seg.nasal) continue;
    if (isV(out[i - 2]) && !isV(out[i - 1]) && !isV(out[i + 1]) && isV(out[i + 2])) out.splice(i, 1);
  }
  return out;
}

/** Function words said without stress. */
const CLITIC = new Set(['का', 'के', 'की', 'को', 'से', 'में', 'पर', 'ने', 'और', 'है', 'हैं', 'हूँ', 'हो', 'भी', 'ही', 'तो', 'या', 'न', 'कि', 'जो', 'यह', 'वह', 'हम', 'तुम', 'मैं']);

function render(word: string, s: Seg[]): string {
  const vowels: number[] = [];
  s.forEach((x, i) => { if (isV(x)) vowels.push(i); });
  let stress = -1;
  if (vowels.length && !CLITIC.has(word)) {
    let top = -1;
    vowels.forEach((vi, n) => {
      const x = s[vi] as { v: string };
      const long = x.v.endsWith('ː');
      const lastSyll = n === vowels.length - 1;
      const after = (vowels[n + 1] ?? s.length) - vi - 1;
      const closed = lastSyll ? after > 0 : after > 1;
      if (lastSyll && !closed && vowels.length > 1) return;
      const w = (long ? 2 : 0) + (closed ? 1 : 0);
      if (w > top || (w === top && long)) { top = w; stress = vi; }
    });
    if (top <= 0) stress = vowels[0]!;
  }
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const x = s[i]!;
    if (!isV(x)) {
      const n = s[i + 1];
      // doubled consonants are held, not said twice
      if (n && !isV(n) && n.c === x.c) { out += `${x.c}ː`; i++; continue; }
      out += x.c;
      continue;
    }
    const final = i === s.length - 1;
    let v = x.v === 'ə' && i === stress ? 'ʌ' : x.v;
    if (final && v === 'iː') v = 'i'; // Hindi shortens a word's last ī
    if (x.nasal) v = `${v[0]}̃${v.slice(1)}`;
    if (i === stress) out += 'ˈ';
    out += v;
  }
  // Kokoro's labels put the stress mark on the vowel, not before the syllable's onset
  return out;
}

/** One Devanagari word (no spaces) as Kokoro phonemes. */
export function hindiWord(word: string): string {
  return render(word, dropSchwas(segments(word)));
}

const ONES = 'शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चौवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे चौरानवे पंचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे'.split(' ');

/** A whole number in Hindi words, in the Indian scale (लाख, करोड़). */
export function hindiNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1e13) return String(n);
  n = Math.floor(n);
  if (n < 100) return ONES[n]!;
  const parts: string[] = [];
  for (const [unit, name] of [[1e7, 'करोड़'], [1e5, 'लाख'], [1e3, 'हज़ार'], [100, 'सौ']] as const) {
    const k = Math.floor(n / unit);
    if (k) { parts.push(`${hindiNumber(k)} ${name}`); n -= k * unit; }
  }
  if (n) parts.push(ONES[n]!);
  return parts.join(' ');
}
