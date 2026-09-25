import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

type RouteCondition = {
  type: string;
  value?: string;
};

type Route = {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: RouteCondition[];
};

const config = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
) as { redirects: Route[]; rewrites: Route[]; trailingSlash?: boolean };

const redirectsFromBrand = config.redirects.filter(route =>
  route.has?.some(condition =>
    condition.type === 'host' && condition.value === 'brand.jiiwon.com',
  ),
);

test('the legacy brand host permanently redirects to clean Studio URLs', () => {
  expect(redirectsFromBrand).toEqual(expect.arrayContaining([
    expect.objectContaining({
      source: '/pages/:path*/',
      destination: 'https://studio.jiiwon.com/:path*/',
      permanent: true,
    }),
    expect.objectContaining({
      source: '/pages/:path*',
      destination: 'https://studio.jiiwon.com/:path*',
      permanent: true,
    }),
    expect.objectContaining({
      source: '/:path*/',
      destination: 'https://studio.jiiwon.com/:path*/',
      permanent: true,
    }),
    expect.objectContaining({
      source: '/:path*',
      destination: 'https://studio.jiiwon.com/:path*',
      permanent: true,
    }),
  ]));
});

test('clean artwork and Cursor Cat variant URLs rewrite to their built pages', () => {
  expect(config.trailingSlash).toBe(true);
  expect(config.rewrites).toEqual(expect.arrayContaining([
    expect.objectContaining({
      source: '/rose-glass/',
      destination: '/pages/rose-glass/index.html',
    }),
    expect.objectContaining({
      source: '/rose-glass/:path*',
      destination: '/pages/rose-glass/:path*',
    }),
    expect.objectContaining({
      source: '/cursor-cat/:id([a-z0-9]{10})/',
      destination: '/pages/cursor-cat/index.html',
    }),
    expect.objectContaining({
      destination: '/pages/:artwork/index.html',
    }),
    expect.objectContaining({
      destination: '/pages/:artwork/:path*',
    }),
  ]));
});

test('the Studio index only publishes clean artwork links', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const hrefs = [...html.matchAll(/<a href="([^"]+)">/g)].map(([, href]) => href);
  expect(hrefs.length).toBeGreaterThan(0);
  expect(hrefs.every(href => !href.startsWith('/pages/'))).toBe(true);
  expect(hrefs).toContain('/rose-glass/');
});

test('published social metadata uses clean Studio URLs', () => {
  const pagesUrl = new URL('../pages/', import.meta.url);
  const pageNames = readdirSync(pagesUrl, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

  for (const pageName of pageNames) {
    const html = readFileSync(new URL(`../pages/${pageName}/index.html`, import.meta.url), 'utf8');
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];
    if (!canonical) continue;

    expect(canonical, pageName).toBe(`https://studio.jiiwon.com/${pageName}/`);
    expect(html, pageName).not.toContain('brand-artwork.vercel.app');
    expect(html, pageName).not.toContain('studio.jiiwon.com/pages/');
  }
});
