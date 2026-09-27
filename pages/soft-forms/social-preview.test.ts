import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const pageUrl = 'https://studio.jiiwon.com/soft-forms/';
const meta = (name: string) => {
  const tags = [...html.matchAll(/<meta\s[^>]*>/g)]
    .map(([tag]) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)]
      .map(([, key, value]) => [key, value])))
    .filter(tag => (tag.property ?? tag.name) === name);
  expect(tags, `one static ${name} tag`).toHaveLength(1);
  return tags[0].content;
};

test('the bilingual title and new URL are available without JavaScript', () => {
  expect(html).toContain('<title>솜결 · Soft Forms</title>');
  expect(html).toContain(`<link rel="canonical" href="${pageUrl}"`);
  expect(meta('og:type')).toBe('website');
  expect(meta('og:url')).toBe(pageUrl);
  expect(meta('og:title')).toBe('솜결 · Soft Forms');
  expect(meta('twitter:title')).toBe(meta('og:title'));
  expect(meta('twitter:card')).toBe('summary_large_image');
  expect(meta('og:image')).toBe(`${pageUrl}assets/og-image.png`);
  expect(meta('twitter:image')).toBe(meta('og:image'));
  expect(meta('og:description')).toBe(meta('description'));
  expect(meta('twitter:description')).toBe(meta('description'));
  expect(meta('twitter:image:alt')).toBe(meta('og:image:alt'));
});

test('the artwork capture and final social card are actual 1200 by 630 PNG files', () => {
  for (const filename of ['og-artwork.png', 'og-image.png']) {
    const image = readFileSync(new URL(`./assets/${filename}`, import.meta.url));
    expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(image.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(image.subarray(-12).toString('hex')).toBe('0000000049454e44ae426082');
    expect(image.length).toBeLessThan(5_000_000);
  }
  expect(meta('og:image:type')).toBe('image/png');
  expect(meta('og:image:width')).toBe('1200');
  expect(meta('og:image:height')).toBe('630');
});
