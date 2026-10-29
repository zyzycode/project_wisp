import { defineConfig } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'vite-plugin-electron/simple';
import react from '@vitejs/plugin-react';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: { index: 'src/main/index.ts', 'memory-worker': 'src/infrastructure/memory/worker.ts', 'voice-worker': 'src/infrastructure/voice/worker.ts' },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rolldownOptions: {
              external: ['electron', 'better-sqlite3', '@huggingface/transformers', /^node:/],
            },
          },
        },
      },
      preload: {
        input: 'src/preload/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    }),
    {
      name: 'wisp-bundled-voice-model',
      async configResolved() {
        await promisify(execFile)(process.execPath, [path.join(configDirectory, 'scripts', 'prepare-voice-model.mjs')]);
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(configDirectory, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
