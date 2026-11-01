import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { englishNumber, englishOrdinal, englishWords, englishYear, spellOut, type Lexicons } from '../src/lib/tts/english.ts';
import { hindiNumber, hindiWord } from '../src/lib/tts/hindi.ts';
import { MAX_TOKENS, VOCAB, chunk, normalize, phonemize, tokenize } from '../src/lib/tts/phonemes.ts';
import { DEFAULT_VOICE, ENGINES, LANGS, VOICES, lexiconUrl, modelUrl, voiceUrl } from '../src/lib/tts/voices.ts';

const lex: Lexicons = {
  gold: { hello: 'həlˈO', the: 'ði', apple: 'ˈæpᵊl', world: 'wˈɜɹld', read: { DEFAULT: 'ɹˈid', VBD: 'ɹˈɛd' }, walk: 'wˈɔk', a: 'A', A: 'ˈA', I: 'ˈI', go: 'ɡˈO', to: 'tu', video: 'vˈɪdiO', rupees: 'ɹupˈiz' },
  silver: { canvas: 'kˈænvəs' },
};

describe('Hindi words', () => {
  const cases: [string, string][] = [
    ['नमस्ते', 'nəmˈʌsteː'], ['कमल', 'kˈʌməl'], ['भारत', 'bʰˈaːɾət'], ['करना', 'kˈʌɾnaː'], ['लड़का', 'lˈʌɽkaː'], ['सरकार', 'səɾkˈaːɾ'],
    ['किताब', 'kɪtˈaːb'], ['पानी', 'pˈaːni'], ['शुक्रिया', 'ʃˈʊkɾɪjaː'], ['ज़रूरत', 'zəɾˈuːɾət'], ['बच्चे', 'bˈʌcːeː'],
  ];
  it.each(cases)('%s', (w, ps) => { expect(hindiWord(w)).toBe(ps); });
  it('drops the final schwa but keeps it after a closing cluster', () => {
    expect(hindiWord('मित्र').endsWith('ə')).toBe(true);
    expect(hindiWord('धर्म').endsWith('m')).toBe(true);
  });
  it('anusvara: a nasal before stops, a nasal vowel elsewhere', () => {
    expect(hindiWord('संगीत')).toContain('ŋɡ');
    expect(hindiWord('हिंदी')).toContain('nd');
    expect(hindiWord('मैं')).toContain('̃');
    expect(hindiWord('चाँद')).toContain('̃');
  });
  it('क्ष and ज्ञ', () => { expect(hindiWord('ज्ञान')).toContain('ɡj'); expect(hindiWord('क्षत्रिय')).toContain('kʃ'); });
  it('function words carry no stress', () => { expect(hindiWord('है')).not.toContain('ˈ'); expect(hindiWord('लोग')).toContain('ˈ'); });
  it('uses only sounds the model knows', () => {
    for (const w of ['नमस्ते', 'क़लम', 'ख़बर', 'ग़लत', 'फ़ोन', 'ढ़', 'ऋषि', 'ऑफ़िस', 'दुःख']) for (const c of hindiWord(w)) expect(VOCAB[c], `${w}: ${c}`).toBeDefined();
  });
});

describe('numbers', () => {
  it('Hindi', () => {
    expect(hindiNumber(0)).toBe('शून्य');
    expect(hindiNumber(25)).toBe('पच्चीस');
    expect(hindiNumber(99)).toBe('निन्यानवे');
    expect(hindiNumber(105)).toBe('एक सौ पाँच');
    expect(hindiNumber(150000)).toBe('एक लाख पचास हज़ार');
    expect(hindiNumber(23000000)).toBe('दो करोड़ तीस लाख');
  });
  it('English', () => {
    expect(englishNumber(0)).toBe('zero');
    expect(englishNumber(342)).toBe('three hundred forty two');
    expect(englishNumber(1200000)).toBe('one million two hundred thousand');
    expect(englishYear(1999)).toBe('nineteen ninety nine');
    expect(englishYear(2005)).toBe('two thousand five');
    expect(englishYear(2026)).toBe('twenty twenty six');
    expect(englishOrdinal(21)).toBe('twenty first');
    expect(englishOrdinal(30)).toBe('thirtieth');
    expect(englishOrdinal(12)).toBe('twelfth');
  });
});

