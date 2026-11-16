import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Content hash of the catalog, appended to its URL so a refreshed snapshot is never served from a stale cache.
const catalogVersion = createHash('sha1').update(readFileSync('public/data/catalog.json')).digest('hex').slice(0, 10);

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    'import.meta.env.VITE_CATALOG_VERSION': JSON.stringify(catalogVersion),
    // Build stamp shown in Settings and after a hard reload, to check a device runs the latest build.
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 2500 },
});
