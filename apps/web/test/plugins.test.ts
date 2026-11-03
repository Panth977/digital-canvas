import { describe, expect, it } from 'vitest';
import { image, keyframesFromCss, text, type ImageElement } from '@digital-canvas/scene';
import { MemoryStore, packPlugin, pluginFileName, pluginLink, unpackPlugin } from '@digital-canvas/storage';
import {
  EASINGS, SAMPLE_CSS, SAMPLE_SKSL, copyName, presetFromElement, presetPatch, recipeFromCss, recipeFromRows, recipeToCss, rowsFromRecipe, shaderFloatUniforms, syncParams,
} from '../src/lib/plugins/pluginutil.ts';
import { cleanError, fontMime } from '../src/lib/plugins/render-bridge.ts';

describe('animation creator: keyframe table ⇄ recipe', () => {
  it('reads the sample CSS', () => {
    const r = recipeFromCss(SAMPLE_CSS);
    expect('recipe' in r && r.name).toBe('pop-in');
    if (!('recipe' in r)) return;
    expect(r.recipe.f.map((f) => f.a)).toEqual([0, 0.6, 1]);
    expect(r.recipe.f[0]).toMatchObject({ sx: 0.3, sy: 0.3, r: -12, o: 0 });
  });
  it('explains CSS without @keyframes', () => {
    expect(recipeFromCss('.a { color: red }')).toEqual({ error: expect.stringContaining('No @keyframes') });
  });
  it('rows round-trip a recipe, keeping fields the table does not show', () => {
    const recipe = { f: [{ a: 0, tx: -1, o: 0, px: 20, kx: 10 }, { a: 0.5, sx: 1.2, sy: 1.2, r: 30, e: [0, 0, 1, 1] }, { a: 1 }] };
    const rows = rowsFromRecipe(recipe);
    expect(rows[0]).toMatchObject({ at: 0, x: -100, opacity: 0, rest: { px: 20, kx: 10 } });
    expect(rows[1]).toMatchObject({ at: 50, scale: 1.2, rotate: 30, easing: 'linear' });
    expect(recipeFromRows(rows).f).toEqual(recipe.f);
  });
  it('rows always start at 0 % and end at 100 %, sorted', () => {
    const f = recipeFromRows([{ at: 60, x: 10, y: 0, scale: 1, rotate: 0, opacity: 1, easing: 'ease-out' }]).f;
    expect(f.map((x) => x.a)).toEqual([0, 0.6, 1]);
    expect(f[1]).toEqual({ a: 0.6, tx: 0.1, e: EASINGS.find((e) => e.id === 'ease-out')!.e });
  });
  it('a recipe written as CSS reads back the same', () => {
    const recipe = { f: [{ a: 0, tx: -0.5, ty: 0.25, o: 0, sx: 0.5, sy: 0.5 }, { a: 0.4, r: 15, e: [0.42, 0, 1, 1] }, { a: 1 }] };
    const css = recipeToCss(recipe, 'My slide!');
    expect(css).toContain('@keyframes My-slide {');
    const back = Object.values(keyframesFromCss(css))[0]!;
    expect(back.f[0]).toMatchObject({ a: 0, tx: -0.5, ty: 0.25, o: 0, sx: 0.5, sy: 0.5 });
    expect(back.f[1]).toMatchObject({ a: 0.4, r: 15, e: [0.42, 0, 1, 1] });
  });
});

