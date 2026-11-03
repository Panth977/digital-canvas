/** The design guide served as a resource and quoted by the prompts. */
import { DUOTONES, FILTER_GROUPS, IMAGE_FILTERS } from '@digital-canvas/scene';
import { HTML_GUIDE } from './tools/html.ts';
import { SCRIPT_GUIDE } from './tools/script.ts';

/** The two rules that save the most tokens and guesswork; first in the server instructions. */
export const EFFICIENT = `Work efficiently (this matters more than anything below):
- Lay pages out with set_page_html: write the page as HTML + CSS (flexbox, grid, padding, gap, font sizes) and the engine places and measures everything with the real fonts. Do not compute x/y/w/h by hand for rows, columns, cards, lists or menus. get_page_html gives the page back as HTML; edit the CSS (e.g. a bigger font-size on one class) and send it again: everything reflows and keeps its ids.
- More than ~3 tool calls for one job? Write ONE run_script instead: a short JavaScript program that calls the tools (await dc.update_elements({...}) in a loop, dc.render_page, checks) and returns a small summary. It saves each design once (much faster) and keeps your context free of tool chatter. Never send dozens of separate add_elements / update_elements calls.
- Ask for little back: open_design with pages, get_page_html with element_id, render_page only when you need to look.`;

export const WORKFLOW = `1. Understand the brief: format (post, story, reel, poster, thumbnail…), message, audience, brand.
2. A PDF to edit? import_pdf (URL or Drive file) makes it a design with real text, shapes and images; untouched content exports the same as the source. Gather material first: list_assets / search_drive (the user's own photos and clips are best), get_brand_kit, search_stock for anything missing. Import what you'll use.
3. Pick a starting point: list_templates (pass design_id or a preset to rank by fit) or a blank create_design with the right preset.
4. Compose the page as HTML/CSS with set_page_html (layout, text sizes and pictures in one call; set_page background_media for full-bleed video). Use add_elements for a few one-off extras; batch anything bigger in run_script.
5. LOOK at it: render_page (show_ids: true to point at elements). Judge hierarchy, balance, spacing, legibility.
6. Critique: check_design. Fix every error and warning (edit the HTML, or update_elements in one run_script), re-render.
7. Export: export_image / export_pdf / export_video (check the reel with render_page at a few times first). Share the link and open_in_editor for hand edits.`;

