import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const pageUrl = 'https://brand-artwork.vercel.app/pages/line-pull/';
const meta = name => {
  const tags = [...html.matchAll(/<meta\s[^>]*>/g)]
    .map(([tag]) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)]
      .map(([, key, value]) => [key, value])))
    .filter(tag => (tag.property ?? tag.name) === name);
  expect(tags, `one static ${name} tag`).toHaveLength(1);
  return tags[0].content;
};

test('social crawlers can read the canonical artwork and image URLs without JavaScript', () => {
  expect(html).toContain(`<link rel="canonical" href="${pageUrl}">`);
  expect(meta('og:type')).toBe('website');
  expect(meta('og:url')).toBe(pageUrl);
  expect(meta('og:title')).toBe('Line Pull');
  expect(meta('twitter:title')).toBe(meta('og:title'));
  expect(meta('twitter:card')).toBe('summary_large_image');
  expect(meta('og:image')).toBe(`${pageUrl}assets/og-image.jpg`);
  expect(meta('twitter:image')).toBe(meta('og:image'));
});

test('share descriptions and accessible image text remain consistent', () => {
  expect(meta('description')).toContain('가로줄');
  expect(meta('og:description')).toBe(meta('description'));
  expect(meta('twitter:description')).toBe(meta('description'));
  expect(meta('og:image:alt')).toContain('안녕하세요');
  expect(meta('twitter:image:alt')).toBe(meta('og:image:alt'));
});

test('the bundled JPEG matches the declared 1200 by 630 card dimensions', () => {
  const image = readFileSync(new URL('./assets/og-image.jpg', import.meta.url));
  expect(image.readUInt16BE(0)).toBe(0xffd8);
  expect(image.readUInt16BE(image.length - 2)).toBe(0xffd9);
  expect(image.length).toBeLessThan(1_000_000);
  expect(meta('og:image:type')).toBe('image/jpeg');
  let dimensions;
  for (let offset = 2; offset + 9 < image.length;) {
    expect(image[offset]).toBe(0xff);
    const marker = image[offset + 1];
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      dimensions = [image.readUInt16BE(offset + 7), image.readUInt16BE(offset + 5)];
      break;
    }
    if (marker === 0xda || marker === 0xd9) break;
    offset += 2 + image.readUInt16BE(offset + 2);
  }
  expect(dimensions).toEqual([1200, 630]);
  expect([Number(meta('og:image:width')), Number(meta('og:image:height'))]).toEqual(dimensions);
});
