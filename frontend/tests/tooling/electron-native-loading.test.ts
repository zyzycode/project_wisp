import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'vite';

const { outputDirectory } = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { outputDirectory: mkdtempSync(join(tmpdir(), 'wisp-worker-bundle-')) };
});
vi.mock('vite-plugin-electron/simple', async (importOriginal) => {
  const { default: electron } = await importOriginal<typeof import('vite-plugin-electron/simple')>();
  return {
    default: (options: Parameters<typeof electron>[0]) => electron({
      ...options,
      main: {
        ...options.main,
        entry: { 'memory-worker': 'src/infrastructure/memory/worker.ts' },
        vite: {
          ...options.main.vite,
          logLevel: 'silent',
          build: { ...options.main.vite?.build, outDir: outputDirectory, minify: false },
        },
      },
      preload: undefined,
    }),
  };
});

import config from '../../vite.config';

afterAll(() => rmSync(outputDirectory, { recursive: true, force: true }));

describe('Electron native dependency loading', () => {
  it('keeps better-sqlite3 external through the simple plugin and worker bundle', async () => {
    const plugins = await config.plugins?.[1];
    if (!Array.isArray(plugins)) throw new Error('Expected Electron plugins');
    const plugin: Plugin | undefined = plugins.find((entry): entry is Plugin =>
      !!entry && typeof entry === 'object' && 'name' in entry && entry.name === 'vite-plugin-electron:prod');
    if (!plugin || typeof plugin.config !== 'function' || typeof plugin.closeBundle !== 'function') {
      throw new Error('Expected Electron build hooks');
    }
    await Reflect.apply(plugin.config, {}, [config, { command: 'build', mode: 'development' }]);
    await Reflect.apply(plugin.closeBundle, {}, []);
    const bundle = readdirSync(outputDirectory).filter(name => name.endsWith('.js'))
      .map(name => readFileSync(join(outputDirectory, name), 'utf8')).join('\n');
    expect(/require\(["'`]better-sqlite3["'`]\)/.test(bundle)).toBe(true);
    expect(bundle.includes('Could not locate the bindings file')).toBe(false);
  });
});
