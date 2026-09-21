import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readdirSync, existsSync } from 'fs';
import { staticPageAssets } from './scripts/static-page-assets';

const root = new URL('.', import.meta.url).pathname;
const pagesDir = resolve(root, 'pages');
const cursorCatVariantRoute = /^\/pages\/cursor-cat\/[a-z0-9]{10}\/?(?:\?.*)?$/;
const cleanCursorCatVariantRoute = /^\/cursor-cat\/[a-z0-9]{10}\/?(?:\?.*)?$/;
const retiredCursorCatRoute = /^\/pages\/cursor-cat-circle(?:\/|\?|$)/;
const artworkRouteAliases = new Map([
  ['rose-glass', 'apple-glass-wallpaper'],
]);

type MiddlewareResponse = {
  statusCode: number;
  end(body?: string): void;
};

function artworkRouteFallback(pageNames: readonly string[]) {
  const knownPages = new Set(pageNames);
  const rewrite = (
    request: { url?: string },
    response: MiddlewareResponse,
    next: () => void,
  ) => {
    if (request.url && retiredCursorCatRoute.test(request.url)) {
      response.statusCode = 404;
      response.end('Not Found');
      return;
    }
    if (request.url && (cursorCatVariantRoute.test(request.url) || cleanCursorCatVariantRoute.test(request.url))) {
      request.url = '/pages/cursor-cat/index.html';
    } else if (request.url) {
      const url = new URL(request.url, 'http://localhost');
      const [artwork] = url.pathname.split('/').filter(Boolean);
      const pageName = artworkRouteAliases.get(artwork) ?? artwork;
      if (knownPages.has(pageName) && !url.pathname.startsWith('/pages/')) {
        const suffix = url.pathname.slice(`/${artwork}`.length);
        request.url = `/pages/${pageName}${suffix}${url.search}`;
      }
    }
    next();
  };

  return {
    name: 'artwork-route-fallback',
    configureServer(server: { middlewares: { use: (handler: typeof rewrite) => void } }) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server: { middlewares: { use: (handler: typeof rewrite) => void } }) {
      server.middlewares.use(rewrite);
    },
  };
}

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

// 런타임 문자열/OG 경로에 필요한 파일만 원래 경로로 복사한다.
// Vite가 번들에 포함한 파일은 JS에서도 new URL(..., import.meta.url)로 참조한다.
const assetDirectories = pageEntries
  .filter(name => existsSync(resolve(pagesDir, name, 'assets')))
  .map(name => resolve(pagesDir, name, 'assets'));

export default defineConfig({
  server: {
    allowedHosts: [
      '.ngrok-free.app',
      '.ts.net',
    ],
  },
  plugins: [
    artworkRouteFallback(pageEntries),
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
    staticPageAssets(assetDirectories),
  ],
  build: {
    rollupOptions: { input },
  },
});
