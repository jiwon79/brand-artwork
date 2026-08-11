import * as THREE from 'three';
import {
  ART_HEIGHT,
  ART_WIDTH,
  FIRST_LINE_Y,
  GLYPH_ATLAS_CELL_SIZE,
  GLYPH_ATLAS_COLUMNS,
  GLYPH_ATLAS_ROWS,
  GLYPH_SLOT_COUNT,
  LINE_HEIGHT,
  MAX_GLYPH_HALF_WIDTH,
  TEXT_FONT,
  TEXT_LETTER_SPACING,
  TEXT_LINES,
  TEXTURE_SCALE,
} from './config';

type GlyphInkStats = {
  centroidOffsetX: number;
  centroidOffsetY: number;
  width: number;
  height: number;
  halfWidthFromCellCenter: number;
};

type GlyphLayout = {
  character: string;
  centerX: number;
  centerY: number;
};

type LineLayout = {
  glyphs: GlyphLayout[];
  firstCenterX: number;
  averageCenterAdvance: number;
};

export type TextAtlas = {
  glyphTextAtlasCanvas: HTMLCanvasElement;
  glyphSpringCells: THREE.Vector4[];
  lineLayouts: THREE.Vector4[];
  glyphHomeData: Float32Array<ArrayBuffer>;
  glyphMetadataData: Uint8Array<ArrayBuffer>;
};

/**
 * 폰트의 실제 advance와 글자쌍 kerning을 사용해 한 줄의 중심 좌표를 만든다.
 * TEXT_LETTER_SPACING은 자연 배치가 끝난 뒤 이 작품이 추가하는 tracking이다.
 */
function measureLineLayout(
  context: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
): LineLayout {
  const measuredWidths = Array.from(text, character => (
    context.measureText(character).width
  ));
  const localCenters: number[] = [];
  let cursorX = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (index > 0) {
      const previousCharacter = text[index - 1];
      const character = text[index];
      const pairWidth = context.measureText(previousCharacter + character).width;
      const pairKerning = pairWidth
        - measuredWidths[index - 1]
        - measuredWidths[index];
      cursorX += pairKerning + TEXT_LETTER_SPACING;
    }

    localCenters.push(cursorX + measuredWidths[index] * 0.5);
    cursorX += measuredWidths[index];
  }

  const lineStartX = centerX - cursorX * 0.5;
  const glyphs = Array.from(text, (character, index) => ({
    character,
    centerX: lineStartX + localCenters[index],
    centerY,
  }));
  const firstCenterX = glyphs[0]?.centerX ?? centerX;
  const lastCenterX = glyphs[glyphs.length - 1]?.centerX ?? centerX;

  return {
    glyphs,
    firstCenterX,
    averageCenterAdvance: glyphs.length > 1
      ? (lastCenterX - firstCenterX) / (glyphs.length - 1)
      : 1,
  };
}

function measureGlyphInk(
  image: ImageData,
  slot: number,
): GlyphInkStats {
  const column = slot % GLYPH_ATLAS_COLUMNS;
  const row = Math.floor(slot / GLYPH_ATLAS_COLUMNS);
  const cellSize = GLYPH_ATLAS_CELL_SIZE * TEXTURE_SCALE;
  const cellStartX = column * cellSize;
  const cellStartY = row * cellSize;
  const cellCenterX = cellStartX + cellSize * 0.5;
  const cellCenterY = cellStartY + cellSize * 0.5;
  let inkMass = 0;
  let weightedX = 0;
  let weightedY = 0;
  let minInkX = cellStartX + cellSize;
  let maxInkX = cellStartX;
  let minInkY = cellStartY + cellSize;
  let maxInkY = cellStartY;

  for (let pixelY = cellStartY; pixelY < cellStartY + cellSize; pixelY += 1) {
    for (let pixelX = cellStartX; pixelX < cellStartX + cellSize; pixelX += 1) {
      const alpha = image.data[(pixelY * image.width + pixelX) * 4 + 3] / 255;
      if (alpha < 0.01) continue;
      inkMass += alpha;
      weightedX += pixelX * alpha;
      weightedY += pixelY * alpha;
      if (alpha > 0.08) {
        minInkX = Math.min(minInkX, pixelX);
        maxInkX = Math.max(maxInkX, pixelX);
        minInkY = Math.min(minInkY, pixelY);
        maxInkY = Math.max(maxInkY, pixelY);
      }
    }
  }

  const safeMass = Math.max(inkMass, 0.001);
  return {
    centroidOffsetX: (weightedX / safeMass - cellCenterX) / TEXTURE_SCALE,
    centroidOffsetY: (weightedY / safeMass - cellCenterY) / TEXTURE_SCALE,
    width: Math.max((maxInkX - minInkX + 1) / TEXTURE_SCALE, 1),
    height: Math.max((maxInkY - minInkY + 1) / TEXTURE_SCALE, 1),
    halfWidthFromCellCenter: Math.max(
      cellCenterX - minInkX,
      maxInkX - cellCenterX,
      1,
    ) / TEXTURE_SCALE,
  };
}

