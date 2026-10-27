<script lang="ts">
  import './panels.css';
  import { CHARTS, newId } from '@digital-canvas/scene';
  import type { EditorState } from '../../lib/editor.svelte.ts';
  import Icon, { type IconName } from '../../lib/Icon.svelte';
  import { account } from '../../lib/account.svelte.ts';
  import { ui } from '../../lib/ui.svelte.ts';
  import { objectUrl } from '../../lib/files.ts';
  import { brand } from '../../lib/brand.svelte.ts';
  import { attribution, fetchIcon, fetchPhoto, iconUrl, searchPhotos, type Photo } from '../../lib/stock.ts';
  import { catalog, previewFamily, type CatalogFont } from '../../lib/fonts.ts';
  import { place } from '../../lib/tools.ts';
  import {
    AVATAR_STYLES, GRADIENTS, HARMONIES, ICON_SETS, MAP_CREDIT, PATTERNS, avatarUrl, commonsCredit, download, gradientCss, gradientFill, harmony,
    pageColors, paletteMap, patternElement, patternPath, randomPalette, recolorPage, searchCommons, searchIconSet, searchPlaces, staticMap, svgToPng,
    type CommonsImage, type Harmony, type PatternKind, type Place,
  } from '../../lib/apps.ts';

  let { ed }: { ed: EditorState } = $props();

  type AppId = 'iconify' | 'emoji' | 'openverse' | 'wikimedia' | 'maps' | 'avatars' | 'qr' | 'charts' | 'drive' | 'fonts' | 'patterns' | 'gradients' | 'palettes';
  const APPS: { id: AppId; name: string; desc: string; icon: IconName; color: string; tag: string }[] = [
    { id: 'iconify', name: 'Iconify', desc: '200,000+ open-source icons', icon: 'star', color: '#1769aa', tag: 'Graphics' },
    { id: 'emoji', name: 'Emoji', desc: 'Google Noto emoji', icon: 'smile', color: '#f59e0b', tag: 'Graphics' },
    { id: 'openverse', name: 'Openverse', desc: 'CC-licensed photos', icon: 'image', color: '#c52b9b', tag: 'Photos' },
    { id: 'wikimedia', name: 'Wikimedia Commons', desc: 'Free-licence media archive', icon: 'globe', color: '#006699', tag: 'Photos' },
    { id: 'maps', name: 'Maps', desc: 'OpenStreetMap of any place', icon: 'map', color: '#7ebc6f', tag: 'Visuals' },
    { id: 'avatars', name: 'Avatars', desc: 'Illustrated people by DiceBear', icon: 'user', color: '#ec4899', tag: 'Graphics' },
    { id: 'qr', name: 'QR code', desc: 'Links as scannable codes', icon: 'qr', color: '#334155', tag: 'Tools' },
    { id: 'charts', name: 'Charts', desc: 'Bars, lines and pies', icon: 'chart', color: '#06b6d4', tag: 'Visuals' },
    { id: 'drive', name: 'Google Drive', desc: 'Your designs and assets', icon: 'drive', color: '#1fa463', tag: 'Files' },
    { id: 'fonts', name: 'Google Fonts', desc: '1,800+ free fonts', icon: 'text', color: '#4285f4', tag: 'Text' },
    { id: 'patterns', name: 'Pattern generator', desc: 'Seamless vector patterns', icon: 'pattern', color: '#8b5cf6', tag: 'Visuals' },
    { id: 'gradients', name: 'Gradient generator', desc: 'Smooth colour blends', icon: 'gradient', color: '#f43f5e', tag: 'Visuals' },
    { id: 'palettes', name: 'Colour palettes', desc: 'Harmonies and recolouring', icon: 'palette', color: '#14b8a6', tag: 'Visuals' },
  ];
  let app = $state<AppId | null>(null);
  let filter = $state('');
  const shown = $derived(APPS.filter((a) => `${a.name} ${a.desc} ${a.tag}`.toLowerCase().includes(filter.trim().toLowerCase())));
  const current = $derived(APPS.find((a) => a.id === app));

  let error = $state('');
  let busy = $state<string | null>(null);
  async function guard(id: string, fn: () => Promise<unknown>): Promise<void> {
    busy = id;
    error = '';
    try { await fn(); } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { busy = null; }
  }
  function open(id: AppId): void {
    app = id;
    error = '';
    if (id === 'emoji' && !emojis.length) emojis = POPULAR_EMOJI;
    if (id === 'fonts' && !fonts.length) void guard('fonts', async () => (fonts = await catalog()));
  }

  // ---- Iconify / emoji ----
  let iconQ = $state(''), iconSet = $state(''), icons = $state<string[]>([]), iconsDone = $state(false);
  const findIcons = () => guard('icons', async () => { icons = await searchIconSet(iconQ.trim(), iconSet); iconsDone = true; });
  const addIcon = (n: string) => guard(n, async () => { if (!ed.addSvg(await fetchIcon(n), n)) throw new Error('That icon has nothing we can draw.'); });
  const POPULAR_EMOJI = ['grinning-face', 'face-with-tears-of-joy', 'smiling-face-with-heart-eyes', 'star-struck', 'thinking-face', 'red-heart', 'fire', 'sparkles', 'party-popper', 'thumbs-up', 'clapping-hands', 'folded-hands', 'hundred-points', 'rocket', 'sun', 'rainbow', 'birthday-cake', 'hot-beverage', 'pizza', 'camera', 'gem-stone', 'crown', 'trophy', 'light-bulb'].map((n) => `noto:${n}`);
  let emojiQ = $state(''), emojis = $state<string[]>([]);
  const findEmoji = () => guard('emoji', async () => (emojis = emojiQ.trim() ? await searchIconSet(emojiQ.trim(), 'noto') : POPULAR_EMOJI));
  const addEmoji = (n: string) => guard(n, async () => {
    const png = await svgToPng(await fetchIcon(n), 512);
    if (!(await ed.addPhoto(png, 'image/png', `${n} (Noto Emoji, Apache 2.0)`))) throw new Error('Couldn’t add the emoji.');
  });

  // ---- Openverse / Wikimedia ----
  let photoQ = $state(''), photos = $state<Photo[]>([]), photosDone = $state(false);
  const findPhotos = () => guard('photos', async () => { photos = await searchPhotos(photoQ.trim()); photosDone = true; });
  const addPhoto = (p: Photo) => guard(p.id, async () => { const { bytes, mime } = await fetchPhoto(p); if (!(await ed.addPhoto(bytes, mime, attribution(p)))) throw new Error('Couldn’t read that photo.'); });
  let wikiQ = $state(''), wiki = $state<CommonsImage[]>([]), wikiDone = $state(false);
  const findWiki = () => guard('wiki', async () => { wiki = await searchCommons(wikiQ.trim()); wikiDone = true; });
  const addWiki = (c: CommonsImage) => guard(c.id, async () => { const { bytes, mime } = await download(c.url); if (!(await ed.addPhoto(bytes, mime || c.mime, commonsCredit(c)))) throw new Error('Couldn’t read that image.'); });

  // ---- Maps ----
  let mapQ = $state(''), places = $state<Place[]>([]), placesDone = $state(false), placeSel = $state<Place | null>(null), zoom = $state(13), mapPng = $state<Uint8Array | null>(null);
  const findPlaces = () => guard('places', async () => { places = await searchPlaces(mapQ.trim()); placesDone = true; placeSel = null; mapPng = null; });
  const zoomFor = (t: string) => (['country'].includes(t) ? 5 : ['state', 'region'].includes(t) ? 7 : ['city', 'town', 'administrative'].includes(t) ? 12 : ['village', 'suburb', 'neighbourhood'].includes(t) ? 14 : 16);
  function choosePlace(p: Place): void { placeSel = p; zoom = zoomFor(p.type); void renderMap(); }
  const renderMap = () => guard('map', async () => { if (placeSel) mapPng = await staticMap(placeSel, zoom); });
  const addMap = () => guard('map-add', async () => { if (mapPng && placeSel && !(await ed.addPhoto(mapPng, 'image/png', `Map of ${placeSel.name.split(',')[0]}. ${MAP_CREDIT}`))) throw new Error('Couldn’t add the map.'); });

  // ---- Avatars ----
  let avStyle = $state('notionists'), avSeed = $state('Panth');
  let avSeeds = $state<string[]>(['Panth', 'Aditi', 'Rohan', 'Maya', 'Kabir', 'Zoya', 'Arjun', 'Isha', 'Dev']);
  const shuffleAvatars = () => (avSeeds = Array.from({ length: 9 }, () => Math.random().toString(36).slice(2, 8)));
  const addAvatar = (seed: string) => guard(`av-${seed}`, async () => {
    const { bytes } = await download(avatarUrl(avStyle, seed, 'png', 512));
    const st = AVATAR_STYLES.find((s) => s.id === avStyle)!;
    if (!(await ed.addPhoto(bytes, 'image/png', `Avatar "${seed}" — DiceBear ${st.label} (${st.licence})`))) throw new Error('Couldn’t add the avatar.');
  });

  // ---- QR ----
  let qrText = $state('https://');

  // ---- Fonts ----
  let fonts = $state<CatalogFont[]>([]), fontQ = $state('');
  const fontHits = $derived(fonts.filter((f) => f.family.toLowerCase().includes(fontQ.trim().toLowerCase())).slice(0, 50));
  const useFont = (f: CatalogFont) => guard(f.id, async () => { if (!ed.selected.some((e) => e.type === 'text')) ed.addText('body'); await ed.useFont(f); });

  // ---- Patterns ----
  let patKind = $state<PatternKind>('dots'), patColor = $state('#8b3dff'), patBg = $state('#f3e8ff'), patBgOn = $state(true), patSize = $state(48);
  const patPreview = $derived.by(() => { const p = patternPath(patKind, 160, 160, patSize / 2); return `${patBgOn ? `<rect width="160" height="160" fill="${patBg}"/>` : ''}<path d="${p.d}" fill="${p.stroke ? 'none' : patColor}" stroke="${p.stroke ? patColor : 'none'}" stroke-width="${p.width}"/>`; });
  function addPattern(asBackground: boolean): void {
    const el = patternElement(patKind, ed.doc.width, ed.doc.height, patSize, patColor, patBgOn ? patBg : null);
    if (asBackground) {
      ed.commit({ ...ed.doc, pages: ed.doc.pages.map((p) => (p.id === ed.pageId ? { ...p, elements: [el, ...p.elements] } : p)) });
      ed.seal();
      ed.select([el.id], ed.pageId);
    } else place(ed, [el]);
  }

  // ---- Gradients ----
  let gA = $state('#ff512f'), gB = $state('#dd2476'), gC = $state(''), gAngle = $state(135);
  const gColors = $derived([gA, gB, ...(gC ? [gC] : [])]);
  function setGradient(g: (typeof GRADIENTS)[number]): void { gA = g.colors[0]!; gB = g.colors[1]!; gC = g.colors[2] ?? ''; gAngle = g.angle; }
  function gradientTo(where: 'page' | 'shape' | 'selection'): void {
    const fill = gradientFill(gAngle, gColors);
    if (where === 'page') { ed.updatePage({ background: fill }); ed.seal(); return; }
    if (where === 'shape') {
      const s = Math.min(ed.doc.width, ed.doc.height) * 0.5;
      place(ed, [{ id: newId('e_'), type: 'shape', shape: 'rect', x: (ed.doc.width - s) / 2, y: (ed.doc.height - s) / 2, w: s, h: s, rotation: 0, opacity: 1, fill, stroke: null, radius: 0, name: 'Gradient' }]);
      return;
    }
    if (fill.type !== 'linear') return;
    ed.update((e) => (e.type === 'shape' ? { fill } : {}));
    if (ed.selected.some((e) => e.type === 'text')) ed.updateText({ gradient: fill });
    ed.seal();
  }
  const canGradientSel = $derived(ed.selected.some((e) => e.type === 'shape' || e.type === 'text'));

  // ---- Palettes ----
  let palBase = $state('#8b3dff'), palKind = $state<Harmony>('analogous'), palette = $state<string[]>(harmony('#8b3dff', 'analogous'));
  $effect(() => { palette = harmony(palBase, palKind); });
  function applyColor(hex: string): void {
    const sel = ed.selected;
    if (!sel.length) { ed.updatePage({ background: { type: 'solid', color: hex } }); ed.seal(); return; }
    if (sel.some((e) => e.type === 'text')) ed.updateTextStyle({ color: hex });
    ed.update((e) => (e.type === 'shape' ? { fill: { type: 'solid', color: hex } } : {}));
    ed.seal();
  }
  function recolorDesign(): void {
    const map = paletteMap(pageColors(ed.page), palette);
    ed.commit({ ...ed.doc, pages: ed.doc.pages.map((p) => (p.id === ed.pageId ? recolorPage(p, map) : p)) });
    ed.seal();
  }
  let copied = $state(false);
