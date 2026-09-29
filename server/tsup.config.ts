import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // The shared workspace ships TypeScript source, so bundle it in.
  noExternal: ['@libraverse/shared'],
});
