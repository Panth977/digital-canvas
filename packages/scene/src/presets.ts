import type { Unit } from './types.ts';

export type PresetCategory = 'Social' | 'Video' | 'Presentations' | 'Documents' | 'Print' | 'Marketing' | 'Web';

export interface Preset {
  id: string;
  name: string;
  category: PresetCategory;
  width: number;
  height: number;
  unit: Unit;
  /** Print designs get a 3 mm bleed. */
  print?: boolean;
  /** Starts as a video (pages have durations). */
  video?: boolean;
  /** Extra words for search (network, format, synonyms). */
  keywords?: string;
}

export const PRESET_CATEGORIES: PresetCategory[] = ['Social', 'Video', 'Presentations', 'Documents', 'Print', 'Marketing', 'Web'];

type Extra = Pick<Preset, 'video' | 'keywords' | 'print'>;
const px = (category: PresetCategory) => (id: string, name: string, width: number, height: number, extra: Extra = {}): Preset =>
  ({ id, name, category, width, height, unit: 'px', ...extra });
const mm = (category: PresetCategory) => (id: string, name: string, width: number, height: number, extra: Extra = {}): Preset =>
  ({ id, name, category, width, height, unit: 'mm', print: true, ...extra });
const inch = (category: PresetCategory) => (id: string, name: string, width: number, height: number, extra: Extra = {}): Preset =>
  ({ id, name, category, width, height, unit: 'in', print: true, ...extra });

const social = px('Social');
const video = px('Video');
const deck = px('Presentations');
const docPx = px('Documents'), docMm = mm('Documents'), docIn = inch('Documents');
const printMm = mm('Print'), printIn = inch('Print');
const mkt = px('Marketing'), mktIn = inch('Marketing'), mktMm = mm('Marketing');
const web = px('Web');

/**
 * Design presets with their real sizes (as each network or print standard
 * publishes them). Screen sizes are px; print sizes are mm or inches and get
 * a bleed. Ids are stable: saved links and tests use them.
 */
