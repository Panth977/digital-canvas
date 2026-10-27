#!/usr/bin/env node
// Published builds run the bundle; in the monorepo, `npm start -w @digital-canvas/mcp` runs the TypeScript directly.
import { main } from '../dist/cli.js';
main().catch((e) => {
  console.error('[digital-canvas]', e instanceof Error ? e.message : e);
  process.exit(1);
});