describe('effect creator', () => {
  it('takes a photo look as a preset, without asset-bound fields', () => {
    const el = { ...image('a.png', { x: 0, y: 0, w: 10, h: 10 }), filter: { name: 'Fresco', intensity: 50 }, adjust: { brightness: 20 }, matte: 'm.png', autoFocus: 30 } as unknown as ImageElement;
    expect(presetFromElement(el)).toEqual({ look: { filter: { name: 'Fresco', intensity: 50 }, adjust: { brightness: 20 } } });
  });
  it('takes a text effect; nothing from plain elements', () => {
    const t = { ...text('Hi', { x: 0, y: 0, w: 10, h: 10 }), effect: { type: 'neon', intensity: 50 } } as never;
    expect(presetFromElement(t)).toEqual({ textEffect: { type: 'neon', intensity: 50 } });
    expect(presetFromElement(text('Hi', { x: 0, y: 0, w: 10, h: 10 }))).toBeNull();
  });
  it('a preset replaces the whole look (no stacking) and leaves other kinds alone', () => {
    const el = image('a.png', { x: 0, y: 0, w: 10, h: 10 });
    const patch = presetPatch({ look: { adjust: { contrast: 10 } } }, el);
    expect(patch.adjust).toEqual({ contrast: 10 });
    expect('filter' in patch && patch.filter).toBeUndefined();
    expect(presetPatch({ look: { adjust: { contrast: 10 } } }, text('x', { x: 0, y: 0, w: 1, h: 1 }))).toEqual({});
  });
  it('one slider per float uniform, not the built-ins; settings survive edits', () => {
    expect(shaderFloatUniforms(SAMPLE_SKSL)).toEqual(['amount']);
    const first = syncParams(SAMPLE_SKSL, []);
    expect(first).toEqual([{ name: 'amount', label: 'Amount', min: 0, max: 1, default: 0.5 }]);
    const edited = [{ ...first[0]!, max: 3 }];
    const more = syncParams(`${SAMPLE_SKSL}\nuniform float glowSize;`, edited);
    expect(more).toEqual([edited[0], { name: 'glowSize', label: 'Glow Size', min: 0, max: 1, default: 0.5 }]);
  });
  it('compile errors without the echoed source', () => {
    expect(cleanError("error: 1: unknown identifier 'foo'\nhalf4 main(float2 p){ return foo; \n   ^^^\n1 error\n")).toBe("Line 1: unknown identifier 'foo'");
  });
});

describe('plugin files', () => {
  it('font mime from the signature', () => {
    const b = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
    expect(fontMime(b('wOF2xxxx'))).toBe('font/woff2');
    expect(fontMime(b('wOFFxxxx'))).toBe('font/woff');
    expect(fontMime(b('OTTOxxxx'))).toBe('font/otf');
    expect(fontMime(new Uint8Array([0, 1, 0, 0, 9]))).toBe('font/ttf');
    expect(fontMime(b('GIF89a'))).toBeNull();
  });
  it('copy names count up', () => {
    expect(copyName('Pop', ['Pop'])).toBe('Pop copy');
    expect(copyName('Pop copy', ['Pop', 'Pop copy'])).toBe('Pop copy 2');
  });
  it('share links and file names', () => {
    expect(pluginLink('abc_123', 'http://localhost:5181/')).toBe('http://localhost:5181/plugin/abc_123');
    expect(pluginFileName({ name: 'My: mockup/1' })).toBe('My mockup1.dcplugin');
  });
  it('a mockup plugin survives .dcplugin and a store round trip', async () => {
    const photo = new Uint8Array([0x89, 0x50, 1, 2, 3]);
    const plugin = { format: 'digital-canvas-plugin', version: 1, id: 'pl_test1234', kind: 'mockup', name: 'Mug', category: 'Home', photo: 'aaaaaaaaaaaaaaaaaaaa.png', width: 100, height: 80, corners: [[1, 1], [90, 2], [88, 70], [3, 75]], createdAt: '', updatedAt: '' } as const;
    const bytes = await packPlugin(plugin as never, async () => photo);
    const { plugin: p, assets } = unpackPlugin(bytes);
    expect(p).toMatchObject({ id: 'pl_test1234', kind: 'mockup', corners: plugin.corners });
    const store = new MemoryStore();
    await store.savePlugins({ format: 'digital-canvas-plugins', version: 1, plugins: [p], updatedAt: '' }, assets);
    expect((await store.loadPlugins()).plugins[0]!.name).toBe('Mug');
    expect(await store.pluginAsset('aaaaaaaaaaaaaaaaaaaa.png')).toEqual(photo);
  });
});
