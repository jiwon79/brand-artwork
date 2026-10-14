import { Marked } from 'marked';

export const sourcePath = '/docs/artworks/soft-forms/architecture.md';
const repository = 'https://github.com/jiwon79/studio/blob/main';

/** Resolve links from the Markdown's location, not the viewer's current URL. */
export function documentLink(href: string): string {
  if (href.startsWith('#') || /^(https?:|mailto:)/.test(href)) return href;
  const resolved = new URL(href, `https://studio.jiiwon.com${sourcePath}`);
  if (resolved.pathname === '/docs/artworks/soft-forms/index.html') return './';
  return `${repository}${resolved.pathname}${resolved.search}${resolved.hash}`;
}

export function renderMarkdown(source: string, images: Record<string, string>): string {
  const parser = new Marked({
    async: false,
    gfm: true,
    walkTokens(token) {
      if (token.type === 'link') token.href = documentLink(token.href);
      if (token.type === 'image') {
        const path = new URL(token.href, `https://studio.jiiwon.com${sourcePath}`).pathname;
        token.href = images[path] ?? documentLink(token.href);
      }
    },
  });
  // Only bundled, repository-authored Markdown enters this renderer.
  return parser.parse(source) as string;
}