export const GUIDE = `# Digital Canvas — design guide for agents

## Workflow
${WORKFLOW}

${HTML_GUIDE}

${SCRIPT_GUIDE}

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
Filters (name, intensity 0..100): ${FILTER_GROUPS.map((g) => `${g}: ${IMAGE_FILTERS.filter((f) => f.group === g).map((f) => f.name).join(', ')}`).join(' · ')}.
Adjust (-100..100; blur, sharpen, fade, grain 0..100): temperature, tint · brightness, contrast, highlights, shadows, whites, blacks · vibrance, saturation · texture, clarity, sharpen, fade, grain, vignette, blur.
colorEdit: per band (red, orange, yellow, green, aqua, blue, purple, magenta) { hue, saturation, lightness }. invert: true for a negative.
These three can be combined: shadow { style glow|drop|angle|curved|lift|backdrop|outline, size, blur, angle, distance, transparency, color } · duotone { preset, or dark + light, intensity } (presets: ${DUOTONES.map((d) => d.id).join(', ')}) · stylize { type pixelate|halftone|posterize|glitch|screen|sketch, amount }.
Also: retouch 0..100 smooths skin; border { color, width, dash }; straighten -45..45 and tiltX/tiltY -100..100 inside the box; blend multiply|screen|overlay|darken|lighten|color-dodge|color-burn|hard-light|soft-light|difference|exclusion|hue|saturation|color|luminosity on any element. Older effect { type shadow|glow|duotone|pixelate|outline } still works.
Background removal, Magic tools, selective edits and Auto Focus run in the editor (open_in_editor); they need the on-device models. Designs that already use them render the same here.
Icons: search_stock kind icon/graphic/sticker → add_elements {type:"icon", icon:"ph:coffee-bold", color}.

## Text effects
shadow, lift, hollow, splice, outline, echo, glitch, neon, background (highlight box). Curved text: curve -100..100. Lists: list "bullet"/"number". Mixed styles: runs.

## Video & reels
- assemble_video does clips → pages, trims, transitions, music, captions and title/end cards in one call.
- Page = scene; page duration = seconds. Clips: trimStart/trimEnd in seconds of the file; speed 0.25 to 2 (the sound keeps its pitch; a 10 s clip at 2 lasts 5 s); loop; muted; volume.
- Animations (per element, or a whole page): list_animations gives every type with its options. Sets:
  - Basic: rise, pan, fade, pop, wipe, drift, tumble, baseline, stomp, block, breathe, scale, slide, fadeSlide.
  - Exaggerate: neon, scrapbook, tectonic, jelly, bounceIn, backIn, flyIn, flipX, flipY, lightSpeed, spinIn, rollIn, jack, zoomIn, slideIn, puff, vanish, boing, twister, foolish, swash, space, tin, swap; exits hinge, magic, hole, bomb.
  - Photo motion (photos and videos; the frame stays, the picture moves): photoZoomIn, photoZoomOut, photoPan, kenBurns, photoRise, photoFlow, photoTumble.
  - Text (give by: "letter", "word" or "line"): typewriter, ascend, shift, merge, block, burst, bounce, roll, skate, spread, clarify, tectonic, tumble, neon, scrapbook, stomp, rise, pan, fade, pop, baseline, drift.
  - Writing: typewriter, write, marker.
  - Ambient (loops while shown; duration = one turn): pulse, wiggle, flicker, rotate, float, sway, breatheLoop, heartBeat, flash, rubberBand, shake, tremble, headShake, swing, tada, wobble, jello, hop.
  - Options: duration, direction, phase "in" | "out" | "both", intensity 0..1 (0.5 = as designed), by, order "forward" | "reverse" | "center" | "random" | "together". On a page, by: "page" moves everything as one.
  - Custom: {type:"custom", duration, path:{points:[[0,0,0],[300,-80,0.5],[600,0,1]], style, rotation, fade}}; the element follows the path and stays at its end.
  - Exits need a page duration: out plays over the last seconds of the page or of the element's timing window.
- Transitions (into a page; 0.1 to 2.5 s; apply them to every page but the first): dissolve, fade (through black), slide, wipe, zoom, match (Match & Move: elements with the same name, picture or text travel between the pages), circle, line, stack, chop, flow, colorwipe (+ color), iris, clock, doors, checker. Most take a direction.
- Captions: add_captions with exact times or a transcript; they show only during their time (element timing).
- Subtitles and voice-over: set_subtitles with a script or timed lines (captions show as editable text; style bar, clean, outline, yellow, loud or top), then generate_speech to voice them with Kokoro-82M on the user's device (device or desktop mode only; in cloud mode it says so, and set_subtitles still works). Only changed lines regenerate; it stops after about 30 s and returns remaining, so call it again. Hindi text gets a Hindi voice by itself. fit "stretch" grows lines and scenes to hold the speech, "speed" speeds it up; duck 0.25 lowers music under speech. export_video has burn_subtitles.
- Music: set_audio with fadeIn/fadeOut; keep music around volume 0.6–0.8 under speech 0.3.
- Reels safe zone: keep text between 11% and 80% of the height.
- Preview moments with render_page { at: seconds }.
- find_replace changes text across all pages in one call.

## Mockups
See a page on a product before it is printed: list_mockups (id, label, category Apparel/Outdoor/Print/Packaging/Devices/Home, aspect), then render_mockup { design_id, page, mockup_id, color?, format? }. The page is cover-fitted to the print area, so pick a mockup whose aspect is close to the page's (or keep important content away from the edges). Products marked with colours can be recoloured (#rrggbb). save: true puts the mockup image in Exports too.

## Exports
PNG/JPG per page, vector PDF (print), GIF (animated), MP4 (H.264/AAC). Files land in Google Drive "Digital Canvas/Exports" with a link.
`;
