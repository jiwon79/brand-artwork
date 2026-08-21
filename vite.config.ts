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
// 참고: vite-plugin-static-copy는 매칭된 파일의 프로젝트 루트 기준 상대 경로를
// dest에 그대로 덧붙이므로 (src가 pages/<name>/assets 이면 이미 해당 경로가
// 결과에 포함됨) dest는 '.' 로 두어 중복 중첩을 방지한다.
const staticCopyTargets = pageEntries
  .filter(name => existsSync(resolve(pagesDir, name, 'assets')))
  .map(name => ({
    src: resolve(pagesDir, name, 'assets'),
    dest: '.',
  }));

export default defineConfig({
  server: {
    allowedHosts: [
      '.ngrok-free.app',
      'trading-history-mcp-dev.tail069b1f.ts.net',
    ],
  },
  plugins: [
    {
      name: 'inject-site-favicon',
      transformIndexHtml() {
        return [{
          tag: 'link',
          attrs: {
            rel: 'icon',
            type: 'image/svg+xml',
            href: '/favicon.svg',
          },
          injectTo: 'head',
        }];
      },
    },
    viteStaticCopy({ targets: staticCopyTargets }),
  ],
  build: {
    rollupOptions: { input },
  },
});
