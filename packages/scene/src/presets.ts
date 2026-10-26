import type { Unit } from './types.ts';

export interface Preset {
  id: string;
  name: string;
  category: 'Social' | 'Video' | 'Print' | 'Documents' | 'Marketing' | 'Web';
  width: number;
  height: number;
  unit: Unit;
  /** Print designs get a 3 mm bleed. */
  print?: boolean;
}

/** Design presets. The full catalogue (~200) lands in M5. */
export const PRESETS: Preset[] = [
  { id: 'instagram-post', name: 'Instagram post (square)', category: 'Social', width: 1080, height: 1080, unit: 'px' },
  { id: 'instagram-portrait', name: 'Instagram post (portrait)', category: 'Social', width: 1080, height: 1350, unit: 'px' },
  { id: 'story', name: 'Story / Reel', category: 'Social', width: 1080, height: 1920, unit: 'px' },
  { id: 'facebook-post', name: 'Facebook post', category: 'Social', width: 940, height: 788, unit: 'px' },
  { id: 'facebook-cover', name: 'Facebook cover', category: 'Social', width: 851, height: 315, unit: 'px' },
  { id: 'linkedin-post', name: 'LinkedIn post', category: 'Social', width: 1200, height: 1200, unit: 'px' },
  { id: 'linkedin-banner', name: 'LinkedIn banner', category: 'Social', width: 1584, height: 396, unit: 'px' },
  { id: 'x-post', name: 'X post', category: 'Social', width: 1600, height: 900, unit: 'px' },
  { id: 'x-header', name: 'X header', category: 'Social', width: 1500, height: 500, unit: 'px' },
  { id: 'pinterest-pin', name: 'Pinterest pin', category: 'Social', width: 1000, height: 1500, unit: 'px' },
  { id: 'youtube-thumbnail', name: 'YouTube thumbnail', category: 'Video', width: 1280, height: 720, unit: 'px' },
  { id: 'youtube-banner', name: 'YouTube banner', category: 'Video', width: 2560, height: 1440, unit: 'px' },
  { id: 'presentation', name: 'Presentation (16:9)', category: 'Documents', width: 1920, height: 1080, unit: 'px' },
  { id: 'presentation-43', name: 'Presentation (4:3)', category: 'Documents', width: 1024, height: 768, unit: 'px' },
  { id: 'a4', name: 'A4 document', category: 'Documents', width: 210, height: 297, unit: 'mm', print: true },
  { id: 'letter', name: 'US Letter document', category: 'Documents', width: 8.5, height: 11, unit: 'in', print: true },
  { id: 'resume', name: 'Resume (A4)', category: 'Documents', width: 210, height: 297, unit: 'mm', print: true },
  { id: 'business-card', name: 'Business card', category: 'Print', width: 85, height: 55, unit: 'mm', print: true },
  { id: 'business-card-us', name: 'Business card (US)', category: 'Print', width: 3.5, height: 2, unit: 'in', print: true },
  { id: 'flyer-a5', name: 'Flyer (A5)', category: 'Print', width: 148, height: 210, unit: 'mm', print: true },
  { id: 'poster-a3', name: 'Poster (A3)', category: 'Print', width: 297, height: 420, unit: 'mm', print: true },
  { id: 'poster-18x24', name: 'Poster (18×24 in)', category: 'Print', width: 18, height: 24, unit: 'in', print: true },
  { id: 'invitation', name: 'Invitation (5×7 in)', category: 'Print', width: 5, height: 7, unit: 'in', print: true },
  { id: 'postcard', name: 'Postcard (6×4 in)', category: 'Print', width: 6, height: 4, unit: 'in', print: true },
  { id: 'menu', name: 'Menu (A4)', category: 'Print', width: 210, height: 297, unit: 'mm', print: true },
  { id: 'certificate', name: 'Certificate (A4 landscape)', category: 'Print', width: 297, height: 210, unit: 'mm', print: true },
  { id: 'sticker', name: 'Sticker (3×3 in)', category: 'Print', width: 3, height: 3, unit: 'in', print: true },
  { id: 'logo', name: 'Logo', category: 'Marketing', width: 500, height: 500, unit: 'px' },
  { id: 'infographic', name: 'Infographic', category: 'Marketing', width: 800, height: 2000, unit: 'px' },
  { id: 'email-header', name: 'Email header', category: 'Web', width: 600, height: 200, unit: 'px' },
  { id: 'web-banner', name: 'Web banner (728×90)', category: 'Web', width: 728, height: 90, unit: 'px' },
  { id: 'medium-rectangle', name: 'Ad (300×250)', category: 'Web', width: 300, height: 250, unit: 'px' },
];
