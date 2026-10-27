import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  optimizeDeps: { include: ['canvaskit-wasm/bin/full/canvaskit.js'] },
  server: { port: Number(process.env.DC_PORT ?? 5181), strictPort: true },
  preview: { port: 5181, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
