/**
 * Font combinations for the Text panel (Canva's "Font combinations"): ready
 * styled groups of text in Google Fonts pairings. Sizes are for a 1080 px
 * design and scale with the page. All fonts are on Google Fonts (OFL or
 * Apache), served by Fontsource and embedded in the design when used.
 */

export interface ComboLine {
  text: string;
  family: string;
  /** px on a 1080 px page. */
  size: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  /** Extra letter spacing, px on a 1080 px page. */
  spacing?: number;
  upper?: boolean;
}

export interface Combo {
  id: string;
  name: string;
  tags: string;
  lines: ComboLine[];
}

const INK = '#1f2328';

export const COMBOS: Combo[] = [
  { id: 'grand-opening', name: 'Grand opening', tags: 'event store launch elegant', lines: [
    { text: 'Grand Opening', family: 'Playfair Display', size: 96, bold: true },
    { text: 'This Saturday · 10 AM', family: 'Montserrat', size: 28, upper: true, spacing: 8 } ] },
  { id: 'sale', name: 'Big sale', tags: 'sale discount shop promo bold', lines: [
    { text: 'SALE', family: 'Anton', size: 170, color: '#e5484d' },
    { text: 'Up to 50% off', family: 'Montserrat', size: 40, bold: true, upper: true, spacing: 4 } ] },
  { id: 'birthday', name: 'Happy birthday', tags: 'birthday party celebration script', lines: [
    { text: 'Happy Birthday', family: 'Great Vibes', size: 112, color: '#c2185b' },
    { text: 'Sarah turns 30', family: 'Raleway', size: 28, upper: true, spacing: 10 } ] },
  { id: 'coffee', name: 'Coffee break', tags: 'cafe coffee food script', lines: [
    { text: 'Coffee', family: 'Pacifico', size: 104, color: '#6d4c41' },
    { text: 'Break time', family: 'Josefin Sans', size: 34, bold: true, upper: true, spacing: 12 } ] },
  { id: 'weekly', name: 'The weekly', tags: 'newsletter magazine serif', lines: [
    { text: 'The Weekly', family: 'DM Serif Display', size: 92 },
    { text: 'News, notes and the odd recipe', family: 'DM Sans', size: 28 } ] },
  { id: 'minimal', name: 'Minimal quote', tags: 'quote minimal modern', lines: [
    { text: 'Less, but better.', family: 'Space Grotesk', size: 80, bold: true },
    { text: '— Dieter Rams', family: 'Space Mono', size: 24 } ] },
  { id: 'wedding', name: 'Wedding', tags: 'wedding invitation script elegant', lines: [
    { text: 'together with their families', family: 'Cormorant Garamond', size: 34, italic: true },
    { text: 'Emma & James', family: 'Pinyon Script', size: 116 },
    { text: 'June 14, 2027', family: 'Cormorant Garamond', size: 28, upper: true, spacing: 8 } ] },
  { id: 'loud', name: 'Make it loud', tags: 'bold heading statement', lines: [
    { text: 'Make it loud', family: 'Archivo Black', size: 104, upper: true },
    { text: 'Bold ideas need bold type', family: 'Archivo', size: 30 } ] },
  { id: 'retro', name: 'Retro night', tags: 'retro neon party music', lines: [
    { text: 'RETRO', family: 'Monoton', size: 116, color: '#8b3dff' },
    { text: 'Night club · Fridays', family: 'Righteous', size: 38 } ] },
  { id: 'thanks', name: 'Thank you', tags: 'thank you card script', lines: [
    { text: 'Thank you', family: 'Dancing Script', size: 116, bold: true },
    { text: 'for being part of our story', family: 'Lato', size: 28 } ] },
  { id: 'workshop', name: 'Workshop', tags: 'event class poster condensed', lines: [
    { text: 'DESIGN WORKSHOP', family: 'Bebas Neue', size: 124 },
    { text: 'Every Thursday, 6–8 pm · Studio 4', family: 'Open Sans', size: 26 } ] },
  { id: 'menu', name: 'Menu', tags: 'restaurant food menu serif', lines: [
    { text: 'MENU', family: 'Cinzel', size: 96, bold: true, spacing: 10 },
    { text: 'Seasonal · Local · Fresh', family: 'Lora', size: 30, italic: true } ] },
  { id: 'summer', name: 'Summer vibes', tags: 'summer travel holiday script', lines: [
    { text: 'Summer', family: 'Kaushan Script', size: 112, color: '#f57c00' },
    { text: 'VIBES', family: 'Bebas Neue', size: 64, spacing: 18 } ] },
  { id: 'launch', name: 'Launch day', tags: 'tech product launch modern', lines: [
    { text: 'Launch Day', family: 'Unbounded', size: 76, bold: true },
    { text: 'Version 2.0 is here', family: 'Manrope', size: 28 } ] },
  { id: 'quote', name: 'Classic quote', tags: 'quote serif italic', lines: [
    { text: '“Simplicity is the ultimate sophistication.”', family: 'Libre Baskerville', size: 46, italic: true },
    { text: 'Leonardo da Vinci', family: 'Libre Franklin', size: 22, upper: true, spacing: 6 } ] },
  { id: 'kids', name: 'Party time', tags: 'kids party fun playful', lines: [
    { text: 'Party Time!', family: 'Luckiest Guy', size: 104, color: '#00a3d9' },
    { text: 'Games · Cake · Fun', family: 'Fredoka', size: 34 } ] },
  { id: 'maison', name: 'Maison', tags: 'fashion luxury elegant', lines: [
    { text: 'Maison', family: 'Italiana', size: 104 },
    { text: 'Paris · London', family: 'Marcellus', size: 24, upper: true, spacing: 12 } ] },
  { id: 'fitness', name: 'No excuses', tags: 'fitness gym sport condensed', lines: [
    { text: 'NO EXCUSES', family: 'Teko', size: 140, bold: true },
    { text: 'Start today. Train hard.', family: 'Barlow', size: 30 } ] },
  { id: 'hello', name: 'Hello there', tags: 'handwritten note casual', lines: [
    { text: 'Hello there!', family: 'Caveat', size: 96 },
    { text: 'Just a little note to say hi', family: 'Patrick Hand', size: 34 } ] },
  { id: 'editorial', name: 'Editorial', tags: 'fashion magazine serif', lines: [
    { text: 'Vogue Era', family: 'Bodoni Moda', size: 96, bold: true },
    { text: 'Autumn collection', family: 'Syne', size: 22, upper: true, spacing: 8 } ] },
  { id: 'podcast', name: 'Podcast', tags: 'podcast episode modern', lines: [
    { text: 'Episode 12', family: 'League Spartan', size: 96, bold: true },
    { text: 'Building in public', family: 'Work Sans', size: 30 } ] },
  { id: 'game', name: 'Game over', tags: 'game pixel retro', lines: [
    { text: 'GAME OVER', family: 'Press Start 2P', size: 56 },
    { text: 'Press start to continue', family: 'Space Mono', size: 24 } ] },
  { id: 'comic', name: 'Comic', tags: 'comic fun kids', lines: [
    { text: 'POW!', family: 'Bangers', size: 140, color: '#e5484d' },
    { text: 'Superhero training camp', family: 'Comfortaa', size: 28, bold: true } ] },
  { id: 'listed', name: 'Just listed', tags: 'real estate house business', lines: [
    { text: 'Just Listed', family: 'Fjalla One', size: 88, upper: true },
    { text: '3 bed · 2 bath · garden', family: 'Lato', size: 28 } ] },
  { id: 'christmas', name: 'Merry Christmas', tags: 'holiday christmas greeting', lines: [
    { text: 'Merry Christmas', family: 'Lobster', size: 96, color: '#c62828' },
    { text: '& a happy new year', family: 'Quicksand', size: 32 } ] },
  { id: 'science', name: 'Science fair', tags: 'school education modern', lines: [
    { text: 'Science Fair', family: 'Outfit', size: 84, bold: true },
    { text: 'Grade 7 · Room 201', family: 'Outfit', size: 28 } ] },
  { id: 'vintage', name: 'Since 1952', tags: 'vintage bakery classic', lines: [
    { text: 'Since 1952', family: 'Abril Fatface', size: 96 },
    { text: 'Family bakery', family: 'Prata', size: 30 } ] },
  { id: 'marker', name: 'Motivation', tags: 'motivation marker handwritten', lines: [
    { text: "Don't give up", family: 'Permanent Marker', size: 92 },
    { text: 'Monday motivation', family: 'Rubik', size: 28 } ] },
  { id: 'report', name: 'Annual report', tags: 'business corporate report', lines: [
    { text: 'Annual Report', family: 'Montserrat', size: 76, bold: true },
    { text: 'Fiscal year 2026', family: 'Merriweather', size: 28 } ] },
  { id: 'late', name: 'Open late', tags: 'restaurant pizza neon', lines: [
    { text: 'OPEN LATE', family: 'Staatliches', size: 124 },
    { text: 'Pizza & more', family: 'Satisfy', size: 52, color: '#e5484d' } ] },
  { id: 'roadtrip', name: 'Road trip', tags: 'travel adventure brush', lines: [
    { text: 'Road trip', family: 'Rock Salt', size: 70 },
    { text: 'Route 66', family: 'Barlow Condensed', size: 32, upper: true, spacing: 10 } ] },
  { id: 'secret', name: 'Top secret', tags: 'stamp military bold', lines: [
    { text: 'TOP SECRET', family: 'Black Ops One', size: 92 },
    { text: 'Classified file 027', family: 'JetBrains Mono', size: 24 } ] },
].map((c) => ({ ...c, lines: c.lines.map((l) => ({ color: INK, ...l })) }));

/** Popular fonts listed first in the font library (Canva-like picks). */
export const POPULAR_FONTS = ['Montserrat', 'Open Sans', 'Playfair Display', 'Poppins', 'Lato', 'Roboto', 'Bebas Neue', 'Oswald', 'Raleway', 'Great Vibes', 'Pacifico', 'Lobster', 'Anton', 'Dancing Script', 'Merriweather', 'Archivo Black'];

/** Fontsource id of a Google family ("Playfair Display" → "playfair-display"). */
export const fontId = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Combos matching search words (name, tags or font names). */
export function findCombos(query: string): Combo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return COMBOS;
  return COMBOS.filter((c) => {
    const hay = `${c.name} ${c.tags} ${c.lines.map((l) => `${l.family} ${l.text}`).join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
