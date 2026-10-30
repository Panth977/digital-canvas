/** The design guide served as a resource and quoted by the prompts. */
import { IMAGE_FILTERS } from '@digital-canvas/scene';

export const WORKFLOW = `1. Understand the brief: format (post, story, reel, poster, thumbnail…), message, audience, brand.
2. Gather material first: list_assets / search_drive (the user's own photos and clips are best), get_brand_kit, search_stock for anything missing. Import what you'll use.
3. Pick a starting point: list_templates (pass design_id or a preset to rank by fit) or a blank create_design with the right preset.
4. Compose with few, large, batched calls: add_elements with several elements at once; set_page background_media for full-bleed photos/videos with an overlay tint.
5. LOOK at it: render_page (show_ids: true to point at elements). Judge hierarchy, balance, spacing, legibility.
6. Critique: check_design. Fix every error and warning (update_elements), re-render.
7. Export: export_image / export_pdf / export_video (check the reel with render_page at a few times first). Share the link and open_in_editor for hand edits.`;

export const GUIDE = `# Digital Canvas — design guide for agents

## Workflow
${WORKFLOW}

## Coordinates
Pixels, origin top-left of the page, boxes are [x, y, w, h]. A 1080×1080 post: centre x = 540. Keep text ≥ 5% of the short side from edges (54 px on 1080).
Stacking: later elements are on top; add_elements position "bottom" for backgrounds.

## Sizes (presets)
instagram-post 1080×1080 · instagram-portrait 1080×1350 · instagram-story / instagram-reel / youtube-shorts / tiktok-video 1080×1920 · youtube-thumbnail 1280×720 · facebook-post 940×788 · linkedin-post 1200×1200 · x-post 1600×900 · pinterest-pin 1000×1500 · presentation 1920×1080 · a4 210×297 mm · letter 8.5×11 in · poster-a3 · poster-18x24 · flyer-a4 · business-card. list_size_presets for 270+ more.

## Typography that works
- One display face + one text face. Pairings: Anton + Montserrat (bold promo) · Bebas Neue + Poppins · Playfair Display + Lato (elegant) · DM Serif Display + DM Sans (editorial) · Pacifico + Montserrat (playful) · Oswald + Lato.
- Scale on 1080 px: headline 90–200 (lineHeight 0.9–1.05), subhead 44–70, body 28–40, small print ≥ 24. Thumbnails: 2–5 huge words.
- Max ~3 sizes per design. Left-align body text; centre short headlines.
- Over photos: add an overlay (shape rect fill "#00000066") or text effect {type:"shadow"} / {type:"background"}.
- autoFit "shrink" fits a fixed box; leave w out to hug short text.

## Colour
60/30/10: one dominant, one secondary, one accent. Use the brand kit when there is one. Text contrast ≥ 4.5:1 (≥ 3:1 for big headlines) — check_design measures it on the real pixels.
Gradients: fill { colors: ["#ff7e5f", "#feb47b"], angle: 135 } (CSS angles: 180 = top→bottom, 90 = left→right). A legibility shade over a photo: rect fill { colors: ["#00000000", "#000000cc"], angle: 180 }.

## Pictures
image/video: fit "cover" (default) crops to the box, focus {x,y} keeps a subject in frame; mask "ellipse" for round photos; radius for rounded corners.
Filters (name): ${IMAGE_FILTERS.map((f) => f.name).join(', ')} (intensity 0..100). Adjust: brightness, contrast, saturation, temperature, tint, highlights, shadows, fade, vignette, blur, sharpen (-100..100).
Effects: shadow, glow, duotone {light, dark}, pixelate, outline.
Icons: search_stock kind icon/graphic/sticker → add_elements {type:"icon", icon:"ph:coffee-bold", color}.

## Text effects
shadow, lift, hollow, splice, outline, echo, glitch, neon, background (highlight box). Curved text: curve -100..100. Lists: list "bullet"/"number". Mixed styles: runs.

## Video & reels
- assemble_video does clips → pages, trims, transitions, music, captions and title/end cards in one call.
- Page = scene; page duration = seconds. Clips: trimStart/trimEnd in seconds of the file; loop; muted; volume.
- Animations (per element or whole page): rise, pan, fade, pop, wipe, typewriter, baseline, drift, tumble (+ direction).
- Transitions (into a page): dissolve, fade (through black), slide, wipe, zoom (+ direction, duration).
- Captions: add_captions with exact times or a transcript; they show only during their time (element timing).
- Music: set_audio with fadeIn/fadeOut; keep music around volume 0.6–0.8 under speech 0.3.
- Reels safe zone: keep text between 11% and 80% of the height.
- Preview moments with render_page { at: seconds }.

## Mockups
See a page on a product before it is printed: list_mockups (id, label, category Apparel/Outdoor/Print/Packaging/Devices/Home, aspect), then render_mockup { design_id, page, mockup_id, color?, format? }. The page is cover-fitted to the print area, so pick a mockup whose aspect is close to the page's (or keep important content away from the edges). Products marked with colours can be recoloured (#rrggbb). save: true puts the mockup image in Exports too.

## Exports
PNG/JPG per page, vector PDF (print), GIF (animated), MP4 (H.264/AAC). Files land in Google Drive "Digital Canvas/Exports" with a link.
`;
