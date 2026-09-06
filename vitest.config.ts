import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests do not need the artwork server routes or asset-copy build plugins.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['{common,pages,scripts}/**/*.{test,spec}.{js,mjs,ts}'],
    exclude: [...configDefaults.exclude, '**/qa/**', '**/.qa/**'],
  },
});