export const PRESETS: Preset[] = [
  // ---- social ----
  social('instagram-post', 'Instagram post (square)', 1080, 1080),
  social('instagram-portrait', 'Instagram post (portrait)', 1080, 1350),
  social('instagram-landscape', 'Instagram post (landscape)', 1080, 566),
  social('story', 'Story / Reel', 1080, 1920, { keywords: 'instagram facebook vertical 9:16' }),
  social('instagram-story', 'Instagram story', 1080, 1920),
  social('instagram-carousel', 'Instagram carousel', 1080, 1350, { keywords: 'slides swipe' }),
  social('instagram-reel-cover', 'Instagram reel cover', 1080, 1920),
  social('instagram-highlight', 'Instagram highlight cover', 1080, 1920),
  social('instagram-profile', 'Instagram profile picture', 320, 320, { keywords: 'avatar' }),
  social('instagram-ad', 'Instagram ad', 1080, 1080, { keywords: 'advert' }),
  social('facebook-post', 'Facebook post', 940, 788),
  social('facebook-post-square', 'Facebook post (square)', 1080, 1080),
  social('facebook-cover', 'Facebook cover', 851, 315, { keywords: 'banner header' }),
  social('facebook-story', 'Facebook story', 1080, 1920),
  social('facebook-event-cover', 'Facebook event cover', 1920, 1005),
  social('facebook-group-cover', 'Facebook group cover', 1640, 856),
  social('facebook-ad', 'Facebook ad', 1200, 628, { keywords: 'advert link' }),
  social('facebook-profile', 'Facebook profile picture', 170, 170, { keywords: 'avatar' }),
  social('linkedin-post', 'LinkedIn post', 1200, 1200),
  social('linkedin-post-landscape', 'LinkedIn post (landscape)', 1200, 627),
  social('linkedin-carousel', 'LinkedIn carousel (document)', 1080, 1350, { keywords: 'slides pdf' }),
  social('linkedin-banner', 'LinkedIn banner', 1584, 396, { keywords: 'background cover header profile' }),
  social('linkedin-company-cover', 'LinkedIn company page cover', 1128, 191),
  social('linkedin-event-banner', 'LinkedIn event banner', 1776, 444),
  social('linkedin-article', 'LinkedIn article cover', 1920, 1080, { keywords: 'newsletter blog' }),
  social('linkedin-profile', 'LinkedIn profile picture', 400, 400, { keywords: 'avatar' }),
  social('x-post', 'X post', 1600, 900, { keywords: 'twitter tweet' }),
  social('x-post-square', 'X post (square)', 1080, 1080, { keywords: 'twitter tweet' }),
  social('x-header', 'X header', 1500, 500, { keywords: 'twitter banner cover' }),
  social('x-profile', 'X profile picture', 400, 400, { keywords: 'twitter avatar' }),
  social('x-ad', 'X ad (website card)', 800, 418, { keywords: 'twitter advert' }),
  social('pinterest-pin', 'Pinterest pin', 1000, 1500),
  social('pinterest-long-pin', 'Pinterest long pin', 1000, 2100, { keywords: 'infographic' }),
  social('pinterest-square-pin', 'Pinterest square pin', 1000, 1000),
  social('pinterest-idea-pin', 'Pinterest idea pin', 1080, 1920, { keywords: 'story video' }),
  social('pinterest-profile-cover', 'Pinterest profile cover', 800, 450),
  social('youtube-profile', 'YouTube profile picture', 800, 800, { keywords: 'channel icon avatar' }),
  social('youtube-community', 'YouTube community post', 1080, 1080),
  social('tiktok-profile', 'TikTok profile picture', 200, 200, { keywords: 'avatar' }),
  social('tiktok-photo', 'TikTok photo post', 1080, 1920),
  social('snapchat-story', 'Snapchat story', 1080, 1920),
  social('snapchat-geofilter', 'Snapchat geofilter', 1080, 2340, { keywords: 'filter lens' }),
  social('snapchat-ad', 'Snapchat ad', 1080, 1920, { keywords: 'advert' }),
  social('whatsapp-status', 'WhatsApp status', 1080, 1920, { keywords: 'story' }),
  social('whatsapp-profile', 'WhatsApp profile picture', 500, 500, { keywords: 'avatar business' }),
  social('whatsapp-post', 'WhatsApp image (square)', 800, 800),
  social('twitch-banner', 'Twitch banner', 1200, 480, { keywords: 'profile header' }),
  social('twitch-panel', 'Twitch panel', 320, 160),
  social('twitch-offline', 'Twitch offline screen', 1920, 1080, { keywords: 'stream' }),
  social('twitch-profile', 'Twitch profile picture', 256, 256, { keywords: 'avatar' }),
  social('twitch-overlay', 'Twitch stream overlay', 1920, 1080, { keywords: 'obs webcam frame' }),
  social('twitch-emote', 'Twitch emote', 112, 112, { keywords: 'emoji' }),
  social('threads-post', 'Threads post', 1080, 1350),
  social('bluesky-post', 'Bluesky post', 1200, 675),
  social('bluesky-banner', 'Bluesky banner', 1500, 500),
  social('discord-banner', 'Discord server banner', 960, 540),
  social('discord-icon', 'Discord server icon', 512, 512),
  social('discord-emoji', 'Discord emoji', 128, 128),
  social('reddit-banner', 'Reddit banner', 1920, 384, { keywords: 'subreddit community' }),
  social('reddit-avatar', 'Reddit avatar', 256, 256),
  social('telegram-sticker', 'Telegram sticker', 512, 512),
  social('tumblr-banner', 'Tumblr banner', 3000, 1055),
  social('social-square', 'Social media post (square)', 1080, 1080, { keywords: 'general' }),
  social('social-portrait', 'Social media post (4:5)', 1080, 1350, { keywords: 'general' }),

  // ---- video ----
  video('video', 'Video (16:9)', 1920, 1080, { video: true, keywords: 'full hd 1080p landscape' }),
  video('video-vertical', 'Video (vertical, Reel)', 1080, 1920, { video: true, keywords: 'mobile 9:16 story' }),
  video('video-4k', 'Video (4K UHD)', 3840, 2160, { video: true }),
  video('video-720', 'Video (720p)', 1280, 720, { video: true, keywords: 'hd' }),
  video('video-square', 'Video (square)', 1080, 1080, { video: true }),
  video('video-portrait', 'Video (4:5 feed)', 1080, 1350, { video: true, keywords: 'instagram facebook' }),
  video('youtube-video', 'YouTube video', 1920, 1080, { video: true }),
  video('youtube-shorts', 'YouTube Shorts', 1080, 1920, { video: true }),
  video('youtube-intro', 'YouTube intro', 1920, 1080, { video: true, keywords: 'outro' }),
  video('youtube-thumbnail', 'YouTube thumbnail', 1280, 720),
  video('youtube-banner', 'YouTube banner', 2560, 1440, { keywords: 'channel art' }),
  video('youtube-end-screen', 'YouTube end screen', 1920, 1080),
  video('tiktok-video', 'TikTok video', 1080, 1920, { video: true }),
  video('instagram-reel', 'Instagram reel', 1080, 1920, { video: true }),
  video('instagram-video-post', 'Instagram video post', 1080, 1350, { video: true }),
  video('facebook-video', 'Facebook video', 1280, 720, { video: true }),
  video('linkedin-video', 'LinkedIn video', 1920, 1080, { video: true }),
  video('x-video', 'X video', 1280, 720, { video: true, keywords: 'twitter' }),
  video('snapchat-video', 'Snapchat video', 1080, 1920, { video: true }),
  video('spotify-canvas', 'Spotify canvas', 1080, 1920, { video: true, keywords: 'music loop' }),
  video('gif-square', 'Animated GIF (square)', 480, 480, { video: true }),
  video('video-ad', 'Video ad (16:9)', 1920, 1080, { video: true, keywords: 'advert commercial' }),

  // ---- presentations ----
  deck('presentation', 'Presentation (16:9)', 1920, 1080, { keywords: 'slides deck' }),
  deck('presentation-43', 'Presentation (4:3)', 1024, 768, { keywords: 'slides deck' }),
  deck('presentation-4k', 'Presentation (4K)', 3840, 2160),
  deck('presentation-mobile', 'Mobile-first presentation', 1080, 1920),
  deck('pitch-deck', 'Pitch deck', 1920, 1080, { keywords: 'startup investor' }),
  deck('brainstorm', 'Brainstorm presentation', 1920, 1080),
  deck('education-deck', 'Education presentation', 1920, 1080, { keywords: 'lesson class school' }),
  mm('Presentations')('presentation-a4', 'Presentation (A4 landscape)', 297, 210),
  inch('Presentations')('presentation-letter', 'Presentation (Letter landscape)', 11, 8.5),

  // ---- documents ----
  docMm('a4', 'A4 document', 210, 297),
  docIn('letter', 'US Letter document', 8.5, 11),
  docIn('legal', 'US Legal document', 8.5, 14),
  docMm('a5-doc', 'A5 document', 148, 210),
  docMm('a3-doc', 'A3 document', 297, 420),
  docMm('resume', 'Resume (A4)', 210, 297, { keywords: 'cv' }),
  docIn('resume-us', 'Resume (US Letter)', 8.5, 11, { keywords: 'cv' }),
  docIn('cover-letter', 'Cover letter', 8.5, 11),
  docMm('report', 'Report (A4)', 210, 297),
  docIn('report-us', 'Report (US Letter)', 8.5, 11),
  docMm('proposal', 'Proposal (A4)', 210, 297, { keywords: 'business' }),
  docMm('invoice', 'Invoice (A4)', 210, 297, { keywords: 'bill receipt' }),
  docIn('invoice-us', 'Invoice (US Letter)', 8.5, 11, { keywords: 'bill receipt' }),
  docIn('newsletter', 'Newsletter (US Letter)', 8.5, 11),
  docIn('worksheet', 'Worksheet', 8.5, 11, { keywords: 'school class' }),
  docIn('lesson-plan', 'Lesson plan', 8.5, 11, { keywords: 'teacher school' }),
  docMm('planner', 'Planner (A4)', 210, 297, { keywords: 'weekly daily' }),
  docMm('planner-a5', 'Planner (A5)', 148, 210, { keywords: 'journal' }),
  docMm('agenda', 'Agenda (A4)', 210, 297, { keywords: 'meeting' }),
  docIn('meeting-minutes', 'Meeting minutes', 8.5, 11),
  docMm('press-release', 'Press release (A4)', 210, 297),
  docPx('ebook-cover', 'E-book cover', 1600, 2560, { keywords: 'kindle book' }),
  docPx('mind-map', 'Mind map', 1920, 1080, { keywords: 'diagram' }),
  docPx('org-chart', 'Organisational chart', 1920, 1080, { keywords: 'diagram org chart' }),
  docPx('timeline', 'Timeline', 1920, 1080, { keywords: 'diagram roadmap' }),

  // ---- print ----
  printMm('business-card', 'Business card', 85, 55, { keywords: 'eu uk' }),
  printIn('business-card-us', 'Business card (US)', 3.5, 2),
  printMm('business-card-vertical', 'Business card (vertical)', 55, 85),
  printMm('business-card-iso', 'Business card (credit-card size)', 85.6, 53.98),
  printMm('business-card-japan', 'Business card (Japan)', 91, 55),
  printIn('business-card-square', 'Business card (square)', 2.5, 2.5),
  printMm('flyer-a5', 'Flyer (A5)', 148, 210, { keywords: 'leaflet' }),
  printMm('flyer-a4', 'Flyer (A4)', 210, 297, { keywords: 'leaflet' }),
  printIn('flyer-letter', 'Flyer (US Letter)', 8.5, 11, { keywords: 'leaflet' }),
  printIn('flyer-half-letter', 'Flyer (half letter)', 5.5, 8.5, { keywords: 'leaflet' }),
  printMm('flyer-a6', 'Flyer (A6)', 105, 148, { keywords: 'leaflet' }),
  printMm('flyer-dl', 'Flyer (DL)', 99, 210, { keywords: 'leaflet rack' }),
  printMm('poster-a3', 'Poster (A3)', 297, 420),
  printMm('poster-a3-landscape', 'Poster (A3 landscape)', 420, 297),
  printMm('poster-a2', 'Poster (A2)', 420, 594),
  printMm('poster-a1', 'Poster (A1)', 594, 841),
  printMm('poster-a0', 'Poster (A0)', 841, 1189),
  printIn('poster-11x17', 'Poster (11×17 in, tabloid)', 11, 17),
  printIn('poster-18x24', 'Poster (18×24 in)', 18, 24),
  printIn('poster-24x36', 'Poster (24×36 in)', 24, 36),
  printIn('poster-27x40', 'Movie poster (27×40 in)', 27, 40),
  printIn('brochure-trifold', 'Brochure (tri-fold, Letter)', 11, 8.5, { keywords: 'leaflet fold' }),
  printMm('brochure-a4', 'Brochure (tri-fold, A4)', 297, 210, { keywords: 'leaflet fold' }),
  printMm('brochure-a3', 'Brochure (bi-fold, A3)', 420, 297, { keywords: 'leaflet fold' }),
  printIn('brochure-tabloid', 'Brochure (bi-fold, tabloid)', 17, 11, { keywords: 'leaflet fold' }),
  printMm('menu', 'Menu (A4)', 210, 297, { keywords: 'restaurant cafe food' }),
  printIn('menu-letter', 'Menu (US Letter)', 8.5, 11, { keywords: 'restaurant cafe food' }),
  printIn('menu-legal', 'Menu (US Legal)', 8.5, 14, { keywords: 'restaurant cafe food' }),
  printMm('menu-a3', 'Menu (A3)', 297, 420, { keywords: 'restaurant cafe food' }),
  printMm('menu-dl', 'Menu (DL, narrow)', 99, 210, { keywords: 'restaurant cafe food drinks' }),
  printIn('table-tent', 'Table tent (4×6 in)', 4, 6, { keywords: 'restaurant' }),
  printIn('invitation', 'Invitation (5×7 in)', 5, 7),
  printMm('invitation-a6', 'Invitation (A6)', 105, 148),
  printIn('invitation-square', 'Invitation (square 5.5 in)', 5.5, 5.5),
  printIn('invitation-4x6', 'Invitation (4×6 in)', 4, 6),
  printIn('wedding-invitation', 'Wedding invitation', 5, 7, { keywords: 'save the date rsvp' }),
  printIn('birthday-invitation', 'Birthday invitation', 5, 7, { keywords: 'party' }),
  printIn('greeting-card', 'Card (5×7 in)', 5, 7, { keywords: 'greeting birthday' }),
  printMm('card-a6', 'Card (A6 landscape)', 148, 105, { keywords: 'greeting' }),
  printIn('thank-you-card', 'Thank-you card', 5.5, 4.25),
  printIn('holiday-card', 'Holiday card', 7, 5, { keywords: 'christmas new year' }),
  printMm('certificate', 'Certificate (A4 landscape)', 297, 210, { keywords: 'award diploma' }),
  printMm('certificate-portrait', 'Certificate (A4 portrait)', 210, 297, { keywords: 'award diploma' }),
  printIn('certificate-letter', 'Certificate (US Letter)', 11, 8.5, { keywords: 'award diploma' }),
  printIn('label-round', 'Label (round 2 in)', 2, 2, { keywords: 'circle sticker' }),
  printIn('label-address', 'Address label', 2.625, 1, { keywords: 'avery 5160 mailing' }),
  printIn('label-shipping', 'Shipping label (4×6 in)', 4, 6, { keywords: 'parcel' }),
  printIn('label-product', 'Product label (4×3 in)', 4, 3),
  printIn('label-wine', 'Wine label', 4, 3.5, { keywords: 'bottle' }),
  printIn('label-jar', 'Jar label (round 3 in)', 3, 3),
  printIn('sticker', 'Sticker (3×3 in)', 3, 3),
  printIn('sticker-round', 'Sticker (round 2 in)', 2, 2),
  printIn('sticker-rect', 'Sticker (3×2 in)', 3, 2),
  printIn('sticker-4x4', 'Sticker (4×4 in)', 4, 4),
  printIn('bumper-sticker', 'Bumper sticker', 11, 3),
  printMm('letterhead', 'Letterhead (A4)', 210, 297, { keywords: 'stationery' }),
  printIn('letterhead-us', 'Letterhead (US Letter)', 8.5, 11, { keywords: 'stationery' }),
  printMm('envelope-dl', 'Envelope (DL)', 220, 110),
  printMm('envelope-c5', 'Envelope (C5)', 229, 162),
  printMm('envelope-c6', 'Envelope (C6)', 162, 114),
  printIn('envelope-10', 'Envelope (#10)', 9.5, 4.125, { keywords: 'business us' }),
  printIn('envelope-a7', 'Envelope (A7, 5×7 card)', 7.25, 5.25),
  printIn('envelope-a2', 'Envelope (A2)', 5.75, 4.375),
  printIn('postcard', 'Postcard (6×4 in)', 6, 4),
  printMm('postcard-a6', 'Postcard (A6)', 148, 105),
  printIn('postcard-5x7', 'Postcard (7×5 in)', 7, 5),
  printIn('postcard-jumbo', 'Postcard (jumbo 8.5×5.5 in)', 8.5, 5.5),
  printMm('calendar-a4', 'Calendar (A4)', 210, 297),
  printMm('calendar-a3', 'Calendar (A3)', 297, 420),
  printIn('calendar-letter', 'Calendar (US Letter landscape)', 11, 8.5),
  printIn('calendar-wall', 'Wall calendar (12×12 in)', 12, 12),
  printIn('calendar-desk', 'Desk calendar', 8.5, 5.5),
  printIn('book-cover', 'Book cover (6×9 in)', 6, 9, { keywords: 'paperback novel' }),
  printIn('book-cover-5x8', 'Book cover (5×8 in)', 5, 8, { keywords: 'paperback novel' }),
  printMm('book-cover-a5', 'Book cover (A5)', 148, 210),
  printIn('book-cover-pocket', 'Book cover (pocket, 4.25×6.87 in)', 4.25, 6.87, { keywords: 'mass market' }),
  printIn('book-cover-children', "Children's book (8×10 in)", 8, 10),
  printIn('magazine-cover', 'Magazine cover (US)', 8.375, 10.875),
  printMm('magazine-a4', 'Magazine (A4)', 210, 297),
  printIn('magazine-letter', 'Magazine (US Letter)', 8.5, 11),
  printMm('rollup-banner', 'Roll-up banner (850×2000 mm)', 850, 2000, { keywords: 'pull up stand' }),
  printIn('banner-outdoor', 'Outdoor banner (6×3 ft)', 72, 36, { keywords: 'vinyl' }),
  printIn('banner-vinyl', 'Vinyl banner (4×2 ft)', 48, 24),
  printIn('yard-sign', 'Yard sign (24×18 in)', 24, 18, { keywords: 'lawn' }),
  printIn('bookmark', 'Bookmark (2×6 in)', 2, 6),
  printIn('rack-card', 'Rack card (4×9 in)', 4, 9),
  printIn('door-hanger', 'Door hanger', 4.25, 11),
  printIn('ticket', 'Ticket (5.5×2 in)', 5.5, 2, { keywords: 'event admission' }),
  printIn('name-tag', 'Name tag (4×3 in)', 4, 3, { keywords: 'badge conference' }),
  printIn('photo-4x6', 'Photo print (6×4 in)', 6, 4),
  printIn('photo-5x7', 'Photo print (7×5 in)', 7, 5),
  printIn('photo-book', 'Photo book (8×8 in)', 8, 8, { keywords: 'album' }),
  printIn('photo-collage', 'Photo collage (8×10 in)', 8, 10),
  printIn('t-shirt', 'T-shirt print (12×16 in)', 12, 16, { keywords: 'merch apparel' }),
  printIn('mug', 'Mug wrap (8.5×3.5 in)', 8.5, 3.5, { keywords: 'merch' }),
  printIn('tote-bag', 'Tote bag print (14×16 in)', 14, 16, { keywords: 'merch' }),

  // ---- marketing ----
  mkt('logo', 'Logo', 500, 500, { keywords: 'brand' }),
  mkt('logo-wide', 'Logo (wide)', 1600, 600, { keywords: 'brand wordmark' }),
  mkt('infographic', 'Infographic', 800, 2000),
  mkt('brand-board', 'Brand board', 1920, 1080, { keywords: 'brand kit style guide' }),
  mkt('mood-board', 'Mood board', 1920, 1080, { keywords: 'inspiration' }),
  mkt('menu-board', 'Menu board (TV screen)', 1920, 1080, { keywords: 'digital signage restaurant' }),
  mkt('signage-landscape', 'Digital signage (landscape)', 1920, 1080, { keywords: 'screen tv' }),
  mkt('signage-portrait', 'Digital signage (portrait)', 1080, 1920, { keywords: 'screen tv kiosk' }),
  mkt('podcast-cover', 'Podcast cover', 3000, 3000, { keywords: 'spotify apple' }),
  mkt('album-cover', 'Album cover', 3000, 3000, { keywords: 'music spotify' }),
  mkt('etsy-banner', 'Etsy shop banner', 3360, 840, { keywords: 'shop cover' }),
  mkt('etsy-icon', 'Etsy shop icon', 500, 500),
  mkt('product-image', 'Product image (Amazon, square)', 2000, 2000, { keywords: 'ecommerce shop listing' }),
  mkt('product-photo-portrait', 'Product photo (4:5)', 1600, 2000, { keywords: 'ecommerce shop' }),
  mktIn('coupon', 'Coupon (6×3 in)', 6, 3, { keywords: 'voucher discount' }),
  mktIn('gift-certificate', 'Gift certificate (8×3.5 in)', 8, 3.5, { keywords: 'voucher' }),
  mktIn('sales-sheet', 'Sales sheet (US Letter)', 8.5, 11, { keywords: 'sell sheet one pager' }),
  mktMm('sales-sheet-a4', 'Sales sheet (A4)', 210, 297, { keywords: 'one pager' }),
  mktIn('real-estate-flyer', 'Real estate flyer', 8.5, 11, { keywords: 'property listing' }),
  mktIn('price-list', 'Price list', 8.5, 11),
  mkt('case-study', 'Case study graphic', 1200, 1500),
  mkt('announcement', 'Announcement', 1080, 1080, { keywords: 'launch news' }),
  mkt('quote-post', 'Quote graphic', 1080, 1080),

  // ---- web & ads ----
  web('email-header', 'Email header', 600, 200, { keywords: 'newsletter banner' }),
  web('email-header-wide', 'Email header (wide)', 1200, 400, { keywords: 'newsletter banner retina' }),
  web('email-newsletter', 'Email newsletter', 600, 1200),
  web('email-signature', 'Email signature banner', 600, 100),
  web('web-banner', 'Leaderboard ad (728×90)', 728, 90, { keywords: 'iab web banner' }),
  web('medium-rectangle', 'Medium rectangle ad (300×250)', 300, 250, { keywords: 'iab mpu' }),
  web('large-rectangle', 'Large rectangle ad (336×280)', 336, 280, { keywords: 'iab' }),
  web('half-page', 'Half-page ad (300×600)', 300, 600, { keywords: 'iab' }),
  web('wide-skyscraper', 'Wide skyscraper ad (160×600)', 160, 600, { keywords: 'iab' }),
  web('skyscraper', 'Skyscraper ad (120×600)', 120, 600, { keywords: 'iab' }),
  web('billboard-ad', 'Billboard ad (970×250)', 970, 250, { keywords: 'iab' }),
  web('large-leaderboard', 'Large leaderboard ad (970×90)', 970, 90, { keywords: 'iab super' }),
  web('mobile-banner', 'Mobile banner ad (320×50)', 320, 50, { keywords: 'iab leaderboard' }),
  web('large-mobile-banner', 'Large mobile banner ad (320×100)', 320, 100, { keywords: 'iab' }),
  web('square-ad', 'Square ad (250×250)', 250, 250, { keywords: 'iab' }),
  web('small-square-ad', 'Small square ad (200×200)', 200, 200, { keywords: 'iab' }),
  web('full-banner', 'Full banner ad (468×60)', 468, 60, { keywords: 'iab' }),
  web('half-banner', 'Half banner ad (234×60)', 234, 60, { keywords: 'iab' }),
  web('vertical-banner', 'Vertical banner ad (120×240)', 120, 240, { keywords: 'iab' }),
  web('portrait-ad', 'Portrait ad (300×1050)', 300, 1050, { keywords: 'iab' }),
  web('mobile-interstitial', 'Mobile interstitial (320×480)', 320, 480, { keywords: 'iab fullscreen' }),
  web('mobile-interstitial-landscape', 'Mobile interstitial (480×320)', 480, 320, { keywords: 'iab fullscreen' }),
  web('display-ad-landscape', 'Display ad (1200×628)', 1200, 628, { keywords: 'google responsive' }),
  web('display-ad-square', 'Display ad (1200×1200)', 1200, 1200, { keywords: 'google responsive' }),
  web('og-image', 'Link preview (Open Graph)', 1200, 630, { keywords: 'og social share card' }),
  web('blog-banner', 'Blog banner', 1200, 630, { keywords: 'header featured image' }),
  web('website-hero', 'Website hero', 1920, 1080, { keywords: 'landing page header' }),
  web('website-mockup', 'Website (desktop)', 1440, 900, { keywords: 'landing page ui' }),
  web('app-screen', 'Mobile app screen', 1170, 2532, { keywords: 'iphone ui' }),
  web('favicon', 'Favicon', 512, 512, { keywords: 'site icon' }),
  web('app-icon', 'App icon', 1024, 1024, { keywords: 'ios android' }),
  web('desktop-wallpaper', 'Desktop wallpaper', 1920, 1080, { keywords: 'background' }),
  web('desktop-wallpaper-4k', 'Desktop wallpaper (4K)', 3840, 2160, { keywords: 'background' }),
  web('phone-wallpaper', 'Phone wallpaper', 1170, 2532, { keywords: 'iphone lock screen background' }),
  web('tablet-wallpaper', 'Tablet wallpaper', 2048, 2732, { keywords: 'ipad background' }),
  web('zoom-background', 'Zoom virtual background', 1920, 1080, { keywords: 'video call meet' }),
  web('teams-background', 'Teams background', 1920, 1080, { keywords: 'video call microsoft' }),
];

/** Presets matching a search (every word must appear in the name, category, size or keywords). */
export function searchPresets(query: string, category?: PresetCategory | 'All', list: Preset[] = PRESETS): Preset[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((p) => {
    if (category && category !== 'All' && p.category !== category) return false;
    if (!words.length) return true;
    const hay = `${p.name} ${p.category} ${p.width}x${p.height} ${p.width}×${p.height} ${p.unit} ${p.keywords ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
