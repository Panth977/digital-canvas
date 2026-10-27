/**
 * The built-in template library, authored as loose documents (see
 * packages/scene/src/loose.ts). `npx tsx tools/templates/build.ts` turns
 * these into full `.json` docs under apps/web/src/templates/ (icons fetched
 * from Iconify's open-source sets and baked in as vectors, text boxes measured
 * with the real renderer) and renders a thumbnail of each.
 *
 * Everything is vector: shapes, gradients, Google Fonts (OFL) and icons from
 * Fluent Emoji (MIT), Phosphor (MIT) and Material Design Icons (Apache-2.0).
 */

export type Category =
  | 'Instagram post' | 'Story' | 'Poster' | 'Flyer' | 'Menu' | 'Presentation' | 'Business card' | 'Invitation'
  | 'Resume' | 'Logo' | 'YouTube thumbnail' | 'Video' | 'Facebook post' | 'Certificate';

export const CATEGORIES: Category[] = [
  'Instagram post', 'Story', 'Poster', 'Flyer', 'Menu', 'Presentation', 'Business card', 'Invitation',
  'Resume', 'Logo', 'YouTube thumbnail', 'Video', 'Facebook post', 'Certificate',
];

export interface TemplateDef {
  id: string;
  title: string;
  category: Category;
  tags: string;
  width: number;
  height: number;
  print?: boolean;
  video?: boolean;
  pages: LoosePage[];
}

type Any = Record<string, unknown>;
export interface LoosePage { background: unknown; elements: Any[] }

const mm = (v: number) => Math.round((v * 96) / 25.4 * 100) / 100;
const inch = (v: number) => v * 96;

// ---- element helpers ----

type TOpts = { font?: string; size?: number; color?: string; align?: 'left' | 'center' | 'right'; bold?: boolean; italic?: boolean; ls?: number; lh?: number; upper?: boolean; underline?: boolean; opacity?: number; rotation?: number; list?: 'bullet' | 'number'; curve?: number; gradient?: unknown; effect?: unknown };
const txt = (text: string, x: number, y: number, w: number, o: TOpts = {}): Any => ({
  type: 'text', text, x, y, w, fontFamily: o.font ?? 'Inter', fontSize: o.size ?? 32, color: o.color ?? '#1f2328', align: o.align ?? 'left',
  bold: !!o.bold, italic: !!o.italic, letterSpacing: o.ls ?? 0, lineHeight: o.lh ?? 1.2, uppercase: !!o.upper, underline: !!o.underline,
  ...(o.opacity !== undefined ? { opacity: o.opacity } : {}), ...(o.rotation ? { rotation: o.rotation } : {}), ...(o.list ? { list: o.list } : {}),
  ...(o.curve ? { curve: o.curve } : {}), ...(o.gradient ? { gradient: o.gradient } : {}), ...(o.effect ? { effect: o.effect } : {}),
});
type SOpts = { radius?: number; stroke?: unknown; opacity?: number; rotation?: number; name?: string };
const rect = (x: number, y: number, w: number, h: number, fill: unknown, o: SOpts = {}): Any => ({ type: 'shape', shape: 'rect', x, y, w, h, fill, ...o });
const ell = (x: number, y: number, w: number, h: number, fill: unknown, o: SOpts = {}): Any => ({ type: 'shape', shape: 'ellipse', x, y, w, h, fill, ...o });
const shp = (shape: string, x: number, y: number, w: number, h: number, fill: unknown, o: SOpts = {}): Any => ({ type: 'shape', shape, x, y, w, h, fill, ...o });
const icon = (name: string, x: number, y: number, w: number, color = '#1f2328', h = w, o: { rotation?: number; opacity?: number } = {}): Any => ({ type: 'icon', icon: name, x, y, w, h, color, ...o });
const ln = (x1: number, y1: number, x2: number, y2: number, color: string, width = 2, dash?: 'dashed' | 'dotted'): Any => ({ type: 'line', x1, y1, x2, y2, stroke: { color, width, dash: dash ?? 'solid' } });
const path = (d: string, vb: [number, number], x: number, y: number, w: number, h: number, fill: unknown, o: SOpts & { strokeOnly?: string; sw?: number } = {}): Any => ({
  type: 'path', viewBox: { x: 0, y: 0, w: vb[0], h: vb[1] }, x, y, w, h, ...(o.opacity !== undefined ? { opacity: o.opacity } : {}), ...(o.rotation ? { rotation: o.rotation } : {}),
  paths: [{ d, fill: o.strokeOnly ? null : fill, stroke: o.strokeOnly ? { color: o.strokeOnly, width: o.sw ?? 2 } : null }],
});
const grad = (angle: number, ...colors: string[]) => ({ type: 'linear', angle, colors });

