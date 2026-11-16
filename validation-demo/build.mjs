// Builds validation-demo/neoleo-validation.html: one self-contained file, no network needed.
// Run from the repo root: node validation-demo/build.mjs
import { build } from 'vite';
import fs from 'node:fs';
const out = 'validation-demo/.build';
await build({ configFile: false, logLevel: 'warn', build: { outDir: out, emptyOutDir: true, minify: true,
  lib: { entry: 'validation-demo/main.ts', formats: ['iife'], name: 'neoleoValidation', fileName: () => 'bundle.js' } } });
const js = fs.readFileSync(`${out}/bundle.js`, 'utf8').replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync('validation-demo/page.html', 'utf8').replace('/*BUNDLE*/', () => js);
fs.writeFileSync('validation-demo/neoleo-validation.html', html);
fs.rmSync(out, { recursive: true });
console.log('validation-demo/neoleo-validation.html', (html.length / 1024).toFixed(0), 'KB');
