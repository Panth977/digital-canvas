/**
 * QA cases for sharing, opening shared designs, Drive "Open with", import,
 * Present and Download. The one source for apps/web/public/qa/sharing.html
 * (`node tools/qa/build.mjs`) and the run report (`--results <playwright.json>`).
 *
 * `auto`: the Playwright test that covers it ({ file, test }; for e2e/qa-sharing.spec.ts
 * `test` is the case id, the title starts with it). `live`: only real Google
 * accounts can check it; `steps` are exact manual steps (Panth = owner, Harshil = recipient).
 */
const APP = 'https://digital-canvas-p977.web.app';
const qa = (id) => ({ file: 'e2e/qa-sharing.spec.ts', test: id });

export const AREAS = [
  ['share', 'Owner shares'],
  ['open', 'Recipient opens'],
  ['rights', 'What the recipient may do'],
  ['public', 'Public view, template, Present'],
  ['import', 'Import a .dcanvas'],
  ['openwith', 'Drive "Open with"'],
  ['download', 'Download formats'],
  ['live', 'Live checks with real Google accounts'],
];

export const CASES = [
  // ---- owner shares ----
  { id: 'QA-01', area: 'share', title: 'Share by email: Can edit', auto: { file: 'e2e/qa-sharing.spec.ts', test: 'QA-01', name: 'QA-01 owner shares by email (Can edit): Drive permission, the email carries the app link, assets readable by link' },
    steps: ['Open a design with a picture', 'Share › type harshil@… › Can edit › message "Have a look" › Send'],
    expected: 'Drive permission writer for Harshil. Drive’s email note starts "Open in Digital Canvas: ' + APP + '/d/<fileId>" then the message (preview shown before Send). "Shared with … Copy link / Send link" hint appears. The design’s pictures become "anyone with the link: reader". Harshil’s app still gets 404 for the file until he opens it with the app.' },
  { id: 'QA-02', area: 'share', title: 'Share by email: Can comment', auto: { file: 'e2e/qa-sharing.spec.ts', test: 'QA-02', name: 'QA-02 owner shares by email (Can comment): Drive permission, the email carries the app link, assets readable by link' },
    steps: ['As QA-01 with Can comment'], expected: 'Permission commenter; same email note and hint.' },
  { id: 'QA-03', area: 'share', title: 'Share by email: Can view', auto: { file: 'e2e/qa-sharing.spec.ts', test: 'QA-03', name: 'QA-03 owner shares by email (Can view): Drive permission, the email carries the app link, assets readable by link' },
    steps: ['As QA-01 with Can view'], expected: 'Permission reader; same email note and hint.' },
  { id: 'QA-04', area: 'share', title: 'Link access "Anyone with the link"', auto: qa('QA-04'),
    steps: ['Share › Link access › Anyone with the link (can view)', 'Someone not added opens /d/<fileId>, signs in, clicks Open, picks the file'],
    expected: 'type anyone, role reader, allowFileDiscovery false; pictures readable by link; the stranger sees the design view-only with its picture.' },
  { id: 'QA-04b', area: 'share', title: 'Roles, remove, link roles, Copy link, QR, Email (popover details)', auto: { file: 'e2e/share.spec.ts', test: 'people, roles, link access, assets published, links, QR, email' },
    steps: ['Add, change role, remove a person; link can view → can edit → only people added; Copy link; QR; Email'], expected: 'Drive permissions follow each change; links /d/, /view/, /template/ on ' + APP + '.' },

  // ---- recipient opens ----
  { id: 'QA-05', area: 'open', title: 'Recipient via the email link, signed in', auto: qa('QA-05'),
    steps: ['Harshil (signed in) opens ' + APP + '/d/<fileId>', 'Card "Shared with you" › Open', 'Google Picker shows only that file › Select'],
    expected: 'Before the Picker Drive answers 404 (drive.file). After it the editor opens the design, "Shared by Panth", pictures shown.' },
  { id: 'QA-06', area: 'open', title: 'Recipient via Home "Shared with you"', auto: qa('QA-06'),
    steps: ['After QA-05, go to Home', 'Section "Shared with you" lists "Launch poster · from Panth · Can edit"; click it', 'Fresh browser: "Open a shared design" › Picker (Shared with me, designs only) › pick'],
    expected: 'The listed design reopens. The Picker opens on "Shared with me" filtered to .dcanvas types; the picked design opens (view-only for a viewer).' },
  { id: 'QA-07', area: 'open', title: 'Recipient via Drive "Open with"', auto: qa('QA-07'),
    steps: ['In Drive: right-click the .dcanvas › Open with › Digital Canvas (app opens ' + APP + '/?state=…)'],
    expected: 'The design opens in the editor as Harshil’s shared design; the ?state= is removed from the address. If Drive sent it for another Google account than the one signed in: "Switch account" banner.' },
  { id: 'QA-08', area: 'open', title: 'Drive "New › Digital Canvas"', auto: qa('QA-08'),
    steps: ['In Drive: New › More › Digital Canvas'], expected: 'A new 1080×1080 design opens and is saved to the user’s Digital Canvas folder (not into the Drive folder New was used in).' },
  { id: 'QA-09', area: 'open', title: 'Recipient not signed in', auto: qa('QA-09'),
    steps: ['Signed out, open ' + APP + '/d/<fileId>', 'Sign in with Google'],
    expected: 'Card asks to sign in "with the Google account it was shared with" (and "View without signing in"). After sign-in the Picker opens by itself; picking the file opens it.' },
  { id: 'QA-26', area: 'open', title: 'Drive "Open with" while signed out', auto: { file: 'e2e/openwith.spec.ts', test: 'Drive "Open with" asks to sign in, keeps the request, cleans the URL' },
    steps: ['Signed out: Drive › Open with › Digital Canvas'], expected: '"Sign in with Google to open the file from Drive" banner with a Sign in button; the request survives the sign-in redirect.' },

  // ---- rights ----
  { id: 'QA-10', area: 'rights', title: 'Viewer: read-only', auto: qa('QA-10'),
    steps: ['Harshil opens a design shared "Can view"', 'Try to edit; File › Make a copy'],
    expected: 'View-only badge, no side panel; edits do nothing; owner’s file gets no new revision. Make a copy saves an editable copy (and its picture) into Harshil’s Drive.' },
  { id: 'QA-11', area: 'rights', title: 'Commenter', auto: qa('QA-11'),
    steps: ['Harshil opens a design shared "Can comment"'], expected: 'Opens view-only (the app has no comments yet).' },
  { id: 'QA-12', area: 'rights', title: 'Editor saves back', auto: qa('QA-12'),
    steps: ['Harshil opens a design shared "Can edit", adds a shape and a new picture'],
    expected: 'Saves go to Panth’s file (new revision); no request of Harshil’s touches Panth’s assets folder and no write is refused; the new picture lands in Harshil’s own assets and is made link-readable; Panth reopens and sees both pictures.' },
  { id: 'QA-13', area: 'rights', title: 'Remove access', auto: qa('QA-13'),
    steps: ['Panth: Share › Harshil › Remove access', 'Harshil opens the /d/ link again'], expected: 'Drive refuses; the card says to ask the owner to share it.' },

  // ---- public ----
  { id: 'QA-22', area: 'public', title: 'Public /view with link access on', auto: { file: 'e2e/share.spec.ts', test: 'public view: no sign-in, pages read with the API key, Make a copy asks to sign in' },
    steps: ['Link access Anyone with the link; open ' + APP + '/view/<fileId> signed out'], expected: 'Pages render read-only with pictures, no OAuth request, Download works.' },
  { id: 'QA-23', area: 'public', title: 'Public /view with link access off', auto: { file: 'e2e/share.spec.ts', test: 'public view: no sign-in, pages read with the API key, Make a copy asks to sign in' },
    steps: ['Only people added; open /view/<fileId> signed out'], expected: '"not shared publicly" message.' },
  { id: 'QA-24', area: 'public', title: 'Template link', auto: { file: 'e2e/share.spec.ts', test: 'template link: copies the design into your Drive and opens it' },
    steps: ['Open ' + APP + '/template/<fileId>'], expected: 'An own copy is made in your Drive and opens.' },
  { id: 'QA-25', area: 'public', title: 'Present', auto: { file: 'e2e/share.spec.ts', test: 'while shared, a new picture is made link-readable on save; Download and Present' },
    steps: ['Share › Present; arrows, Home, Esc'], expected: 'Full-screen pages, "n / N" counter, closes.' },

  // ---- import ----
  { id: 'QA-14', area: 'import', title: 'Import an app-downloaded file', auto: qa('QA-14'),
    steps: ['Panth: card ⋮ › Download (.dcanvas)', 'Harshil: Home › Open a .dcanvas file › choose it'], expected: 'Opens with its picture; saved into Harshil’s Drive with the picture in his assets.' },
  { id: 'QA-15', area: 'import', title: 'Import a Drive-downloaded file (links only)', auto: qa('QA-15'),
    steps: ['Download the .dcanvas straight from Drive (it has links.json, no pictures)', 'Home › Open a .dcanvas file › choose it'],
    expected: 'Progress card "Fetching pictures and fonts: n of N"; pictures fetched by Drive id; a self-contained copy with a NEW id saved in the importer’s Drive; owner’s file untouched; toast "Imported … with 1 picture from Google Drive".' },
  { id: 'QA-16', area: 'import', title: 'Import links-only, pictures not shared', auto: qa('QA-16'),
    steps: ['Import a Drive-downloaded file of a design that was never shared'], expected: 'Design opens; toast says N pictures could not be loaded and to ask the owner to share it.' },
  { id: 'QA-17', area: 'import', title: 'Import name clash', auto: qa('QA-17'),
    steps: ['Import your own design’s file again'], expected: 'A second design with a new id; the first is untouched; the picture is stored once.' },
  { id: 'QA-18', area: 'import', title: 'Import on a phone viewport', auto: qa('QA-18'),
    steps: ['Phone: Home › Open a .dcanvas file'], expected: 'File picker has no type filter (nothing greyed out); a .zip-named design imports; a photo is refused with a toast.' },
  { id: 'QA-19', area: 'import', title: 'Import a file that is not a design', auto: qa('QA-19'),
    steps: ['Choose a zip that is not a design; a saved Drive web page renamed .dcanvas'], expected: 'Error toast ("not a Digital Canvas design" / "web page, not a design"); nothing silent.' },
  { id: 'QA-20', area: 'import', title: 'Import from Google Drive (Picker)', auto: qa('QA-20'),
    steps: ['Home › From Drive › pick a .dcanvas'], expected: 'Picker on My Drive, .dcanvas types (also zip / octet-stream); the file is imported as an editable own copy.' },

  // ---- open with ----
  { id: 'QA-21', area: 'openwith', title: 'Existing accounts get asked for drive.install once', auto: qa('QA-21'),
    steps: ['Signed in with an account whose token lacks drive.install', 'Home banner › Not now; reload'], expected: 'Banner "Show in Drive" appears once; Not now hides it for good on this browser; a fresh sign-in (scope present) shows no banner.' },

  // ---- downloads (existing e2e) ----
  { id: 'QA-30', area: 'download', title: 'Download panel lists every type', auto: { file: 'e2e/download.spec.ts', test: "Download lists Canva's file types in order, plus PPTX and our .dcanvas" }, steps: ['Download'], expected: 'All file types in Canva’s order + PPTX + .dcanvas.' },
  { id: 'QA-31', area: 'download', title: 'PNG', auto: { file: 'e2e/editor.spec.ts', test: 'download PNG at 2x' }, steps: ['Download › PNG 2x'], expected: 'PNG at twice the size.' },
  { id: 'QA-32', area: 'download', title: 'JPG', auto: { file: 'e2e/editor.spec.ts', test: 'download JPG' }, steps: ['Download › JPG'], expected: 'A JPG.' },
  { id: 'QA-33', area: 'download', title: 'PDF Standard', auto: { file: 'e2e/editor.spec.ts', test: 'download PDF of all pages' }, steps: ['Download › PDF Standard'], expected: 'One PDF page per design page.' },
  { id: 'QA-34', area: 'download', title: 'PDF Print', auto: { file: 'e2e/download.spec.ts', test: 'PDF Print: crop marks and bleed, CMYK, notes; flattened pages as separate files' }, steps: ['Download › PDF Print'], expected: 'Crop marks, bleed, CMYK, notes.' },
  { id: 'QA-35', area: 'download', title: 'SVG and vector PDF', auto: { file: 'e2e/elements.spec.ts', test: 'download: SVG and vector PDF' }, steps: ['Download › SVG'], expected: 'Vector output.' },
  { id: 'QA-36', area: 'download', title: 'PPTX', auto: { file: 'e2e/download.spec.ts', test: 'PPTX: a slide per page with editable text, notes' }, steps: ['Download › PPTX'], expected: 'A slide per page.' },
  { id: 'QA-37', area: 'download', title: 'MP4', auto: { file: 'e2e/download.spec.ts', test: 'MP4: Canva quality (720p) and pages as separate files' }, steps: ['Download › MP4'], expected: '720p video.' },
  { id: 'QA-38', area: 'download', title: 'GIF', auto: { file: 'e2e/download.spec.ts', test: 'GIF: Canva size 0.4x with a transparent background' }, steps: ['Download › GIF'], expected: 'GIF 0.4×.' },
  { id: 'QA-39', area: 'download', title: 'MP3', auto: { file: 'e2e/download.spec.ts', test: "MP3: the design's sound only" }, steps: ['Download › MP3'], expected: 'The sound only.' },
  { id: 'QA-40', area: 'download', title: '.dcanvas', auto: { file: 'e2e/download.spec.ts', test: '.dcanvas: the design as our own file' }, steps: ['Download › .dcanvas'], expected: 'A self-contained .dcanvas.' },

  // ---- live only ----
  { id: 'QA-41', area: 'live', title: 'Real share email reaches Harshil with the app link', live: true,
    steps: ['Panth (deployed build): open a design with a picture › Share › harshil’s Gmail › Can edit › message "QA-41" › Send', 'Harshil: open the Google Drive email', 'Check the note starts "Open in Digital Canvas: ' + APP + '/d/…" and click that link (NOT Drive’s "Open" button)'],
    expected: 'App opens the "Shared with you" card for "<title> from Panth".' },
  { id: 'QA-42', area: 'live', title: 'Harshil signs in from the link and opens the design', live: true,
    steps: ['Continue from QA-41 signed out (or in a private window)', 'Sign in with Google: on Google’s screen TICK both boxes (Drive files used with this app; connect to Drive)', 'Picker opens showing only the design › Select'],
    expected: 'Editor opens, "Shared by Panth", pictures visible (needs the console step below). If the Drive box was left unticked: the app says to sign in again and tick it (no bare 403).' },
  { id: 'QA-43', area: 'live', title: 'Pictures of a shared design load for the recipient (API key)', live: true,
    steps: ['Cloud console › Credentials › key "Digital Canvas Picker (browser)" › API restrictions: add Google Drive API; referrers include https://digital-canvas-p977.web.app/*', 'Repeat QA-42'],
    expected: 'Panth’s pictures appear for Harshil. Without the console step they are blank placeholders (Drive answers 403 to the key).' },
  { id: 'QA-44', area: 'live', title: 'Harshil edits and Panth sees it', live: true,
    steps: ['Harshil (Can edit) adds a text "from Harshil" and a photo; wait for Saved', 'Panth reloads the design'], expected: 'Panth sees the text and Harshil’s photo.' },
  { id: 'QA-45', area: 'live', title: 'Home "Shared with you" and "Open a shared design"', live: true,
    steps: ['Harshil: Home shows the design under Shared with you; click it', 'Panth shares a second design; Harshil: Open a shared design › Shared with me › pick it'], expected: 'Both open.' },
  { id: 'QA-46', area: 'live', title: 'Drive lists Digital Canvas under "Open with"', live: true,
    steps: ['Harshil signs in to the deployed app once (new sign-in asks for "drive.install")', 'drive.google.com › Shared with me › right-click the .dcanvas › Open with'],
    expected: '"Digital Canvas" is listed; choosing it opens the design in the app (QA-07 live).' },
  { id: 'QA-47', area: 'live', title: 'Existing account consent for "Open with"', live: true,
    steps: ['Panth (already signed in before this release) opens Home', 'Banner "Show in Drive" › Google consent › Allow', 'drive.google.com › right-click a .dcanvas › Open with'],
    expected: 'Banner gone; Digital Canvas listed under Open with and New › More.' },
  { id: 'QA-48', area: 'live', title: 'Drive New › More › Digital Canvas', live: true,
    steps: ['drive.google.com › New › More › Digital Canvas'], expected: 'A new design opens in the app.' },
  { id: 'QA-49', area: 'live', title: 'Import on real phones', live: true,
    steps: ['Android Chrome and iPhone Safari: Drive app › the .dcanvas › Download', 'App Home › Open a .dcanvas file › Downloads › pick it'],
    expected: 'File is selectable (not greyed out); progress card; design opens with pictures (if shared) or with the warning toast.' },
  { id: 'QA-50', area: 'live', title: 'Public /view and /template in prod', live: true,
    steps: ['Panth: Link access Anyone with the link › Public view link', 'Open it in a private window (not signed in)', 'Open the Template link signed in as Harshil'],
    expected: 'View shows the pages with pictures; template makes Harshil’s own copy.' },
];