describe('normalize', () => {
  it('reads money, percent, decimals, times, titles', () => {
    expect(normalize('₹1,200 and $1')).toBe('one thousand two hundred rupees and one dollar');
    expect(normalize('50% off')).toBe('fifty percent off');
    expect(normalize('3.5 stars')).toBe('three point five stars');
    expect(normalize('at 10:30')).toBe('at ten thirty');
    expect(normalize('Dr. Rao')).toBe('Doctor Rao');
    expect(normalize('in 1999')).toBe('in nineteen ninety nine');
  });
  it('says numbers in Hindi inside Hindi lines, Devanagari digits too', () => {
    expect(normalize('आज २५ लोग')).toBe('आज पच्चीस लोग');
    expect(normalize('₹500 का नोट')).toBe('पाँच सौ रुपये का नोट');
  });
  it('turns the danda into a stop', () => { expect(normalize('नमस्ते।')).toBe('नमस्ते.'); });
});

describe('English words', () => {
  it('finds dictionary words in any case, silver too', () => { expect(englishWords(lex, ['Hello', 'WORLD', 'canvas'])).toEqual(['həlˈO', 'wˈɜɹld', 'kˈænvəs']); });
  it('the and to follow the next sound', () => {
    expect(englishWords(lex, ['the', 'apple'])[0]).toBe('ði');
    expect(englishWords(lex, ['the', 'world'])[0]).toBe('ðə');
    expect(englishWords(lex, ['to', 'go'])[0]).toBe('tə');
  });
  it('a is weak before a word', () => { expect(englishWords(lex, ['a', 'world'])[0]).toBe('ɐ'); });
  it('takes the default of a word with several readings', () => { expect(englishWords(lex, ['read'])).toEqual(['ɹˈid']); });
  it('builds suffixes from the stem', () => {
    expect(englishWords(lex, ['walks'])).toEqual(['wˈɔks']);
    expect(englishWords(lex, ['walked'])).toEqual(['wˈɔkt']);
    expect(englishWords(lex, ['walking'])).toEqual(['wˈɔkɪŋ']);
    expect(englishWords(lex, ["world's"])).toEqual(['wˈɜɹldz']);
  });
  it('spells short capitals', () => { expect(englishWords(lex, ['AI'])).toEqual(['ˈA ˈI']); });
  it('says an unknown word by its letters, with a stress', () => {
    for (const w of ['Mumbai', 'Bengaluru', 'Panth', 'Xylofy']) {
      const ps = spellOut(w);
      expect(ps).toContain('ˈ');
      for (const c of ps) expect(VOCAB[c], `${w}: ${c}`).toBeDefined();
    }
  });
});

describe('phonemize', () => {
  it('mixes scripts in one line', () => {
    const ps = phonemize('नमस्ते video दोस्तों', lex);
    expect(ps).toContain('nəmˈʌsteː');
    expect(ps).toContain('vˈɪdiO');
  });
  it('keeps pauses and drops what has no sound', () => {
    expect(phonemize('hello, world! 🎉', lex)).toBe('həlˈO, wˈɜɹld!');
    expect(phonemize('🎉', lex)).toBe('');
  });
  it('pads the token ids and drops unknown symbols', () => {
    expect(tokenize('a©')).toEqual([0, VOCAB.a, 0]);
  });
  it('cuts long text at sentence ends, within the limit', () => {
    const s = Array.from({ length: 60 }, (_, i) => `sentence number ${i} goes here.`).join(' ');
    const parts = chunk(s);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect([...p].length).toBeLessThanOrEqual(MAX_TOKENS);
    expect(parts[0]!.endsWith('.')).toBe(true);
    expect(parts.join(' ')).toBe(s);
  });
  it('cuts text with no stops at spaces', () => {
    const parts = chunk('word '.repeat(300));
    for (const p of parts) expect([...p].length).toBeLessThanOrEqual(MAX_TOKENS);
  });
});

describe('model files', () => {
  it('are pinned to revisions', () => {
    for (const u of [modelUrl(ENGINES.gpu.file), modelUrl(ENGINES.small.file), voiceUrl('af_heart')]) expect(u).toMatch(/\/resolve\/[0-9a-f]{40}\//);
    expect(lexiconUrl('us_gold')).toMatch(/misaki@[0-9a-f]{40}\//);
  });
  it('every language has a default voice of its own', () => {
    for (const l of LANGS) expect(VOICES.find((v) => v.id === DEFAULT_VOICE[l.id])?.lang).toBe(l.id);
  });
  it('nothing we ship imports eSpeak or its wrappers (GPL-3)', () => {
    const dir = join(import.meta.dirname, '../src/lib/tts');
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(/from ['"](phonemizer|kokoro-js|espeak)/);
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as { dependencies: Record<string, string> };
    for (const d of ['phonemizer', 'kokoro-js', 'espeak-ng']) expect(pkg.dependencies[d]).toBeUndefined();
  });
});