</script>

<div class="dp" data-testid="apps-panel">
  {#if !app}
    <form class="dp-search" onsubmit={(e) => e.preventDefault()}>
      <Icon name="search" size={18} />
      <input placeholder="Search apps" bind:value={filter} data-testid="apps-search" aria-label="Search apps" />
    </form>
    <div class="dp-head"><h3>Apps</h3><span class="dp-link">{shown.length}</span></div>
    <div class="apps">
      {#each shown as a (a.id)}
        <button class="appcard" onclick={() => open(a.id)} data-testid="app-{a.id}">
          <span class="ai" style="background:{a.color}"><Icon name={a.icon} size={24} /></span>
          <span class="at"><b>{a.name}</b><small>{a.desc}</small></span>
        </button>
      {/each}
    </div>
    <p class="dp-hint">Every app here is free and needs no account. Content keeps its licence and credit (hover an image in Uploads to see it).</p>
  {:else}
    <button class="dp-back" onclick={() => (app = null)} data-testid="apps-back"><Icon name="left" size={16} /> {current?.name}</button>
    {#if error}<p class="dp-err" data-testid="app-error">{error}</p>{/if}

    {#if app === 'iconify'}
      <form class="dp-search" onsubmit={(e) => { e.preventDefault(); void findIcons(); }}>
        <Icon name="search" size={18} />
        <input placeholder="Search icons (e.g. coffee)" bind:value={iconQ} data-testid="app-icon-search" aria-label="Search icons" />
      </form>
      <div class="dp-chips">
        {#each ICON_SETS as s (s.prefix)}<button class="dp-chip" class:on={iconSet === s.prefix} title={s.licence} onclick={() => { iconSet = s.prefix; if (iconQ.trim()) void findIcons(); }}>{s.label}</button>{/each}
      </div>
      {#if busy === 'icons'}<p class="dp-hint"><span class="dp-spin"></span> Searching…</p>{/if}
      {#if iconsDone && !icons.length}<p class="dp-empty">No icons found.</p>{/if}
      <div class="dp-grid four" data-testid="app-icon-results">
        {#each icons as n (n)}<button class="dp-cell light" title={n} disabled={busy === n} onclick={() => addIcon(n)}><img src={iconUrl(n)} alt={n} loading="lazy" /></button>{/each}
      </div>
      {#if !icons.length && !iconsDone}<p class="dp-hint">Search 150+ open-source icon sets via <a href="https://iconify.design" target="_blank" rel="noreferrer">Iconify</a>. Icons come in as vectors you can recolour.</p>{/if}

    {:else if app === 'emoji'}
      <form class="dp-search" onsubmit={(e) => { e.preventDefault(); void findEmoji(); }}>
        <Icon name="search" size={18} />
        <input placeholder="Search emoji" bind:value={emojiQ} data-testid="app-emoji-search" aria-label="Search emoji" />
      </form>
      <div class="dp-grid four" data-testid="app-emoji-results">
        {#each emojis as n (n)}<button class="dp-cell" title={n.replace('noto:', '').replace(/-/g, ' ')} disabled={busy === n} onclick={() => addEmoji(n)}><img src={iconUrl(n)} alt={n} loading="lazy" /></button>{/each}
      </div>
      <p class="dp-hint">Noto Emoji by Google (Apache 2.0), via Iconify.</p>

    {:else if app === 'openverse'}
      <form class="dp-search" onsubmit={(e) => { e.preventDefault(); void findPhotos(); }}>
        <Icon name="search" size={18} />
        <input placeholder="Search CC-licensed photos" bind:value={photoQ} data-testid="app-openverse-search" aria-label="Search Openverse" />
      </form>
      {#if busy === 'photos'}<p class="dp-hint"><span class="dp-spin"></span> Searching…</p>{/if}
      {#if photosDone && !photos.length}<p class="dp-empty">No photos found.</p>{/if}
      <div class="dp-grid two" data-testid="app-openverse-results">
        {#each photos as p (p.id)}<button class="dp-cell photo" title={attribution(p)} disabled={busy === p.id} onclick={() => addPhoto(p)}><img src={p.thumbnail} alt={p.title} loading="lazy" /></button>{/each}
      </div>
      <p class="dp-hint">Photos you may use commercially and edit, from <a href="https://openverse.org" target="_blank" rel="noreferrer">Openverse</a>. The credit stays with each photo.</p>

    {:else if app === 'wikimedia'}
      <form class="dp-search" onsubmit={(e) => { e.preventDefault(); void findWiki(); }}>
        <Icon name="search" size={18} />
        <input placeholder="Search Wikimedia Commons" bind:value={wikiQ} data-testid="app-wiki-search" aria-label="Search Wikimedia Commons" />
      </form>
      {#if busy === 'wiki'}<p class="dp-hint"><span class="dp-spin"></span> Searching…</p>{/if}
      {#if wikiDone && !wiki.length}<p class="dp-empty">Nothing found.</p>{/if}
      <div class="dp-grid two" data-testid="app-wiki-results">
        {#each wiki as c (c.id)}<button class="dp-cell photo" title={commonsCredit(c)} disabled={busy === c.id} onclick={() => addWiki(c)}><img src={c.thumb} alt={c.title} loading="lazy" /></button>{/each}
      </div>
      <p class="dp-hint">Free-licence images from <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer">Wikimedia Commons</a>. Each keeps its author and licence as its name; check the licence before you publish.</p>

    {:else if app === 'maps'}
      <form class="dp-search" onsubmit={(e) => { e.preventDefault(); void findPlaces(); }}>
        <Icon name="search" size={18} />
        <input placeholder="Search a place or address" bind:value={mapQ} data-testid="app-map-search" aria-label="Search places" />
      </form>
      {#if busy === 'places'}<p class="dp-hint"><span class="dp-spin"></span> Searching…</p>{/if}
      {#if placesDone && !places.length}<p class="dp-empty">No places found.</p>{/if}
      {#if !placeSel}
        <div class="dp-list" data-testid="app-map-results">
          {#each places as p (p.name)}<button class="dp-item" onclick={() => choosePlace(p)}><span class="dp-ico"><Icon name="map" size={18} /></span><span class="dp-tx"><b>{p.name.split(',')[0]}</b><small>{p.name}</small></span></button>{/each}
        </div>
      {:else}
        <div class="dp-box dp-stack">
          <b style="font-size:13px">{placeSel.name}</b>
          <div class="mapprev">{#if mapPng}<img src={objectUrl(mapPng)} alt="Map preview" data-testid="app-map-preview" />{:else}<span class="dp-spin"></span>{/if}</div>
          <label class="field">Zoom · {zoom}<input type="range" min="3" max="18" bind:value={zoom} onchange={renderMap} /></label>
          <button class="btn primary dp-cta" disabled={!mapPng || busy === 'map'} onclick={addMap} data-testid="app-map-add"><Icon name="plus" size={16} /> Add map</button>
          <button class="btn ghost" onclick={() => { placeSel = null; mapPng = null; }}>Pick another place</button>
        </div>
      {/if}
      <p class="dp-hint">Search by <a href="https://nominatim.org" target="_blank" rel="noreferrer">Nominatim</a>; map {MAP_CREDIT.split(' https')[0]}. The map is added as a picture with the credit on it.</p>

    {:else if app === 'avatars'}
      <div class="dp-chips">
        {#each AVATAR_STYLES as s (s.id)}<button class="dp-chip" class:on={avStyle === s.id} title={s.licence} onclick={() => (avStyle = s.id)}>{s.label}</button>{/each}
      </div>
      <div class="dp-row" style="margin:6px 0 10px">
        <input class="input grow" placeholder="Name or any word" bind:value={avSeed} aria-label="Avatar seed" onkeydown={(e) => e.key === 'Enter' && (avSeeds = [avSeed, ...avSeeds.slice(0, 8)])} />
        <button class="btn" onclick={shuffleAvatars} data-testid="app-avatar-shuffle">Shuffle</button>
      </div>
      <div class="dp-grid" data-testid="app-avatar-results">
        {#each avSeeds as s (s)}<button class="dp-cell light" title="Add avatar “{s}”" disabled={busy === `av-${s}`} onclick={() => addAvatar(s)}><img src={avatarUrl(avStyle, s)} alt="Avatar {s}" loading="lazy" /></button>{/each}
      </div>
      <p class="dp-hint">Avatars by <a href="https://www.dicebear.com" target="_blank" rel="noreferrer">DiceBear</a>; each style has its own licence ({AVATAR_STYLES.find((s) => s.id === avStyle)?.licence}). The same word always gives the same face.</p>

    {:else if app === 'qr'}
      <form class="dp-stack" onsubmit={(e) => { e.preventDefault(); if (qrText.trim()) ed.addQr(qrText.trim()); }}>
        <label class="field">Link or text<input class="input" bind:value={qrText} data-testid="app-qr-text" /></label>
        <button class="btn primary dp-cta" data-testid="app-qr-add"><Icon name="qr" size={16} /> Generate QR code</button>
      </form>

    {:else if app === 'charts'}
      <div class="dp-grid">
        {#each CHARTS as c (c.kind)}<button class="dp-cell" onclick={() => ed.addChart(c.kind)} data-testid="app-chart-{c.kind}"><Icon name="chart" size={22} /><small>{c.label}</small></button>{/each}
      </div>

    {:else if app === 'drive'}
      {#if account.user}
        <p class="dp-hint" style="margin-top:0">Your designs, logos and images live in your Google Drive, in the folder “Digital Canvas” (images in “assets”).</p>
        <button class="btn primary dp-cta" style="margin-top:12px" onclick={() => ui.rail('projects')} data-testid="app-drive-open"><Icon name="drive" size={16} /> Browse in Projects</button>
      {:else}
        <p class="dp-empty">Sign in with Google (on the home page) to save designs to your Drive. Digital Canvas only sees the files it creates.</p>
      {/if}

    {:else if app === 'fonts'}
      <form class="dp-search" onsubmit={(e) => e.preventDefault()}>
        <Icon name="search" size={18} />
        <input placeholder="Search Google Fonts" bind:value={fontQ} data-testid="app-font-search" aria-label="Search fonts" />
      </form>
      {#if busy === 'fonts'}<p class="dp-hint"><span class="dp-spin"></span> Loading fonts…</p>{/if}
      <div class="dp-list">
        {#each fontHits as f (f.id)}<button class="dp-item" disabled={busy === f.id} onclick={() => useFont(f)}><span class="dp-tx"><b style="font-family:'{previewFamily(f)}';font-size:18px;font-weight:400">{f.family}</b><small>{f.category}</small></span></button>{/each}
      </div>
      <p class="dp-hint">Click a font to use it on the selected text (or a new text box). Fonts are embedded in the design.</p>

    {:else if app === 'patterns'}
      <div class="patprev" style="background:repeating-conic-gradient(var(--chip) 0 25%, transparent 0 50%) 0 0/16px 16px"><svg viewBox="0 0 160 160" width="100%" height="100%">{@html patPreview}</svg></div>
      <div class="dp-grid four" style="margin-top:10px">
        {#each PATTERNS as k (k)}
          {@const p = patternPath(k, 48, 48, 16)}
          <button class="dp-cell" class:sel={patKind === k} title={k} onclick={() => (patKind = k)} data-testid="pattern-{k}"><svg viewBox="0 0 48 48" width="40" height="40"><path d={p.d} fill={p.stroke ? 'none' : 'currentColor'} stroke={p.stroke ? 'currentColor' : 'none'} stroke-width={p.width} /></svg></button>
        {/each}
      </div>
      <div class="dp-row" style="margin-top:10px">
        <label class="field grow">Colour<input class="input" type="color" bind:value={patColor} /></label>
        <label class="field grow">Background<input class="input" type="color" bind:value={patBg} disabled={!patBgOn} /></label>
        <label class="chk"><input type="checkbox" bind:checked={patBgOn} /> Fill</label>
      </div>
      <label class="field" style="margin-top:8px">Scale · {patSize}px<input type="range" min="12" max="160" bind:value={patSize} /></label>
      <div class="dp-row" style="margin-top:10px">
        <button class="btn primary grow" onclick={() => addPattern(true)} data-testid="pattern-bg">Use as background</button>
        <button class="btn grow" onclick={() => addPattern(false)} data-testid="pattern-add">Add element</button>
      </div>

    {:else if app === 'gradients'}
      <div class="gprev" style="background:{gradientCss(gAngle, gColors)}"></div>
      <div class="dp-grid four" style="margin-top:10px">
        {#each GRADIENTS as g (g.name)}<button class="dp-cell gsw" title={g.name} style="background:{gradientCss(g.angle, g.colors)}" onclick={() => setGradient(g)} data-testid="gradient-{g.name}"></button>{/each}
      </div>
      <div class="dp-row" style="margin-top:10px">
        <label class="field grow">From<input class="input" type="color" bind:value={gA} /></label>
        <label class="field grow">To<input class="input" type="color" bind:value={gB} /></label>
        <label class="field grow">Third<input class="input" type="color" value={gC || '#ffffff'} oninput={(e) => (gC = (e.currentTarget as HTMLInputElement).value)} /></label>
      </div>
      {#if gC}<button class="dp-link" onclick={() => (gC = '')}>Remove third colour</button>{/if}
      <label class="field" style="margin-top:8px">Angle · {gAngle}°<input type="range" min="0" max="360" bind:value={gAngle} /></label>
      <div class="dp-stack" style="margin-top:10px">
        <button class="btn primary dp-cta" onclick={() => gradientTo('page')} data-testid="gradient-page">Set as page background</button>
        <button class="btn dp-cta" onclick={() => gradientTo('shape')} data-testid="gradient-shape">Add gradient shape</button>
        {#if canGradientSel}<button class="btn dp-cta" onclick={() => gradientTo('selection')} data-testid="gradient-selection">Apply to selection</button>{/if}
      </div>

    {:else if app === 'palettes'}
      <div class="dp-row">
        <label class="field grow">Base colour<input class="input" type="color" bind:value={palBase} data-testid="palette-base" /></label>
        <button class="btn" style="align-self:end" onclick={() => { const p = randomPalette(); palBase = p[2] ?? p[0]!; palKind = 'analogous'; palette = p; }} data-testid="palette-random"><Icon name="sparkle" size={16} /> Random</button>
      </div>
      <div class="dp-chips" style="margin-top:10px">
        {#each HARMONIES as h (h.id)}<button class="dp-chip" class:on={palKind === h.id} onclick={() => (palKind = h.id)}>{h.label}</button>{/each}
      </div>
      <div class="palette" data-testid="palette-swatches">
        {#each palette as hex, i (i)}<button class="pc" style="background:{hex}" title="Apply {hex}" onclick={() => applyColor(hex)}><span>{hex}</span></button>{/each}
      </div>
      <div class="dp-stack" style="margin-top:10px">
        <button class="btn primary dp-cta" onclick={recolorDesign} data-testid="palette-recolor"><Icon name="palette" size={16} /> Recolour this page</button>
        <button class="btn dp-cta" onclick={() => brand.addPalette(palette, `${HARMONIES.find((h) => h.id === palKind)?.label} palette`)} data-testid="palette-save">Save to Brand Kit</button>
        <button class="btn ghost dp-cta" onclick={async () => { await navigator.clipboard?.writeText(palette.join(', ')).catch(() => {}); copied = true; setTimeout(() => (copied = false), 1500); }}>{copied ? 'Copied' : 'Copy hex codes'}</button>
      </div>
      <p class="dp-hint">Click a colour to apply it to the selection (or the page). Recolour swaps the page’s colours for these, darkest to darkest.</p>
    {/if}
  {/if}
</div>

<style>
  .apps { display: flex; flex-direction: column; gap: 4px; }
  .appcard { display: flex; align-items: center; gap: 12px; padding: 8px; border: 0; border-radius: 10px; background: none; color: var(--ink); text-align: left; }
  .appcard:hover { background: var(--hover); }
  .ai { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; color: #fff; flex-shrink: 0; }
  .at { display: flex; flex-direction: column; min-width: 0; }
  .at b { font-size: 14px; font-weight: 600; }
  .at small { color: var(--muted); font-size: 12px; }
  .mapprev { aspect-ratio: 3 / 2; border-radius: 8px; overflow: hidden; background: var(--chip); display: grid; place-items: center; }
  .mapprev img { width: 100%; height: 100%; object-fit: cover; }
  .patprev { aspect-ratio: 1; border-radius: 10px; overflow: hidden; border: 1px solid var(--line); }
  .dp-cell.sel { border-color: var(--accent); }
  .chk { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); align-self: end; height: 32px; }
  .gprev { height: 120px; border-radius: 10px; }
  .gsw { padding: 0; }
  .palette { display: flex; height: 96px; border-radius: 10px; overflow: hidden; margin-top: 10px; }
  .pc { flex: 1; border: 0; display: flex; align-items: end; justify-content: center; padding: 0 0 6px; }
  .pc span { font-size: 10px; background: rgba(0,0,0,.45); color: #fff; padding: 1px 4px; border-radius: 3px; opacity: 0; }
  .pc:hover span { opacity: 1; }
  input[type='color'].input { padding: 2px; height: 32px; }
</style>
