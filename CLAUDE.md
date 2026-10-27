# Digital Canvas — notes for agents

Open-source Canva alternative. Built on TaskManager ticket **ORCH-27** (ORCH board); progress and decisions live there.

## Decisions (Panth, 2026-10-26)

- Renderer: **CanvasKit** (Skia WASM). UI: **Svelte 5** + Vite + TypeScript. Licence: **Apache-2.0**.
- One **`.dcanvas` file per project** (zip). Projects go in an app folder, so a new project never asks for a path.
- Drive access: **`drive.file`** scope only (app folder + Open with + Picker). No full-Drive scope.
- Backend: **IceBase in firebase mode** on Firebase project `digital-canvas-p977` (created 2026-10-26, Drive + Picker APIs enabled). Backend stores almost nothing: user, login count, Drive refresh token. Designs never touch it.
- Phase 1 = the page editor (M1–M6 in README). No sharing/invites in phase 1.
- Canva's AI tools are out of scope; our own AI comes later via the open scene format.

## Rules

- `packages/scene` stays pure (no DOM, no CanvasKit). Every document change is a pure function returning a new Doc.
- `packages/render` has no DOM; it must keep working in Node (unit tests render real PNGs).
- Editor changes go through `EditorState.commit()` so undo, redraw and autosave stay correct. Coalesce drags/sliders with a key, `seal()` on release.
- Before pushing: `npm run check && npm test && npm run e2e` all green.

## M2 notes (2026-10-26)

- OAuth web client `753251746130-766vmq…` (Google Auth Platform, testing mode, test user ppanth977@gmail.com). ID + secret in `.env.local` (gitignored); secret also in Secret Manager.
- Firestore `asia-south1`; functions `asia-south1`; Firebase Auth used only for custom tokens (`uid = google:<sub>`).
- `backend/scripts/deploy-functions.mjs` replaces `icebase deploy --only functions`: IceBase 0.4.7's buildFunctions reads `peerDependencies` the JSR npm build lacks. It also aliases `@panth977/icebase` → `@jsr/panth977__icebase` so the bundle holds one copy (two copies break `instanceof Firestore`).
- Dev-only globals: `window.__account`, `window.__library`, `window.__dc`.

## M6 notes (2026-10-27)

- Lines, tables and charts are drawn from `decompose()` pieces (`packages/scene/src/vector.ts`: SVG path strings + text boxes), so the renderer, SVG export and vector PDF share one layout. Add a new vector element the same way.
- Connector ends store `attach: { elementId, point }`; `EditorState.commit()` runs `followConnectors()` on every change.
- Vector PDF embeds whole font files: pdf-lib's `subset: true` drops glyphs of Inter. Text effects, curved text and gradients are drawn as an image of that element only.
- Openverse allows `page_size` ≤ 20 without a key; photos are searched with `license_type=commercial,modification`, and the credit is kept in the asset `name`.
