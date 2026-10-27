// Entry for `tsx src/main.ts` (development) and the bundle's cli.
import { main } from './cli.ts';
main().catch((e) => {
  console.error('[digital-canvas]', e instanceof Error ? e.message : e);
  process.exit(1);
});
