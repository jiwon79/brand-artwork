import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'vite';
import { expect, test } from 'vitest';
import { staticPageAssets } from './static-page-assets';

test('a production build emits bundled assets once and preserves runtime and social URLs', async () => {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'brand-assets-')));
  const assets = resolve(root, 'pages/demo/assets');
  mkdirSync(resolve(assets, 'nested'), { recursive: true });
  const video = Buffer.from([0, 255, 128, 64, 1, 2, 3]);
  writeFileSync(resolve(assets, 'video.mp4'), video);
  // Identical bytes at an unrelated runtime URL must not be removed by a hash comparison.
  writeFileSync(resolve(assets, 'nested/runtime.mp4'), video);
  writeFileSync(resolve(assets, 'og-image.png'), 'social image');
  writeFileSync(resolve(assets, 'songs.json'), '{"src":"assets/nested/runtime.mp4"}');
  writeFileSync(resolve(assets, 'texture.png'), 'texture');
  writeFileSync(resolve(root, 'pages/demo/index.html'), `
    <meta property="og:image" content="https://example.com/pages/demo/assets/og-image.png">
    <video src="./assets/video.mp4"></video>
    <script type="module" src="./script.js"></script>
  `);
  writeFileSync(resolve(root, 'pages/demo/script.js'), `
    import './style.css';
    document.querySelector('video').src = new URL('./assets/video.mp4', import.meta.url).href;
    fetch('assets/songs.json');
  `);
  writeFileSync(resolve(root, 'pages/demo/style.css'), 'body { background: url(./assets/texture.png) }');

  try {
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: staticPageAssets([assets]),
      build: {
        assetsInlineLimit: 0,
        rollupOptions: { input: resolve(root, 'pages/demo/index.html') },
      },
    });
    const dist = resolve(root, 'dist');
    const bundled = readdirSync(resolve(dist, 'assets'));
    const videos = bundled.filter(name => name.endsWith('.mp4'));
    expect(videos).toHaveLength(1);
    expect(readFileSync(resolve(dist, 'assets', videos[0]))).toEqual(video);
    expect(readdirSync(resolve(dist, 'pages/demo/assets')).sort()).toEqual([
      'nested', 'og-image.png', 'songs.json',
    ]);
    expect(readFileSync(resolve(dist, 'pages/demo/assets/nested/runtime.mp4'))).toEqual(video);
    expect(readFileSync(resolve(dist, 'pages/demo/assets/og-image.png'), 'utf8')).toBe('social image');
    expect(readFileSync(resolve(dist, 'pages/demo/assets/songs.json'), 'utf8')).toContain('assets/nested/runtime.mp4');
    expect(readFileSync(resolve(dist, 'pages/demo/index.html'), 'utf8')).toContain(`/assets/${videos[0]}`);
    const js = bundled.filter(name => name.endsWith('.js'))
      .map(name => readFileSync(resolve(dist, 'assets', name), 'utf8')).join('\n');
    expect(js).toContain(`/assets/${videos[0]}`);
    const css = bundled.find(name => name.endsWith('.css'))!;
    const texture = bundled.find(name => name.endsWith('.png'))!;
    expect(readFileSync(resolve(dist, 'assets', css), 'utf8')).toContain(`/assets/${texture}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
