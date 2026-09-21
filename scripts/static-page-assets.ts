import { resolve } from 'node:path';
import { normalizePath, type PluginOption } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

/** Keep runtime/OG URLs, but do not copy assets Vite already emitted with a hash. */
export function staticPageAssets(assetDirectories: string[]): PluginOption[] {
  const bundledSources = new Set<string>();
  let root = '';

  return [
    {
      name: 'collect-bundled-page-assets',
      apply: 'build',
      enforce: 'post',
      configResolved(config) {
        root = config.root;
      },
      buildStart() {
        bundledSources.clear();
      },
      generateBundle(_, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'asset') continue;
          for (const original of output.originalFileNames) {
            bundledSources.add(normalizePath(resolve(root, original)));
          }
        }
      },
    },
    viteStaticCopy({
      targets: assetDirectories.map(directory => ({
        src: `${normalizePath(directory)}/**/*`,
        dest: '.',
        transform: {
          encoding: 'buffer',
          handler(content, filename) {
            return bundledSources.has(normalizePath(filename)) ? null : content;
          },
        },
      })),
    }),
  ];
}
