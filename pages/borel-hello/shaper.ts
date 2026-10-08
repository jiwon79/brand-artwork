import { FONT_FAMILY } from './renderer';
import type { FontCatalog, ShapedGlyph, TextShaper } from './lettering';

export async function loadBorel(): Promise<{ shaper: TextShaper; catalog: FontCatalog }> {
  const [hb, response, catalogResponse] = await Promise.all([
    import('harfbuzzjs'),
    fetch(new URL('./assets/Borel-Regular.ttf', import.meta.url)),
    fetch(new URL('./assets/font-catalog.json', import.meta.url)),
  ]);
  if (!response.ok || !catalogResponse.ok) throw new Error('Borel 자료를 불러오지 못했습니다.');
  const bytes = await response.arrayBuffer();
  const browserFont = await new FontFace(FONT_FAMILY, bytes).load();
  document.fonts.add(browserFont);
  const font = new hb.Font(new hb.Face(new hb.Blob(bytes)));
  const catalog = await catalogResponse.json() as FontCatalog;
  const buffer = new hb.Buffer();
  const cache = new Map<string, ShapedGlyph[]>();
  const shaper: TextShaper = {
    shape(text) {
      const cached = cache.get(text);
      if (cached) return cached;
      buffer.reset();
      buffer.addText(text);
      buffer.guessSegmentProperties();
      hb.shape(font, buffer);
      const positions = buffer.getGlyphPositions();
      let x = 0, y = 0;
      const result = buffer.getGlyphInfos().map((info, i) => {
        const position = positions[i];
        const glyph = { id: info.codepoint, x: x + position.xOffset, y: y + position.yOffset, advance: position.xAdvance, outline: font.glyphToPath(info.codepoint) };
        x += position.xAdvance; y += position.yAdvance;
        return glyph;
      });
      if (cache.size > 256) cache.clear();
      cache.set(text, result);
      return result;
    },
  };
  return { shaper, catalog };
}
