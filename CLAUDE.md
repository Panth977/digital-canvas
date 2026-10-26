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
