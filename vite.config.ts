import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readdirSync, existsSync } from 'fs';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const root = new URL('.', import.meta.url).pathname;
const pagesDir = resolve(root, 'pages');

// pages/ 하위에서 index.html을 가진 폴더만 자동 탐색
const pageEntries = readdirSync(pagesDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .filter(entry => existsSync(resolve(pagesDir, entry.name, 'index.html')))
  .map(entry => entry.name);

const input: Record<string, string> = {
  main: resolve(root, 'index.html'),
};
for (const name of pageEntries) {
  input[name] = resolve(pagesDir, name, 'index.html');
}

// pages/*/assets/ 디렉토리를 dist/pages/*/assets/ 로 복사
const staticCopyTargets = pageEntries
  .filter(name => existsSync(resolve(pagesDir, name, 'assets')))
  .map(name => ({
    src: resolve(pagesDir, name, 'assets'),
    dest: `pages/${name}`,
  }));

export default defineConfig({
  plugins: [
    viteStaticCopy({ targets: staticCopyTargets }),
  ],
  build: {
    rollupOptions: { input },
  },
});
