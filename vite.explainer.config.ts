import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname, 'explainer'),
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
    outDir: resolve(import.meta.dirname, 'dist-explainer'),
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'explainer/index.html'),
      output: { entryFileNames: 'explainer.js', inlineDynamicImports: true },
    },
  },
});