/** Decorative vectors in a 100×100 box. */
const BLOB = 'M73 8c13 7 23 22 24 38 1 17-6 34-20 44S43 101 28 95 2 75 1 57 6 21 20 10 60 1 73 8z';
const BLOB2 = 'M80 15c12 11 19 29 15 45s-17 31-34 36S24 95 13 82 0 47 8 30 33 3 50 2s18 2 30 13z';
const WAVE = 'M0 40C17 20 33 20 50 40S83 60 100 40V100H0z';
const WAVE2 = 'M0 60C20 35 40 85 60 55S90 30 100 45V100H0z';
const ARCH = 'M0 100V50a50 50 0 01100 0v50z';
const SQUIGGLE = 'M2 20c8-16 16-16 24 0s16 16 24 0 16-16 24 0 16 16 24 0';
const BRUSH = 'M3 30c20-14 60-22 94-18 4 1 3 6-1 7-30 3-60 9-88 20-6 2-9-6-5-9z';
const LEAF = 'M50 0C80 20 95 55 50 100 5 55 20 20 50 0z';
const STAR4 = 'M50 0c4 30 16 42 50 50-34 8-46 20-50 50-4-30-16-42-50-50 34-8 46-20 50-50z';
const dots = (x: number, y: number, cols: number, rows: number, gap: number, r: number, color: string, opacity = 1): Any => {
  let d = '';
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const cx = i * gap + r, cy = j * gap + r;
    d += `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
  }
  const w = (cols - 1) * gap + 2 * r, h = (rows - 1) * gap + 2 * r;
  return { type: 'path', viewBox: { x: 0, y: 0, w, h }, x, y, w, h, opacity, paths: [{ d, fill: color, stroke: null }] };
};

// ---- the library ----

const T: TemplateDef[] = [];
const add = (t: TemplateDef) => T.push(t);

// ===== Instagram posts (1080×1080) =====
{
  const W = 1080, H = 1080;
  add({ id: 'ig-sale-bold', title: 'Big Sale', category: 'Instagram post', tags: 'sale discount offer shop fashion promo', width: W, height: H, pages: [{
    background: '#ffe14d', elements: [
      ell(-160, 620, 640, 640, '#ff5a36'), ell(700, -180, 520, 520, '#ffffff', { opacity: 0.35 }),
      txt('MEGA', 80, 150, 920, { font: 'Anton', size: 230, color: '#111111', lh: 0.95 }),
      txt('SALE', 80, 360, 920, { font: 'Anton', size: 300, color: '#111111', lh: 0.95 }),
      rect(80, 700, 420, 110, '#111111', { radius: 55 }),
      txt('UP TO 70% OFF', 80, 730, 420, { font: 'Montserrat', size: 40, color: '#ffe14d', align: 'center', bold: true }),
      txt('This weekend only · shopname.com', 80, 860, 920, { font: 'Montserrat', size: 34, color: '#111111' }),
      icon('fluent-emoji-flat:shopping-bags', 760, 640, 260),
    ] }] });
  add({ id: 'ig-quote-serif', title: 'Quote of the day', category: 'Instagram post', tags: 'quote motivation inspiration words minimal', width: W, height: H, pages: [{
    background: '#f4ede4', elements: [
      rect(60, 60, 960, 960, null, { stroke: { color: '#c9b8a3', width: 3 } }),
      txt('“', 90, 110, 900, { font: 'Playfair Display', size: 260, color: '#b0896a', align: 'center', lh: 1 }),
      txt('The best time to plant a tree was twenty years ago. The second best time is now.', 140, 380, 800, { font: 'Playfair Display', size: 62, color: '#3b2f2a', align: 'center', italic: true, lh: 1.3 }),
      ln(470, 800, 610, 800, '#b0896a', 3),
      txt('CHINESE PROVERB', 140, 830, 800, { font: 'Montserrat', size: 26, color: '#7a6658', align: 'center', ls: 6, bold: true }),
    ] }] });
  add({ id: 'ig-cafe-new', title: 'New on the menu', category: 'Instagram post', tags: 'cafe coffee food restaurant drink menu launch', width: W, height: H, pages: [{
    background: grad(160, '#2b1b14', '#4b2e21'), elements: [
      path(BLOB, [100, 100], 330, 230, 700, 700, '#d9a066', { opacity: 0.9 }),
      icon('fluent-emoji-flat:hot-beverage', 480, 380, 420),
      txt('NEW', 80, 90, 600, { font: 'Bebas Neue', size: 90, color: '#d9a066', ls: 8 }),
      txt('Caramel\nCold Brew', 80, 180, 600, { font: 'DM Serif Display', size: 110, color: '#fff7ed', lh: 1 }),
      txt('Smooth · Sweet · Slow-steeped for 18 hours', 80, 920, 920, { font: 'Montserrat', size: 30, color: '#f1d8bf' }),
      rect(80, 830, 200, 64, '#d9a066', { radius: 32 }),
      txt('₹ 220', 80, 842, 200, { font: 'Montserrat', size: 34, color: '#2b1b14', bold: true, align: 'center' }),
    ] }] });
  add({ id: 'ig-tips-list', title: '5 Productivity tips', category: 'Instagram post', tags: 'tips list education carousel productivity work', width: W, height: H, pages: [{
    background: '#eef2ff', elements: [
      rect(0, 0, W, 300, '#4338ca'), dots(860, 40, 5, 4, 36, 6, '#a5b4fc', 0.8),
      txt('5 tips to get more done', 80, 80, 760, { font: 'Poppins', size: 72, color: '#ffffff', bold: true, lh: 1.05 }),
      ...['Plan tomorrow tonight', 'Do the hardest task first', 'Batch your email', 'Take real breaks', 'Say no more often'].flatMap((s, i) => [
        ell(80, 360 + i * 130, 84, 84, i % 2 ? '#4338ca' : '#f59e0b'),
        txt(String(i + 1), 80, 376 + i * 130, 84, { font: 'Poppins', size: 44, color: '#ffffff', bold: true, align: 'center' }),
        txt(s, 200, 378 + i * 130, 800, { font: 'Poppins', size: 44, color: '#1e1b4b' }),
      ]),
      txt('@yourhandle', 80, 1010, 920, { font: 'Poppins', size: 26, color: '#6366f1', align: 'right' }),
    ] }] });
  add({ id: 'ig-birthday', title: 'Happy Birthday', category: 'Instagram post', tags: 'birthday party celebration wishes friend', width: W, height: H, pages: [{
    background: grad(135, '#ff9a9e', '#fad0c4'), elements: [
      icon('fluent-emoji-flat:balloon', 60, 60, 220, '#000', 220, { rotation: -12 }), icon('fluent-emoji-flat:balloon', 800, 90, 200, '#000', 200, { rotation: 14 }),
      icon('fluent-emoji-flat:party-popper', 820, 760, 200),
      txt('Happy', 80, 300, 920, { font: 'Pacifico', size: 150, color: '#ffffff', align: 'center' }),
      txt('BIRTHDAY', 80, 520, 920, { font: 'Montserrat', size: 110, color: '#c2185b', align: 'center', bold: true, ls: 10 }),
      txt('Wishing you a year full of joy, Maya!', 140, 720, 800, { font: 'Montserrat', size: 36, color: '#6d1b3b', align: 'center' }),
      icon('fluent-emoji-flat:birthday-cake', 80, 780, 200),
    ] }] });
  add({ id: 'ig-realestate', title: 'Just listed', category: 'Instagram post', tags: 'real estate house property home listing', width: W, height: H, pages: [{
    background: '#0f2a3d', elements: [
      rect(540, 0, 540, H, '#e7d7c1'), icon('fluent-emoji-flat:house', 590, 230, 440),
      txt('JUST', 70, 120, 450, { font: 'Oswald', size: 120, color: '#e7d7c1', bold: true }),
      txt('LISTED', 70, 260, 450, { font: 'Oswald', size: 120, color: '#ffffff', bold: true }),
      ln(70, 440, 260, 440, '#e7b75f', 6),
      txt('3 BHK · 1,850 sq ft\nGarden · Parking · Pool', 70, 480, 440, { font: 'Lato', size: 34, color: '#d6e2ea', lh: 1.5 }),
      txt('₹1.2 Cr', 70, 700, 440, { font: 'Oswald', size: 90, color: '#e7b75f', bold: true }),
      txt('Call +91 98765 43210', 70, 900, 440, { font: 'Lato', size: 30, color: '#ffffff', bold: true }),
      txt('Lakeview Residences', 590, 760, 440, { font: 'Lato', size: 36, color: '#0f2a3d', align: 'center', bold: true }),
    ] }] });
  add({ id: 'ig-fitness', title: 'Fitness challenge', category: 'Instagram post', tags: 'gym fitness workout sport health challenge', width: W, height: H, pages: [{
    background: '#0b0b0f', elements: [
      shp('triangle', 560, 300, 700, 900, '#d4ff3a', { rotation: 18, opacity: 0.95 }),
      txt('30 DAY', 70, 90, 900, { font: 'Anton', size: 170, color: '#ffffff' }),
      txt('CHALLENGE', 70, 270, 900, { font: 'Anton', size: 170, color: '#d4ff3a' }),
      txt('Squats · Push-ups · Plank', 70, 490, 600, { font: 'Space Grotesk', size: 40, color: '#e5e5e5' }),
      rect(70, 860, 360, 100, '#d4ff3a', { radius: 12 }),
      txt('JOIN NOW', 70, 882, 360, { font: 'Space Grotesk', size: 46, color: '#0b0b0f', bold: true, align: 'center' }),
      icon('fluent-emoji-flat:fire', 700, 640, 300),
    ] }] });
}

// ===== Stories (1080×1920) =====
{
  const W = 1080, H = 1920;
  add({ id: 'story-travel', title: 'Travel diary', category: 'Story', tags: 'travel vacation holiday beach summer trip', width: W, height: H, pages: [{
    background: grad(180, '#7dd3fc', '#fef3c7'), elements: [
      ell(640, 200, 300, 300, '#fde047'), icon('fluent-emoji-flat:palm-tree', 80, 760, 600),
      path(WAVE, [100, 100], 0, 1320, W, 600, '#38bdf8'), path(WAVE2, [100, 100], 0, 1460, W, 460, '#0284c7'),
      txt('Bali', 80, 200, 700, { font: 'Pacifico', size: 220, color: '#ffffff', effect: { type: 'shadow', offset: 20, direction: 45, blur: 30, transparency: 60, color: '#0c4a6e' } }),
      txt('DAY 03 · ULUWATU', 90, 520, 700, { font: 'Montserrat', size: 46, color: '#0c4a6e', bold: true, ls: 6 }),
      txt('Swipe up for the full vlog', 80, 1700, 920, { font: 'Montserrat', size: 44, color: '#ffffff', align: 'center', bold: true }),
    ] }] });
  add({ id: 'story-poll', title: 'This or that', category: 'Story', tags: 'poll question engagement fun social', width: W, height: H, pages: [{
    background: '#111827', elements: [
      txt('THIS', 0, 160, W, { font: 'Bebas Neue', size: 150, color: '#f472b6', align: 'center' }),
      txt('or', 0, 300, W, { font: 'Pacifico', size: 90, color: '#ffffff', align: 'center' }),
      txt('THAT?', 0, 420, W, { font: 'Bebas Neue', size: 150, color: '#22d3ee', align: 'center' }),
      rect(90, 720, 420, 560, '#1f2937', { radius: 40 }), rect(570, 720, 420, 560, '#1f2937', { radius: 40 }),
      icon('fluent-emoji-flat:hot-beverage', 160, 790, 280), icon('fluent-emoji-flat:teacup-without-handle', 640, 790, 280),
      txt('Coffee', 90, 1130, 420, { font: 'Poppins', size: 56, color: '#f472b6', align: 'center', bold: true }),
      txt('Tea', 570, 1130, 420, { font: 'Poppins', size: 56, color: '#22d3ee', align: 'center', bold: true }),
      txt('Vote in the poll ↓', 0, 1480, W, { font: 'Poppins', size: 48, color: '#9ca3af', align: 'center' }),
    ] }] });
  add({ id: 'story-launch', title: 'Product launch', category: 'Story', tags: 'launch product startup app tech announcement', width: W, height: H, pages: [{
    background: grad(160, '#1e1b4b', '#6d28d9'), elements: [
      dots(90, 120, 8, 3, 50, 5, '#a78bfa', 0.6), icon('fluent-emoji-flat:rocket', 300, 400, 480),
      txt('Launching', 0, 1000, W, { font: 'Syne', size: 120, color: '#ffffff', align: 'center', bold: true }),
      txt('tomorrow', 0, 1140, W, { font: 'Syne', size: 120, color: '#f0abfc', align: 'center', bold: true, italic: true }),
      rect(240, 1420, 600, 120, '#ffffff', { radius: 60 }),
      txt('Set a reminder', 240, 1452, 600, { font: 'Syne', size: 46, color: '#4c1d95', align: 'center', bold: true }),
      txt('10:00 AM IST', 0, 1620, W, { font: 'Syne', size: 40, color: '#ddd6fe', align: 'center', ls: 6 }),
    ] }] });
  add({ id: 'story-minimal-quote', title: 'Morning note', category: 'Story', tags: 'quote minimal journal morning mindfulness', width: W, height: H, pages: [{
    background: '#f6f1ea', elements: [
      path(ARCH, [100, 100], 190, 300, 700, 900, '#e8c9a8'), icon('fluent-emoji-flat:sun', 390, 520, 300),
      txt('slow mornings,\nkind thoughts.', 90, 1290, 900, { font: 'Cormorant Garamond', size: 96, color: '#5b4636', align: 'center', italic: true, lh: 1.15 }),
      txt('— a note to self', 90, 1590, 900, { font: 'Montserrat', size: 34, color: '#8a7360', align: 'center', ls: 4 }),
    ] }] });
}

// ===== Posters (A3) =====
{
  const W = mm(297), H = mm(420);
  add({ id: 'poster-concert', title: 'Live concert', category: 'Poster', tags: 'music concert event gig band festival night', width: W, height: H, print: true, pages: [{
    background: grad(170, '#0f0c29', '#302b63', '#24243e'), elements: [
      ell(W / 2 - 380, 260, 760, 760, grad(90, '#ff512f', '#dd2476')), icon('fluent-emoji-flat:microphone', W / 2 - 170, 430, 340),
      txt('NEON', 60, 1050, W - 120, { font: 'Bungee', size: 150, color: '#ffffff', align: 'center', effect: { type: 'neon', intensity: 60 } }),
      txt('NIGHTS', 60, 1210, W - 120, { font: 'Bungee', size: 110, color: '#ff8fb1', align: 'center' }),
      txt('LIVE · SAT 14 DEC · 8 PM', 60, 1380, W - 120, { font: 'Space Grotesk', size: 40, color: '#ffffff', align: 'center', ls: 4, bold: true }),
      txt('The Warehouse, Bengaluru · tickets at neonnights.live', 60, 1450, W - 120, { font: 'Space Grotesk', size: 26, color: '#c4b5fd', align: 'center' }),
    ] }] });
  add({ id: 'poster-exhibition', title: 'Art exhibition', category: 'Poster', tags: 'art exhibition gallery museum modern swiss', width: W, height: H, print: true, pages: [{
    background: '#f2efe9', elements: [
      ell(120, 140, 560, 560, '#e63946'), rect(520, 440, 480, 480, '#1d3557'), shp('triangle', 160, 640, 420, 380, '#f4a261'),
      txt('FORM\n& COLOUR', 80, 1060, 960, { font: 'Archivo Black', size: 120, color: '#111111', lh: 0.95 }),
      ln(80, 1340, W - 80, 1340, '#111111', 3),
      txt('Modern abstract works\n12 Jan — 28 Feb', 80, 1370, 600, { font: 'Space Grotesk', size: 34, color: '#111111', lh: 1.35 }),
      txt('City Gallery\nopen daily 10–6', 640, 1370, W - 720, { font: 'Space Grotesk', size: 34, color: '#111111', align: 'right', lh: 1.35 }),
    ] }] });
  add({ id: 'poster-lost-cat', title: 'Missing pet', category: 'Poster', tags: 'lost missing pet cat dog notice community', width: W, height: H, print: true, pages: [{
    background: '#fffbea', elements: [
      rect(0, 0, W, 260, '#d62828'),
      txt('MISSING', 0, 50, W, { font: 'Anton', size: 170, color: '#ffffff', align: 'center' }),
      rect(160, 330, W - 320, 640, '#f1e6c8', { radius: 24 }), icon('fluent-emoji-flat:cat-face', W / 2 - 230, 400, 460),
      txt('Have you seen Biscuit?', 80, 1020, W - 160, { font: 'Poppins', size: 70, color: '#1f2328', align: 'center', bold: true }),
      txt('Orange tabby · white paws · blue collar\nLast seen near Park Street on 3 March', 80, 1130, W - 160, { font: 'Poppins', size: 36, color: '#444444', align: 'center', lh: 1.4 }),
      rect(180, 1330, W - 360, 120, '#d62828', { radius: 60 }),
      txt('Call 98765 43210', 180, 1358, W - 360, { font: 'Poppins', size: 52, color: '#ffffff', align: 'center', bold: true }),
    ] }] });
  add({ id: 'poster-workshop', title: 'Design workshop', category: 'Poster', tags: 'workshop class event education design learning', width: W, height: H, print: true, pages: [{
    background: '#fdf0d5', elements: [
      path(BLOB2, [100, 100], 520, -120, 760, 760, '#669bbc'), path(BLOB, [100, 100], -160, 1000, 700, 700, '#c1121f', { opacity: 0.9 }),
      icon('fluent-emoji-flat:artist-palette', 680, 160, 340),
      txt('Design\nThinking\nWorkshop', 80, 560, 900, { font: 'Fraunces', size: 130, color: '#003049', bold: true, lh: 1 }),
      txt('A hands-on Saturday for makers, students and founders.', 80, 1000, 760, { font: 'Inter', size: 36, color: '#003049', lh: 1.35 }),
      txt('18 MAY · 10AM – 4PM\nHUB 42, PUNE', 500, 1300, 540, { font: 'Inter', size: 40, color: '#ffffff', align: 'right', bold: true, lh: 1.3 }),
    ] }] });
}

// ===== Flyers (A4) =====
{
  const W = mm(210), H = mm(297);
  add({ id: 'flyer-yoga', title: 'Yoga classes', category: 'Flyer', tags: 'yoga wellness health class studio calm', width: W, height: H, print: true, pages: [{
    background: '#eef5ee', elements: [
      path(ARCH, [100, 100], 140, 110, W - 280, 520, '#b7d3b0'), icon('fluent-emoji-flat:potted-plant', W / 2 - 130, 300, 260),
      txt('Find your balance', 60, 680, W - 120, { font: 'Cormorant Garamond', size: 64, color: '#2f4a33', align: 'center', italic: true }),
      txt('MORNING YOGA', 60, 770, W - 120, { font: 'Montserrat', size: 30, color: '#2f4a33', align: 'center', bold: true, ls: 8 }),
      txt('Mon · Wed · Fri  ·  6:30–7:30 AM\nAll levels welcome · mats provided', 60, 850, W - 120, { font: 'Montserrat', size: 20, color: '#4b6650', align: 'center', lh: 1.6 }),
      rect(W / 2 - 160, 960, 320, 64, '#2f4a33', { radius: 32 }),
      txt('First class free', W / 2 - 160, 978, 320, { font: 'Montserrat', size: 22, color: '#ffffff', align: 'center', bold: true }),
      txt('greenleafyoga.in', 60, 1060, W - 120, { font: 'Montserrat', size: 18, color: '#4b6650', align: 'center' }),
    ] }] });
  add({ id: 'flyer-business', title: 'Business services', category: 'Flyer', tags: 'business corporate company services marketing agency', width: W, height: H, print: true, pages: [{
    background: '#ffffff', elements: [
      rect(0, 0, W, 420, grad(135, '#0f172a', '#1e40af')), shp('triangle', W - 300, 260, 340, 260, '#38bdf8', { rotation: 180, opacity: 0.8 }),
      txt('GROW YOUR\nBUSINESS', 60, 110, 600, { font: 'Montserrat', size: 64, color: '#ffffff', bold: true, lh: 1.05 }),
      txt('Digital marketing that actually converts.', 60, 290, 520, { font: 'Montserrat', size: 22, color: '#bfdbfe' }),
      ...[['fluent-emoji-flat:light-bulb', 'Strategy', 'Plans built on your numbers'], ['fluent-emoji-flat:mobile-phone', 'Social media', 'Content that people share'], ['fluent-emoji-flat:money-bag', 'Paid ads', 'Every rupee tracked']].flatMap(([ic, h, s], i) => [
        icon(ic!, 60, 490 + i * 150, 90), txt(h!, 180, 495 + i * 150, 520, { font: 'Montserrat', size: 30, color: '#0f172a', bold: true }),
        txt(s!, 180, 540 + i * 150, 520, { font: 'Montserrat', size: 20, color: '#475569' }),
      ]),
      rect(0, H - 130, W, 130, '#0f172a'),
      txt('hello@brightgrowth.co  ·  +91 80 4567 8900', 60, H - 82, W - 120, { font: 'Montserrat', size: 20, color: '#ffffff', align: 'center' }),
    ] }] });
  add({ id: 'flyer-bake-sale', title: 'Bake sale', category: 'Flyer', tags: 'bake sale school charity cakes cookies community', width: W, height: H, print: true, pages: [{
    background: '#fff1f2', elements: [
      dots(30, 30, 12, 16, 62, 6, '#fecdd3'),
      rect(60, 80, W - 120, H - 160, '#ffffff', { radius: 30 }),
      icon('fluent-emoji-flat:croissant', 120, 140, 160, '#000', 160, { rotation: -15 }), icon('fluent-emoji-flat:birthday-cake', W - 300, 130, 180),
      txt('Bake', 80, 340, W - 160, { font: 'Lobster', size: 120, color: '#e11d48', align: 'center' }),
      txt('SALE', 80, 480, W - 160, { font: 'Montserrat', size: 80, color: '#881337', align: 'center', bold: true, ls: 20 }),
      txt('Saturday 9 March · 10 AM\nSt. Mary’s School Hall', 80, 640, W - 160, { font: 'Montserrat', size: 26, color: '#881337', align: 'center', lh: 1.5 }),
      txt('All proceeds go to the library fund', 80, 800, W - 160, { font: 'Montserrat', size: 20, color: '#9f1239', align: 'center', italic: true }),
      icon('fluent-emoji-flat:ice-cream', W / 2 - 70, 870, 140),
    ] }] });
  add({ id: 'flyer-tech-meetup', title: 'Tech meetup', category: 'Flyer', tags: 'tech meetup developer code event conference talk', width: W, height: H, print: true, pages: [{
    background: '#0a0a0a', elements: [
      dots(40, 40, 11, 6, 60, 3, '#22c55e', 0.5),
      txt('</>', 60, 380, 400, { font: 'Space Mono', size: 90, color: '#22c55e', bold: true }),
      txt('JS Meetup\nBengaluru', 60, 490, W - 120, { font: 'Space Grotesk', size: 76, color: '#ffffff', bold: true, lh: 1.05 }),
      txt('#42 — Signals, servers and the edge', 60, 680, W - 120, { font: 'Space Mono', size: 22, color: '#86efac' }),
      ln(60, 760, W - 60, 760, '#22c55e', 2, 'dashed'),
      txt('THU 21 NOV\n6:30 PM', 60, 800, 320, { font: 'Space Grotesk', size: 30, color: '#ffffff', bold: true, lh: 1.3 }),
      txt('Free · pizza · RSVP\nmeetup.dev/blr', 380, 800, W - 440, { font: 'Space Grotesk', size: 24, color: '#a3a3a3', align: 'right', lh: 1.5 }),
      icon('fluent-emoji-flat:laptop', W - 260, 120, 200),
    ] }] });
}

// ===== Menus (A4) =====
{
  const W = mm(210), H = mm(297);
  const items = (list: [string, string, string?][], x: number, y: number, w: number, o: { font: string; color: string; sub: string; price: string; size?: number }) =>
    list.flatMap(([name, price, desc], i) => [
      txt(name, x, y + i * 74, w - 100, { font: o.font, size: o.size ?? 24, color: o.color, bold: true }),
      txt(price, x + w - 100, y + i * 74, 100, { font: o.font, size: o.size ?? 24, color: o.price, align: 'right', bold: true }),
      ...(desc ? [txt(desc, x, y + i * 74 + 32, w - 100, { font: 'Lato', size: 15, color: o.sub })] : []),
    ]);
  add({ id: 'menu-cafe', title: 'Café menu', category: 'Menu', tags: 'cafe coffee menu restaurant drinks food breakfast', width: W, height: H, print: true, pages: [{
    background: '#f5ebe0', elements: [
      rect(30, 30, W - 60, H - 60, null, { stroke: { color: '#7f5539', width: 2 } }),
      icon('fluent-emoji-flat:hot-beverage', W / 2 - 50, 70, 100),
      txt('The Daily Grind', 40, 180, W - 80, { font: 'DM Serif Display', size: 56, color: '#7f5539', align: 'center' }),
      txt('COFFEE · TEA · BAKES', 40, 255, W - 80, { font: 'Montserrat', size: 16, color: '#9c6644', align: 'center', ls: 6, bold: true }),
      txt('Coffee', 80, 320, 300, { font: 'DM Serif Display', size: 34, color: '#7f5539' }),
      ...items([['Espresso', '120', 'Double shot, dark roast'], ['Cappuccino', '180', 'Velvety foam, cocoa dust'], ['Flat white', '190', 'Silky micro-foam'], ['Cold brew', '220', '18-hour steep, over ice']], 80, 375, W - 160, { font: 'Lato', color: '#3c2a1e', sub: '#8a6a52', price: '#7f5539' }),
      txt('Bakes', 80, 700, 300, { font: 'DM Serif Display', size: 34, color: '#7f5539' }),
      ...items([['Butter croissant', '140', 'Laminated in-house'], ['Banana bread', '160', 'Walnuts, brown butter'], ['Cinnamon roll', '170', 'Cream cheese glaze']], 80, 755, W - 160, { font: 'Lato', color: '#3c2a1e', sub: '#8a6a52', price: '#7f5539' }),
      txt('Open 7 am – 9 pm · 12 Hill Road', 40, H - 90, W - 80, { font: 'Lato', size: 16, color: '#9c6644', align: 'center' }),
    ] }] });
  add({ id: 'menu-pizza', title: 'Pizzeria menu', category: 'Menu', tags: 'pizza italian restaurant menu food dinner', width: W, height: H, print: true, pages: [{
    background: '#1b1b1b', elements: [
      rect(0, 0, W, 300, '#c62828'), path(WAVE, [100, 100], 0, 240, W, 90, '#1b1b1b'),
      icon('fluent-emoji-flat:pizza', W - 250, 50, 200),
      txt('Forno Rosso', 60, 70, 500, { font: 'Lobster', size: 72, color: '#ffffff' }),
      txt('WOOD-FIRED PIZZA', 64, 170, 500, { font: 'Oswald', size: 24, color: '#ffcdd2', ls: 6 }),
      ...items([['Margherita', '349', 'Tomato, fior di latte, basil'], ['Diavola', '449', 'Spicy salami, chilli oil'], ['Quattro formaggi', '499', 'Four cheeses, honey'], ['Funghi', '429', 'Wild mushrooms, truffle'], ['Ortolana', '399', 'Grilled vegetables, pesto'], ['Calzone', '459', 'Ham, ricotta, mozzarella']], 60, 370, W - 120, { font: 'Oswald', color: '#ffffff', sub: '#bdbdbd', price: '#ff8a80', size: 26 }),
      rect(60, 860, W - 120, 160, '#2a2a2a', { radius: 16 }),
      txt('DESSERT', 90, 885, 300, { font: 'Oswald', size: 26, color: '#ff8a80' }),
      txt('Tiramisu 249  ·  Panna cotta 219  ·  Gelato 179', 90, 930, W - 180, { font: 'Lato', size: 18, color: '#e0e0e0' }),
      txt('Call to order: 080 2233 4455', 60, H - 80, W - 120, { font: 'Oswald', size: 20, color: '#bdbdbd', align: 'center' }),
    ] }] });
  add({ id: 'menu-indian', title: 'Sweets & lassi menu', category: 'Menu', tags: 'indian sweets lassi dairy menu shop beverages', width: W, height: H, print: true, pages: [{
    background: '#1d3c78', elements: [
      rect(18, 18, W - 36, H - 36, null, { stroke: { color: '#f4e9d8', width: 2 } }),
      rect(18, 18, W - 36, 160, '#f4e9d8'),
      txt('VARDAYINI', 40, 50, W - 80, { font: 'Bungee', size: 56, color: '#1d3c78', align: 'center' }),
      txt('DAIRY · SINCE 2001', 40, 125, W - 80, { font: 'Montserrat', size: 16, color: '#1d3c78', align: 'center', bold: true, ls: 6 }),
      txt('LASSI', 40, 215, W - 80, { font: 'Lilita One', size: 46, color: '#ffffff', align: 'center', italic: true }),
      txt('Flavour', 70, 290, 280, { font: 'Kalam', size: 24, color: '#ffffff', bold: true, underline: true }),
      txt('Glass', 420, 290, 120, { font: 'Kalam', size: 24, color: '#ffffff', bold: true, underline: true, align: 'right' }),
      txt('Ice cream', 560, 290, 160, { font: 'Kalam', size: 24, color: '#ffffff', bold: true, underline: true, align: 'right' }),
      ...[['Mango', '50', '60'], ['Kaju draksh', '60', '70'], ['Chocolate', '60', '70'], ['Kesar badam', '65', '75']].flatMap(([n, a, b], i) => [
        txt(n!, 70, 345 + i * 48, 320, { font: 'Kalam', size: 24, color: '#ffffff' }),
        txt(a!, 420, 345 + i * 48, 120, { font: 'Kalam', size: 24, color: '#ffffff', align: 'right' }),
        txt(b!, 560, 345 + i * 48, 160, { font: 'Kalam', size: 24, color: '#ffffff', align: 'right' }),
      ]),
      txt('MILK BEVERAGES', 40, 560, W - 80, { font: 'Lilita One', size: 40, color: '#ffffff', align: 'center', italic: true }),
      ...[['Rabadi', '80'], ['Basundi', '90'], ['Cold coffee', '50'], ['Badam milk', '60']].flatMap(([n, a], i) => [
        txt(n!, 70, 630 + i * 48, 320, { font: 'Kalam', size: 24, color: '#ffffff' }),
        txt(a!, 560, 630 + i * 48, 160, { font: 'Kalam', size: 24, color: '#ffffff', align: 'right' }),
      ]),
      icon('fluent-emoji-flat:ice-cream', 80, 860, 120), icon('fluent-emoji-flat:glass-of-milk', W - 200, 860, 120),
      txt('DESSERTS', 40, 880, W - 80, { font: 'Lilita One', size: 40, color: '#ffffff', align: 'center', italic: true }),
      txt('Biscoff fantasy 120 · Kulfi 40', 40, 940, W - 80, { font: 'Kalam', size: 22, color: '#f4e9d8', align: 'center' }),
    ] }] });
}

// ===== Presentations (1920×1080, several slides) =====
{
  const W = 1920, H = 1080;
  add({ id: 'deck-pitch', title: 'Startup pitch deck', category: 'Presentation', tags: 'pitch deck startup business investor slides', width: W, height: H, pages: [
    { background: grad(135, '#0f172a', '#312e81'), elements: [
      ell(1300, -200, 900, 900, grad(90, '#6366f1', '#ec4899'), { opacity: 0.85 }), icon('fluent-emoji-flat:rocket', 1450, 220, 380),
      txt('Acme', 140, 300, 1000, { font: 'Poppins', size: 160, color: '#ffffff', bold: true }),
      txt('Helping small shops sell online in 10 minutes.', 140, 520, 1000, { font: 'Poppins', size: 48, color: '#c7d2fe', lh: 1.25 }),
      txt('SEED ROUND · 2026', 140, 860, 800, { font: 'Poppins', size: 30, color: '#a5b4fc', ls: 8, bold: true }),
    ] },
    { background: '#ffffff', elements: [
      txt('The problem', 140, 120, 1200, { font: 'Poppins', size: 84, color: '#0f172a', bold: true }),
      rect(140, 260, 120, 10, '#6366f1', { radius: 5 }),
      ...[['63%', 'of small shops have no website'], ['14 days', 'average time to set up a store'], ['₹40k', 'typical first-year cost']].flatMap(([n, s], i) => [
        rect(140 + i * 560, 380, 500, 460, '#eef2ff', { radius: 32 }),
        txt(n!, 190 + i * 560, 450, 400, { font: 'Poppins', size: 110, color: '#4f46e5', bold: true }),
        txt(s!, 190 + i * 560, 640, 400, { font: 'Poppins', size: 38, color: '#334155', lh: 1.3 }),
      ]),
    ] },
    { background: '#ffffff', elements: [
      txt('Traction', 140, 120, 1200, { font: 'Poppins', size: 84, color: '#0f172a', bold: true }),
      rect(140, 260, 120, 10, '#6366f1', { radius: 5 }),
      { type: 'chart', chart: 'column', x: 140, y: 340, w: 1100, h: 620, labels: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'Shops', values: [120, 480, 1350, 3200] }], colors: ['#6366f1'], legend: false, grid: true, values: true, style: { fontFamily: 'Poppins', fontSize: 28, color: '#334155' } },
      txt('26× growth\nin 2025', 1360, 420, 440, { font: 'Poppins', size: 80, color: '#ec4899', bold: true, lh: 1.05 }),
      txt('Mostly word of mouth — no paid ads yet.', 1360, 640, 420, { font: 'Poppins', size: 34, color: '#475569', lh: 1.35 }),
    ] },
    { background: grad(135, '#312e81', '#0f172a'), elements: [
      txt('Thank you', 0, 380, W, { font: 'Poppins', size: 140, color: '#ffffff', bold: true, align: 'center' }),
      txt('founders@acme.shop', 0, 580, W, { font: 'Poppins', size: 44, color: '#c7d2fe', align: 'center' }),
    ] },
  ] });
  add({ id: 'deck-lesson', title: 'Science lesson', category: 'Presentation', tags: 'education lesson class school science teacher slides', width: W, height: H, pages: [
    { background: '#fef9c3', elements: [
      path(BLOB, [100, 100], 1180, 160, 760, 760, '#86efac'), icon('fluent-emoji-flat:sun', 1350, 280, 460),
      txt('Photosynthesis', 140, 320, 1100, { font: 'Fredoka', size: 140, color: '#166534', bold: true }),
      txt('How plants turn light into food', 140, 520, 1000, { font: 'Fredoka', size: 54, color: '#3f6212' }),
      txt('Grade 6 · Biology', 140, 860, 800, { font: 'Fredoka', size: 36, color: '#65a30d' }),
    ] },
    { background: '#ffffff', elements: [
      txt('What a plant needs', 140, 110, 1600, { font: 'Fredoka', size: 90, color: '#166534', bold: true }),
      ...[['fluent-emoji-flat:sun', 'Sunlight'], ['fluent-emoji-flat:droplet', 'Water'], ['fluent-emoji-flat:leaf-fluttering-in-wind', 'Carbon dioxide']].flatMap(([ic, s], i) => [
        ell(180 + i * 560, 330, 420, 420, ['#fef08a', '#bae6fd', '#bbf7d0'][i]!), icon(ic!, 270 + i * 560, 420, 240),
        txt(s!, 140 + i * 560, 790, 500, { font: 'Fredoka', size: 50, color: '#14532d', align: 'center' }),
      ]),
    ] },
    { background: '#f0fdf4', elements: [
      txt('Quick quiz', 140, 110, 1600, { font: 'Fredoka', size: 90, color: '#166534', bold: true }),
      txt('Which gas do plants give out?\nWhere does photosynthesis happen?\nWhy are leaves green?', 140, 300, 1500, { font: 'Fredoka', size: 60, color: '#14532d', lh: 1.6, list: 'number' }),
    ] },
  ] });
  add({ id: 'deck-report', title: 'Quarterly report', category: 'Presentation', tags: 'report business quarterly results corporate data chart', width: W, height: H, pages: [
    { background: '#ffffff', elements: [
      rect(0, 0, 720, H, '#0b3954'), rect(720, 0, 30, H, '#bfd7ea'),
      txt('Q3\n2026', 120, 300, 520, { font: 'Libre Baskerville', size: 140, color: '#ffffff', bold: true, lh: 1 }),
      txt('Quarterly business review', 860, 380, 900, { font: 'Libre Baskerville', size: 72, color: '#0b3954', lh: 1.15 }),
      txt('Finance & Operations', 860, 600, 900, { font: 'Inter', size: 36, color: '#087e8b', bold: true }),
    ] },
    { background: '#ffffff', elements: [
      txt('Revenue by region', 120, 100, 1200, { font: 'Libre Baskerville', size: 70, color: '#0b3954' }),
      { type: 'chart', chart: 'bar', x: 120, y: 260, w: 1000, h: 700, labels: ['North', 'South', 'East', 'West'], series: [{ name: 'Q2', values: [42, 38, 25, 31] }, { name: 'Q3', values: [51, 44, 29, 40] }], colors: ['#bfd7ea', '#087e8b'], legend: true, grid: true, style: { fontFamily: 'Inter', fontSize: 26, color: '#334155' } },
      rect(1220, 260, 580, 700, '#f1f5f9', { radius: 24 }),
      txt('+18%', 1270, 320, 480, { font: 'Libre Baskerville', size: 120, color: '#087e8b', bold: true }),
      txt('Revenue up quarter on quarter, led by the West region’s new retail partners.', 1270, 500, 480, { font: 'Inter', size: 34, color: '#334155', lh: 1.4 }),
    ] },
    { background: '#ffffff', elements: [
      txt('Key numbers', 120, 100, 1200, { font: 'Libre Baskerville', size: 70, color: '#0b3954' }),
      { type: 'table', x: 120, y: 260, w: 1680, h: 560, rows: [['Metric', 'Q2', 'Q3', 'Change'], ['Revenue (₹ Cr)', '136', '164', '+18%'], ['Customers', '8,420', '9,910', '+17%'], ['Churn', '3.1%', '2.4%', '−0.7 pt'], ['NPS', '41', '48', '+7']], headerFill: '#0b3954', style: { fontFamily: 'Inter', fontSize: 34, color: '#1f2937' } },
    ] },
  ] });
  add({ id: 'deck-minimal', title: 'Minimal portfolio', category: 'Presentation', tags: 'portfolio minimal design creative showcase', width: W, height: H, pages: [
    { background: '#f5f5f0', elements: [
      txt('Portfolio', 140, 360, 1200, { font: 'Syne', size: 200, color: '#111111', bold: true }),
      txt('Aarav Mehta — product designer', 150, 620, 1200, { font: 'Inter', size: 44, color: '#555555' }),
      ell(1450, 300, 360, 360, '#ff6b35'),
    ] },
    { background: '#111111', elements: [
      txt('01', 140, 140, 400, { font: 'Syne', size: 60, color: '#ff6b35', bold: true }),
      txt('Redesigning checkout for a grocery app', 140, 260, 900, { font: 'Syne', size: 84, color: '#ffffff', bold: true, lh: 1.05 }),
      txt('Cut drop-off at payment by 31% with a single-page flow.', 140, 640, 820, { font: 'Inter', size: 40, color: '#bbbbbb', lh: 1.4 }),
      rect(1100, 140, 680, 800, '#222222', { radius: 32 }), icon('fluent-emoji-flat:mobile-phone', 1290, 340, 300),
    ] },
  ] });
}

// ===== Business cards (85×55 mm) =====
{
  const W = mm(85), H = mm(55);
  add({ id: 'card-modern', title: 'Modern business card', category: 'Business card', tags: 'business card contact corporate modern', width: W, height: H, print: true, pages: [
    { background: '#0f172a', elements: [
      rect(0, H - 10, W, 10, grad(0, '#22d3ee', '#a855f7')),
      txt('Riya Kapoor', 24, 60, 280, { font: 'Poppins', size: 26, color: '#ffffff', bold: true }),
      txt('Creative Director', 24, 96, 280, { font: 'Poppins', size: 13, color: '#67e8f9', ls: 1 }),
      icon('ph:phone', 24, 132, 12, '#94a3b8'), txt('+91 98765 43210', 42, 130, 250, { font: 'Poppins', size: 11, color: '#e2e8f0' }),
      icon('ph:envelope-simple', 24, 152, 12, '#94a3b8'), txt('riya@studio.in', 42, 150, 250, { font: 'Poppins', size: 11, color: '#e2e8f0' }),
    ] },
    { background: grad(135, '#22d3ee', '#a855f7'), elements: [
      txt('STUDIO R', 0, 82, W, { font: 'Poppins', size: 32, color: '#ffffff', bold: true, align: 'center', ls: 6 }),
    ] },
  ] });
  add({ id: 'card-elegant', title: 'Elegant business card', category: 'Business card', tags: 'business card elegant gold luxury law', width: W, height: H, print: true, pages: [{
    background: '#f8f4ec', elements: [
      rect(10, 10, W - 20, H - 20, null, { stroke: { color: '#b08d57', width: 1 } }),
      txt('ANANYA ROY', 0, 56, W, { font: 'Cormorant Garamond', size: 26, color: '#2d2a26', align: 'center', bold: true, ls: 4 }),
      ln(W / 2 - 30, 96, W / 2 + 30, 96, '#b08d57', 1),
      txt('Advocate · High Court', 0, 106, W, { font: 'Cormorant Garamond', size: 14, color: '#6b5b45', align: 'center', italic: true }),
      txt('+91 99887 76655  ·  ananya@roylaw.in', 0, 150, W, { font: 'Lato', size: 10, color: '#2d2a26', align: 'center' }),
    ] }] });
  add({ id: 'card-bold', title: 'Bold color card', category: 'Business card', tags: 'business card bold colourful creative photographer', width: W, height: H, print: true, pages: [{
    background: '#ffde59', elements: [
      ell(200, -60, 200, 200, '#ff5757'),
      icon('fluent-emoji-flat:camera', 230, 20, 70),
      txt('KABIR\nSINGH', 22, 40, 200, { font: 'Archivo Black', size: 30, color: '#111111', lh: 0.95 }),
      txt('PHOTOGRAPHER', 22, 112, 200, { font: 'Montserrat', size: 10, color: '#111111', bold: true, ls: 3 }),
      txt('kabir.photo  ·  @kabirshoots', 22, 168, 290, { font: 'Montserrat', size: 10, color: '#111111' }),
    ] }] });
}

// ===== Invitations (5×7 in) =====
{
  const W = inch(5), H = inch(7);
  add({ id: 'invite-wedding', title: 'Floral wedding invitation', category: 'Invitation', tags: 'wedding invitation marriage floral save the date', width: W, height: H, print: true, pages: [{
    background: '#fbf7f2', elements: [
      icon('fluent-emoji-flat:bouquet', W / 2 - 50, 30, 100),
      txt('Together with their families', 30, 150, W - 60, { font: 'Cormorant Garamond', size: 16, color: '#7a6a5b', align: 'center', italic: true }),
      txt('Aditi', 30, 190, W - 60, { font: 'Great Vibes', size: 64, color: '#9c6b53', align: 'center' }),
      txt('&', 30, 262, W - 60, { font: 'Cormorant Garamond', size: 30, color: '#b08d57', align: 'center' }),
      txt('Rohan', 30, 300, W - 60, { font: 'Great Vibes', size: 64, color: '#9c6b53', align: 'center' }),
      txt('request the pleasure of your company', 30, 400, W - 60, { font: 'Cormorant Garamond', size: 15, color: '#7a6a5b', align: 'center' }),
      ln(W / 2 - 60, 440, W / 2 + 60, 440, '#b08d57', 1),
      txt('SATURDAY, 14 FEBRUARY 2027\nFOUR O’CLOCK IN THE AFTERNOON', 30, 455, W - 60, { font: 'Cormorant Garamond', size: 14, color: '#4b3f35', align: 'center', bold: true, ls: 2, lh: 1.6 }),
      txt('The Leela Palace, Udaipur', 30, 525, W - 60, { font: 'Cormorant Garamond', size: 16, color: '#4b3f35', align: 'center', italic: true }),
      icon('fluent-emoji-flat:cherry-blossom', 20, H - 90, 70), icon('fluent-emoji-flat:cherry-blossom', W - 90, H - 90, 70),
    ] }] });
  add({ id: 'invite-kids-party', title: 'Kids birthday party', category: 'Invitation', tags: 'birthday party kids invitation fun celebration', width: W, height: H, print: true, pages: [{
    background: '#bae6fd', elements: [
      dots(10, 10, 9, 13, 54, 4, '#ffffff', 0.7),
      rect(30, 120, W - 60, H - 180, '#ffffff', { radius: 30 }),
      icon('fluent-emoji-flat:balloon', 30, 20, 110, '#000', 110, { rotation: -10 }), icon('fluent-emoji-flat:wrapped-gift', W - 140, 30, 100),
      txt('You’re invited!', 40, 160, W - 80, { font: 'Fredoka', size: 40, color: '#0369a1', align: 'center', bold: true }),
      txt('Arjun is turning', 40, 230, W - 80, { font: 'Fredoka', size: 20, color: '#0c4a6e', align: 'center' }),
      txt('7', 40, 260, W - 80, { font: 'Fredoka', size: 150, color: '#f97316', align: 'center', bold: true }),
      txt('Sunday 12 Jan · 4–7 PM\nFunCity, Phoenix Mall', 40, 470, W - 80, { font: 'Fredoka', size: 20, color: '#0c4a6e', align: 'center', lh: 1.5 }),
      txt('RSVP to Neha · 98200 11223', 40, 560, W - 80, { font: 'Fredoka', size: 15, color: '#0369a1', align: 'center' }),
    ] }] });
  add({ id: 'invite-diwali', title: 'Diwali celebration', category: 'Invitation', tags: 'diwali festival india celebration party lights', width: W, height: H, print: true, pages: [{
    background: grad(180, '#3b0764', '#1e1b4b'), elements: [
      path(STAR4, [100, 100], 40, 40, 40, 40, '#fbbf24'), path(STAR4, [100, 100], W - 90, 90, 30, 30, '#fbbf24'), path(STAR4, [100, 100], 70, 300, 24, 24, '#fde68a'),
      icon('fluent-emoji-flat:diya-lamp', W / 2 - 80, 80, 160),
      txt('Happy', 30, 270, W - 60, { font: 'Great Vibes', size: 50, color: '#fde68a', align: 'center' }),
      txt('DIWALI', 30, 330, W - 60, { font: 'Cinzel', size: 56, color: '#fbbf24', align: 'center', bold: true, ls: 6 }),
      txt('Join us for an evening of lights, sweets and fireworks', 50, 430, W - 100, { font: 'Cinzel', size: 14, color: '#e9d5ff', align: 'center', lh: 1.5 }),
      txt('1 NOV · 7 PM ONWARDS\nThe Sharma residence', 30, 520, W - 60, { font: 'Cinzel', size: 14, color: '#fde68a', align: 'center', lh: 1.6, bold: true }),
    ] }] });
}

// ===== Resumes (A4) =====
{
  const W = mm(210), H = mm(297);
  add({ id: 'resume-sidebar', title: 'Sidebar resume', category: 'Resume', tags: 'resume cv job career professional two column', width: W, height: H, print: true, pages: [{
    background: '#ffffff', elements: [
      rect(0, 0, 260, H, '#1f3a5f'),
      ell(55, 50, 150, 150, '#dbe7f3'), txt('NI', 55, 92, 150, { font: 'Montserrat', size: 50, color: '#1f3a5f', align: 'center', bold: true }),
      txt('CONTACT', 30, 240, 210, { font: 'Montserrat', size: 13, color: '#9cc3e8', bold: true, ls: 3 }),
      txt('+91 98765 43210\nnisha.iyer@mail.com\nlinkedin.com/in/nishaiyer\nChennai, India', 30, 268, 210, { font: 'Lato', size: 12, color: '#ffffff', lh: 1.7 }),
      txt('SKILLS', 30, 400, 210, { font: 'Montserrat', size: 13, color: '#9cc3e8', bold: true, ls: 3 }),
      txt('Product strategy\nUser research\nSQL & analytics\nFigma\nStakeholder management', 30, 428, 210, { font: 'Lato', size: 12, color: '#ffffff', lh: 1.7, list: 'bullet' }),
      txt('EDUCATION', 30, 590, 210, { font: 'Montserrat', size: 13, color: '#9cc3e8', bold: true, ls: 3 }),
      txt('MBA, IIM Bangalore\n2016 – 2018\n\nB.Tech, NIT Trichy\n2011 – 2015', 30, 618, 210, { font: 'Lato', size: 12, color: '#ffffff', lh: 1.5 }),
      txt('Nisha Iyer', 300, 60, 450, { font: 'Montserrat', size: 44, color: '#1f3a5f', bold: true }),
      txt('Senior Product Manager', 300, 118, 450, { font: 'Montserrat', size: 18, color: '#4a90c2' }),
      txt('Product leader with 8 years building fintech and marketplace apps used by millions.', 300, 160, 450, { font: 'Lato', size: 13, color: '#444444', lh: 1.5 }),
      txt('EXPERIENCE', 300, 240, 450, { font: 'Montserrat', size: 14, color: '#1f3a5f', bold: true, ls: 3 }),
      ln(300, 264, W - 40, 264, '#d0dbe7', 1),
      ...[['Senior PM · PayQuick', '2021 – now', 'Led UPI autopay; grew active mandates 4× in 18 months.\nManaged a team of 3 PMs across payments and risk.'], ['Product Manager · ShopKart', '2018 – 2021', 'Shipped seller onboarding revamp, cutting time-to-first-sale by 40%.'], ['Analyst · Infosys', '2015 – 2016', 'Built reporting dashboards for a European retail client.']].flatMap(([r, d, s], i) => [
        txt(r!, 300, 285 + i * 150, 330, { font: 'Montserrat', size: 15, color: '#222222', bold: true }),
        txt(d!, 620, 287 + i * 150, W - 660, { font: 'Lato', size: 12, color: '#4a90c2', align: 'right' }),
        txt(s!, 300, 312 + i * 150, W - 340, { font: 'Lato', size: 12, color: '#555555', lh: 1.5 }),
      ]),
    ] }] });
  add({ id: 'resume-classic', title: 'Classic resume', category: 'Resume', tags: 'resume cv classic simple serif professional', width: W, height: H, print: true, pages: [{
    background: '#ffffff', elements: [
      txt('JAMES CARTER', 60, 60, W - 120, { font: 'Libre Baskerville', size: 38, color: '#111111', align: 'center', ls: 4 }),
      txt('Software Engineer · London · james@carter.dev · +44 7700 900123', 60, 112, W - 120, { font: 'Lato', size: 12, color: '#555555', align: 'center' }),
      ln(60, 145, W - 60, 145, '#111111', 1.5),
      ...[['PROFILE', 'Backend engineer focused on reliable distributed systems. Enjoys mentoring and writing clear docs.'], ['EXPERIENCE', 'Staff Engineer, Monzo (2022 – present)\nDesigned the ledger reconciliation service; on-call lead.\n\nSenior Engineer, Deliveroo (2018 – 2022)\nScaled order routing to 3M orders/day.'], ['EDUCATION', 'BSc Computer Science, University of Manchester (2014 – 2017)'], ['SKILLS', 'Go · Kotlin · PostgreSQL · Kafka · Kubernetes · AWS']].flatMap(([h, b], i) => [
        txt(h!, 60, 175 + [0, 110, 350, 440][i]!, 180, { font: 'Libre Baskerville', size: 14, color: '#111111', bold: true, ls: 2 }),
        txt(b!, 240, 175 + [0, 110, 350, 440][i]!, W - 300, { font: 'Lato', size: 13, color: '#333333', lh: 1.5 }),
      ]),
    ] }] });
}

// ===== Logos (500×500) =====
{
  const W = 500, H = 500;
  add({ id: 'logo-coffee', title: 'Coffee shop logo', category: 'Logo', tags: 'logo coffee cafe badge brand', width: W, height: H, pages: [{
    background: '#ffffff', elements: [
      ell(50, 50, 400, 400, '#3e2723'), ell(68, 68, 364, 364, null, { stroke: { color: '#d7ccc8', width: 3 } }),
      icon('fluent-emoji-flat:hot-beverage', 190, 120, 120),
      txt('BEAN THERE', 60, 255, 380, { font: 'Bebas Neue', size: 60, color: '#ffffff', align: 'center', ls: 4 }),
      txt('COFFEE CO. · EST 2024', 60, 325, 380, { font: 'Montserrat', size: 16, color: '#d7ccc8', align: 'center', ls: 3 }),
    ] }] });
  add({ id: 'logo-tech', title: 'Tech startup logo', category: 'Logo', tags: 'logo tech startup modern geometric brand', width: W, height: H, pages: [{
    background: '#ffffff', elements: [
      shp('hexagon', 175, 90, 150, 140, grad(135, '#06b6d4', '#6366f1')), shp('hexagon', 205, 118, 90, 84, '#ffffff'),
      txt('nexora', 50, 260, 400, { font: 'Poppins', size: 72, color: '#0f172a', align: 'center', bold: true }),
      txt('CLOUD SYSTEMS', 50, 355, 400, { font: 'Poppins', size: 18, color: '#6366f1', align: 'center', ls: 8 }),
    ] }] });
  add({ id: 'logo-bakery', title: 'Bakery logo', category: 'Logo', tags: 'logo bakery food handmade script brand', width: W, height: H, pages: [{
    background: '#fff7ed', elements: [
      path(ARCH, [100, 100], 130, 60, 240, 200, '#fdba74'), icon('fluent-emoji-flat:croissant', 185, 110, 130),
      txt('Butter & Co.', 30, 270, 440, { font: 'Pacifico', size: 56, color: '#9a3412', align: 'center' }),
      txt('HANDMADE BAKES', 30, 365, 440, { font: 'Montserrat', size: 16, color: '#c2410c', align: 'center', ls: 6, bold: true }),
    ] }] });
  add({ id: 'logo-fitness', title: 'Fitness club logo', category: 'Logo', tags: 'logo gym fitness sport strong bold', width: W, height: H, pages: [{
    background: '#0a0a0a', elements: [
      shp('star', 170, 60, 160, 160, '#d4ff3a'),
      txt('IRON', 30, 230, 440, { font: 'Anton', size: 110, color: '#ffffff', align: 'center' }),
      txt('FITNESS CLUB', 30, 375, 440, { font: 'Oswald', size: 30, color: '#d4ff3a', align: 'center', ls: 8 }),
    ] }] });
}

// ===== YouTube thumbnails (1280×720) =====
{
  const W = 1280, H = 720;
  add({ id: 'yt-howto', title: 'How-to thumbnail', category: 'YouTube thumbnail', tags: 'youtube thumbnail tutorial how to video bold', width: W, height: H, pages: [{
    background: '#ffcc00', elements: [
      rect(700, 0, 580, H, '#111111'), icon('fluent-emoji-flat:laptop', 780, 170, 420),
      txt('BUILD AN APP', 50, 120, 640, { font: 'Anton', size: 120, color: '#111111', lh: 0.95 }),
      txt('IN 10 MIN', 50, 380, 640, { font: 'Anton', size: 130, color: '#e11d48', lh: 0.95, rotation: -3 }),
      rect(50, 580, 280, 70, '#111111', { radius: 10 }),
      txt('NO CODE', 50, 592, 280, { font: 'Montserrat', size: 38, color: '#ffcc00', align: 'center', bold: true }),
    ] }] });
  add({ id: 'yt-vlog', title: 'Travel vlog thumbnail', category: 'YouTube thumbnail', tags: 'youtube thumbnail vlog travel adventure', width: W, height: H, pages: [{
    background: grad(120, '#0ea5e9', '#22c55e'), elements: [
      icon('fluent-emoji-flat:airplane', 760, 60, 420, '#000', 420, { rotation: -10 }),
      txt('I SPENT\n₹5000 IN', 60, 110, 700, { font: 'Bebas Neue', size: 140, color: '#ffffff', lh: 0.9, effect: { type: 'shadow', offset: 25, direction: 45, blur: 0, transparency: 0, color: '#0c4a6e' } }),
      txt('GOA', 60, 380, 700, { font: 'Bebas Neue', size: 220, color: '#fde047', effect: { type: 'shadow', offset: 25, direction: 45, blur: 0, transparency: 0, color: '#0c4a6e' } }),
    ] }] });
  add({ id: 'yt-podcast', title: 'Podcast episode', category: 'YouTube thumbnail', tags: 'youtube podcast episode interview talk show', width: W, height: H, pages: [{
    background: '#18181b', elements: [
      ell(800, 120, 480, 480, '#f97316'), icon('fluent-emoji-flat:microphone', 900, 200, 300),
      txt('EP. 42', 70, 90, 500, { font: 'Space Grotesk', size: 46, color: '#f97316', bold: true, ls: 4 }),
      txt('Why most startups fail (and how to not)', 70, 170, 700, { font: 'Space Grotesk', size: 76, color: '#ffffff', bold: true, lh: 1.05 }),
      txt('with Priya Nair, founder of Lumen', 70, 560, 700, { font: 'Space Grotesk', size: 34, color: '#a1a1aa' }),
    ] }] });
  add({ id: 'yt-recipe', title: 'Recipe thumbnail', category: 'YouTube thumbnail', tags: 'youtube recipe cooking food kitchen', width: W, height: H, pages: [{
    background: '#fef3c7', elements: [
      path(BLOB2, [100, 100], 620, 40, 640, 640, '#fb923c'), icon('fluent-emoji-flat:hamburger', 730, 150, 420),
      txt('Smash', 70, 110, 600, { font: 'Lilita One', size: 150, color: '#7c2d12' }),
      txt('Burger', 70, 280, 600, { font: 'Lilita One', size: 150, color: '#ea580c' }),
      rect(70, 500, 360, 90, '#7c2d12', { radius: 45 }),
      txt('15 MIN RECIPE', 70, 520, 360, { font: 'Montserrat', size: 36, color: '#fef3c7', align: 'center', bold: true }),
    ] }] });
}

// ===== Videos (1920×1080, timed pages) =====
{
  const W = 1920, H = 1080;
  add({ id: 'video-promo', title: 'Promo video', category: 'Video', tags: 'video promo ad intro animation sale', width: W, height: H, video: true, pages: [
    { background: '#111827', elements: [txt('Summer', 0, 330, W, { font: 'Pacifico', size: 220, color: '#fbbf24', align: 'center' }), txt('COLLECTION', 0, 640, W, { font: 'Montserrat', size: 90, color: '#ffffff', align: 'center', ls: 30, bold: true })] },
    { background: '#fbbf24', elements: [icon('fluent-emoji-flat:sun', 760, 160, 400), txt('New styles every week', 0, 640, W, { font: 'Montserrat', size: 90, color: '#111827', align: 'center', bold: true })] },
    { background: '#111827', elements: [txt('Shop now', 0, 360, W, { font: 'Montserrat', size: 160, color: '#ffffff', align: 'center', bold: true }), txt('store.example.com', 0, 600, W, { font: 'Montserrat', size: 60, color: '#fbbf24', align: 'center' })] },
  ] });
  add({ id: 'video-intro', title: 'Channel intro', category: 'Video', tags: 'video intro channel youtube opener', width: W, height: H, video: true, pages: [
    { background: grad(135, '#7c3aed', '#db2777'), elements: [icon('fluent-emoji-flat:sparkles', 810, 200, 300), txt('MAKE WITH MIRA', 0, 600, W, { font: 'Bungee', size: 120, color: '#ffffff', align: 'center' })] },
    { background: '#ffffff', elements: [txt('DIY · crafts · home decor', 0, 470, W, { font: 'Poppins', size: 90, color: '#7c3aed', align: 'center', bold: true })] },
  ] });
}

// ===== Facebook posts (940×788) =====
{
  const W = 940, H = 788;
  add({ id: 'fb-event', title: 'Community event', category: 'Facebook post', tags: 'facebook event community market weekend', width: W, height: H, pages: [{
    background: '#14532d', elements: [
      path(LEAF, [100, 100], 640, -60, 360, 420, '#22c55e', { rotation: 30 }), path(LEAF, [100, 100], -80, 480, 300, 360, '#16a34a', { rotation: -40 }),
      txt('FARMERS’', 70, 120, 700, { font: 'Oswald', size: 100, color: '#fef9c3', bold: true }),
      txt('MARKET', 70, 240, 700, { font: 'Oswald', size: 130, color: '#facc15', bold: true }),
      txt('Every Sunday · 7–11 AM · Cubbon Park', 70, 430, 760, { font: 'Lato', size: 34, color: '#ecfccb' }),
      icon('fluent-emoji-flat:tulip', 600, 520, 200), icon('fluent-emoji-flat:potted-plant', 760, 540, 160),
    ] }] });
  add({ id: 'fb-hiring', title: 'We are hiring', category: 'Facebook post', tags: 'hiring job recruitment career team', width: W, height: H, pages: [{
    background: '#ffffff', elements: [
      rect(0, 0, 360, H, '#2563eb'), dots(40, 40, 6, 6, 50, 5, '#93c5fd'),
      txt('WE’RE\nHIRING', 420, 140, 480, { font: 'Archivo Black', size: 100, color: '#111827', lh: 0.95 }),
      txt('Frontend engineer\nProduct designer\nCustomer success lead', 420, 400, 480, { font: 'Inter', size: 32, color: '#374151', lh: 1.5, list: 'bullet' }),
      txt('Apply at jobs.example.com', 420, 640, 480, { font: 'Inter', size: 28, color: '#2563eb', bold: true }),
      icon('fluent-emoji-flat:light-bulb', 80, 480, 200),
    ] }] });
}

// ===== Certificates (A4 landscape) =====
{
  const W = mm(297), H = mm(210);
  add({ id: 'cert-achievement', title: 'Certificate of achievement', category: 'Certificate', tags: 'certificate award achievement diploma recognition', width: W, height: H, print: true, pages: [{
    background: '#fffdf7', elements: [
      rect(24, 24, W - 48, H - 48, null, { stroke: { color: '#1e3a5f', width: 6 } }),
      rect(40, 40, W - 80, H - 80, null, { stroke: { color: '#c9a227', width: 2 } }),
      icon('fluent-emoji-flat:trophy', W / 2 - 50, 80, 100),
      txt('CERTIFICATE', 60, 200, W - 120, { font: 'Cinzel', size: 64, color: '#1e3a5f', align: 'center', bold: true, ls: 8 }),
      txt('OF ACHIEVEMENT', 60, 280, W - 120, { font: 'Cinzel', size: 22, color: '#c9a227', align: 'center', ls: 10 }),
      txt('This is proudly presented to', 60, 350, W - 120, { font: 'Cormorant Garamond', size: 22, color: '#555555', align: 'center', italic: true }),
      txt('Meera Krishnan', 60, 390, W - 120, { font: 'Great Vibes', size: 76, color: '#1e3a5f', align: 'center' }),
      ln(W / 2 - 260, 490, W / 2 + 260, 490, '#c9a227', 1.5),
      txt('for outstanding performance in the 2026 National Science Olympiad', 60, 510, W - 120, { font: 'Cormorant Garamond', size: 20, color: '#555555', align: 'center' }),
      ln(150, 660, 400, 660, '#1e3a5f', 1), txt('Principal', 150, 670, 250, { font: 'Cinzel', size: 14, color: '#1e3a5f', align: 'center' }),
      ln(W - 400, 660, W - 150, 660, '#1e3a5f', 1), txt('Date', W - 400, 670, 250, { font: 'Cinzel', size: 14, color: '#1e3a5f', align: 'center' }),
    ] }] });
}

// extra Instagram posts and stories for variety
{
  const W = 1080, H = 1080;
  add({ id: 'ig-gradient-announce', title: 'Big announcement', category: 'Instagram post', tags: 'announcement news gradient modern launch', width: W, height: H, pages: [{
    background: grad(135, '#ff6a00', '#ee0979'), elements: [
      path(SQUIGGLE, [100, 40], 90, 140, 300, 120, null, { strokeOnly: '#ffffff', sw: 6 }),
      txt('Big news', 90, 330, 900, { font: 'Syne', size: 150, color: '#ffffff', bold: true }),
      txt('is coming on Monday.', 90, 520, 900, { font: 'Syne', size: 70, color: '#ffe4e6' }),
      icon('fluent-emoji-flat:glowing-star', 800, 760, 200),
      txt('Turn on notifications', 90, 900, 700, { font: 'Syne', size: 36, color: '#ffffff', underline: true }),
    ] }] });
  add({ id: 'ig-thank-you', title: 'Thank you followers', category: 'Instagram post', tags: 'thank you followers milestone celebration 10k', width: W, height: H, pages: [{
    background: '#fdf2f8', elements: [
      path(BRUSH, [100, 40], 160, 520, 760, 220, '#f9a8d4'),
      txt('10K', 0, 200, W, { font: 'Abril Fatface', size: 300, color: '#831843', align: 'center' }),
      txt('thank you for being here', 0, 580, W, { font: 'Caveat', size: 90, color: '#831843', align: 'center' }),
      icon('fluent-emoji-flat:red-heart', 470, 790, 140),
    ] }] });
  add({ id: 'story-sale-countdown', title: 'Sale countdown', category: 'Story', tags: 'sale countdown flash offer story', width: 1080, height: 1920, pages: [{
    background: '#000000', elements: [
      txt('FLASH', 0, 380, 1080, { font: 'Anton', size: 260, color: '#ffffff', align: 'center' }),
      txt('SALE', 0, 660, 1080, { font: 'Anton', size: 260, color: '#ef4444', align: 'center' }),
      rect(190, 1080, 700, 200, '#ef4444', { radius: 30 }),
      txt('ENDS IN 24H', 190, 1130, 700, { font: 'Anton', size: 96, color: '#ffffff', align: 'center' }),
      txt('Use code FLASH50', 0, 1420, 1080, { font: 'Montserrat', size: 56, color: '#ffffff', align: 'center', bold: true }),
      icon('fluent-emoji-flat:fire', 440, 1580, 200),
    ] }] });
}

export const TEMPLATES = T;