/**
 * 자연 자간 위치와 글자별 atlas를 준비한다.
 *
 * Canvas 측정값은 각 글자의 원래 위치를 알려주고, 독립 atlas는 글자마다
 * 다른 spring 위치와 회전으로 다시 그릴 수 있게 한다.
 */
export function createTextAtlas(): TextAtlas {
  const glyphTextAtlasCanvas = document.createElement('canvas');
  glyphTextAtlasCanvas.width = (
    GLYPH_ATLAS_COLUMNS * GLYPH_ATLAS_CELL_SIZE * TEXTURE_SCALE
  );
  glyphTextAtlasCanvas.height = (
    GLYPH_ATLAS_ROWS * GLYPH_ATLAS_CELL_SIZE * TEXTURE_SCALE
  );
  const glyphTextAtlasContext = glyphTextAtlasCanvas.getContext('2d', { alpha: true });
  if (!glyphTextAtlasContext) throw new Error('Unable to create the glyph atlas.');

  glyphTextAtlasContext.setTransform(TEXTURE_SCALE, 0, 0, TEXTURE_SCALE, 0, 0);
  glyphTextAtlasContext.save();
  glyphTextAtlasContext.fillStyle = '#ffffff';
  glyphTextAtlasContext.font = TEXT_FONT;
  glyphTextAtlasContext.textAlign = 'center';
  glyphTextAtlasContext.textBaseline = 'middle';
  let glyphSlot = 0;
  for (const line of TEXT_LINES) {
    for (const character of line) {
      if (character !== ' ') {
        const column = glyphSlot % GLYPH_ATLAS_COLUMNS;
        const row = Math.floor(glyphSlot / GLYPH_ATLAS_COLUMNS);
        const cellCenterX = (column + 0.5) * GLYPH_ATLAS_CELL_SIZE;
        const cellCenterY = (row + 0.5) * GLYPH_ATLAS_CELL_SIZE;
        glyphTextAtlasContext.fillText(character, cellCenterX, cellCenterY);
      }
      glyphSlot += 1;
    }
  }
  glyphTextAtlasContext.restore();

  glyphTextAtlasContext.save();
  glyphTextAtlasContext.font = TEXT_FONT;
  const lineLayoutData = TEXT_LINES.map((line, lineIndex) => measureLineLayout(
    glyphTextAtlasContext,
    line,
    ART_WIDTH * 0.5,
    FIRST_LINE_Y + lineIndex * LINE_HEIGHT,
  ));
  glyphTextAtlasContext.restore();
  const glyphAtlasImage = glyphTextAtlasContext.getImageData(
    0,
    0,
    glyphTextAtlasCanvas.width,
    glyphTextAtlasCanvas.height,
  );
  const glyphSpringCells: THREE.Vector4[] = [];
  const lineLayouts: THREE.Vector4[] = [];
  const glyphHomeData = new Float32Array(GLYPH_SLOT_COUNT * 4);
  const glyphMetadataData = new Uint8Array(GLYPH_SLOT_COUNT * 4);
  let glyphSlotOffset = 0;
  lineLayoutData.forEach((lineLayout) => {
    lineLayouts.push(new THREE.Vector4(
      lineLayout.firstCenterX,
      lineLayout.averageCenterAdvance,
      lineLayout.glyphs.length,
      glyphSlotOffset,
    ));

    lineLayout.glyphs.forEach((glyph, characterIndex) => {
      const glyphSlotIndex = glyphSlotOffset + characterIndex;
      const centerUvX = glyph.centerX / ART_WIDTH;
      const centerUvY = 1 - glyph.centerY / ART_HEIGHT;
      glyphHomeData[glyphSlotIndex * 4] = centerUvX;
      glyphHomeData[glyphSlotIndex * 4 + 1] = centerUvY;

      if (glyph.character === ' ') {
        glyphSpringCells.push(new THREE.Vector4(
          centerUvX,
          centerUvY,
          0,
          0,
        ));
        return;
      }

      const stats = measureGlyphInk(glyphAtlasImage, glyphSlotIndex);
      glyphSpringCells.push(new THREE.Vector4(
        (glyph.centerX + stats.centroidOffsetX) / ART_WIDTH,
        1 - (glyph.centerY + stats.centroidOffsetY) / ART_HEIGHT,
        stats.width * 0.5 / ART_WIDTH,
        stats.height * 0.5 / ART_HEIGHT,
      ));

      const measuredHalfWidth = stats.halfWidthFromCellCenter + 1.5;
      glyphMetadataData[glyphSlotIndex * 4] = Math.round(
        THREE.MathUtils.clamp(
          measuredHalfWidth / MAX_GLYPH_HALF_WIDTH,
          0,
          1,
        ) * 255,
      );
      glyphMetadataData[glyphSlotIndex * 4 + 1] = 255;
    });
    glyphSlotOffset += lineLayout.glyphs.length;
  });

  return {
    glyphTextAtlasCanvas,
    glyphSpringCells,
    lineLayouts,
    glyphHomeData,
    glyphMetadataData,
  };
}
