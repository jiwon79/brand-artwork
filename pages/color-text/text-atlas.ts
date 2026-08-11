import * as THREE from 'three';
import {
  ART_HEIGHT,
  ART_WIDTH,
  CHARACTER_ADVANCE,
  FIRST_LINE_Y,
  GLYPH_ATLAS_CELL_SIZE,
  GLYPH_ATLAS_COLUMNS,
  GLYPH_ATLAS_ROWS,
  GLYPH_SLOT_COUNT,
  LINE_HEIGHT,
  MAX_GLYPH_HALF_WIDTH,
  TEXT_FONT,
  TEXT_LINES,
  TEXTURE_SCALE,
  type ColorTextParameters,
} from './config';

type GlyphCenterStats = {
  centerX: number;
  centerY: number;
  centroidX: number;
  centroidY: number;
  inkMass: number;
  width: number;
  height: number;
};

type ColorCenterShape = {
  offsetX: number;
  offsetY: number;
  radiusX: number;
  radiusY: number;
  opacity: number;
};

export type TextAtlas = {
  glyphTextAtlasCanvas: HTMLCanvasElement;
  glyphColorAtlasCanvas: HTMLCanvasElement;
  glyphSpringCells: THREE.Vector4[];
  lineLayouts: THREE.Vector4[];
  glyphMetadataData: Uint8Array<ArrayBuffer>;
  rebakeColorAtlas: () => void;
};

function drawTrackedLine(
  context: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  advance: number,
): void {
  const startX = centerX - ((text.length - 1) * advance) / 2;
  for (let index = 0; index < text.length; index += 1) {
    context.fillText(text[index], startX + index * advance, centerY);
  }
}

function drawColorCenter(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  opacity: number,
): void {
  context.save();
  context.translate(centerX, centerY);
  context.scale(radiusX, radiusY);
  context.globalAlpha = opacity;
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.42, 'rgba(255, 255, 255, 0.96)');
  gradient.addColorStop(0.74, 'rgba(255, 255, 255, 0.52)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, 1, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function getColorCenterShape(
  stats: GlyphCenterStats,
  minMass: number,
  maxMass: number,
  parameters: ColorTextParameters,
): ColorCenterShape {
  const massRatio = (stats.inkMass - minMass) / Math.max(maxMass - minMass, 0.001);
  const widthRatio = THREE.MathUtils.clamp((stats.width - 4) / 27, 0, 1);
  const heightRatio = THREE.MathUtils.clamp((stats.height - 18) / 20, 0, 1);
  const widthSignal = massRatio * 0.35 + widthRatio * 0.65;
  const heightSignal = massRatio * 0.5 + heightRatio * 0.5;
  const variation = parameters.colorCenterVariation;
  const centroidMix = variation * 0.35;
  return {
    offsetX: (stats.centroidX - stats.centerX) * centroidMix,
    offsetY: (stats.centroidY - stats.centerY) * centroidMix,
    radiusX: parameters.colorCenterRadiusX * THREE.MathUtils.lerp(
      1,
      0.32 + widthSignal * 1.35,
      variation,
    ),
    radiusY: parameters.colorCenterRadiusY * THREE.MathUtils.lerp(
      1,
      0.42 + heightSignal * 1.3,
      variation,
    ),
    opacity: THREE.MathUtils.lerp(1, 0.45 + massRatio * 0.55, variation),
  };
}

/**
 * 문장 전체 mask와 글자별 atlas를 준비한다.
 *
 * 전체 mask는 원래 글자 위치를 알려주고, 독립 atlas는 각 글자를 다른
 * spring 위치와 회전으로 다시 그릴 수 있게 한다.
 */
export function createTextAtlas(parameters: ColorTextParameters): TextAtlas {
  const textCanvas = document.createElement('canvas');
  textCanvas.width = ART_WIDTH * TEXTURE_SCALE;
  textCanvas.height = ART_HEIGHT * TEXTURE_SCALE;
  const textContext = textCanvas.getContext('2d', { alpha: true });
  if (!textContext) throw new Error('Unable to create the text mask.');

  const glyphTextAtlasCanvas = document.createElement('canvas');
  glyphTextAtlasCanvas.width = (
    GLYPH_ATLAS_COLUMNS * GLYPH_ATLAS_CELL_SIZE * TEXTURE_SCALE
  );
  glyphTextAtlasCanvas.height = (
    GLYPH_ATLAS_ROWS * GLYPH_ATLAS_CELL_SIZE * TEXTURE_SCALE
  );
  const glyphTextAtlasContext = glyphTextAtlasCanvas.getContext('2d', { alpha: true });
  if (!glyphTextAtlasContext) throw new Error('Unable to create the glyph atlas.');

  const glyphColorAtlasCanvas = document.createElement('canvas');
  glyphColorAtlasCanvas.width = glyphTextAtlasCanvas.width;
  glyphColorAtlasCanvas.height = glyphTextAtlasCanvas.height;
  const glyphColorAtlasContext = glyphColorAtlasCanvas.getContext('2d', { alpha: true });
  if (!glyphColorAtlasContext) throw new Error('Unable to create the glyph color atlas.');

  textContext.setTransform(TEXTURE_SCALE, 0, 0, TEXTURE_SCALE, 0, 0);
  textContext.clearRect(0, 0, ART_WIDTH, ART_HEIGHT);
  textContext.save();
  textContext.fillStyle = '#ffffff';
  textContext.font = TEXT_FONT;
  textContext.textAlign = 'center';
  textContext.textBaseline = 'middle';
  TEXT_LINES.forEach((line, index) => {
    drawTrackedLine(
      textContext,
      line,
      ART_WIDTH / 2,
      FIRST_LINE_Y + index * LINE_HEIGHT,
      CHARACTER_ADVANCE,
    );
  });
  textContext.restore();

  const image = textContext.getImageData(0, 0, textCanvas.width, textCanvas.height);
  const glyphCenterStats: GlyphCenterStats[] = [];
  TEXT_LINES.forEach((line, lineIndex) => {
    const startX = ART_WIDTH / 2 - ((line.length - 1) * CHARACTER_ADVANCE) / 2;
    for (let characterIndex = 0; characterIndex < line.length; characterIndex += 1) {
      if (line[characterIndex] === ' ') continue;
      const centerX = startX + characterIndex * CHARACTER_ADVANCE;
      const centerY = FIRST_LINE_Y + lineIndex * LINE_HEIGHT;
      const minCellX = Math.max(
        0,
        Math.floor((centerX - CHARACTER_ADVANCE / 2) * TEXTURE_SCALE),
      );
      const maxCellX = Math.min(
        textCanvas.width - 1,
        Math.ceil((centerX + CHARACTER_ADVANCE / 2) * TEXTURE_SCALE),
      );
      const minCellY = Math.max(
        0,
        Math.floor((centerY - LINE_HEIGHT / 2) * TEXTURE_SCALE),
      );
      const maxCellY = Math.min(
        textCanvas.height - 1,
        Math.ceil((centerY + LINE_HEIGHT / 2) * TEXTURE_SCALE),
      );
      let inkMass = 0;
      let weightedX = 0;
      let weightedY = 0;
      let minInkX = maxCellX;
      let maxInkX = minCellX;
      let minInkY = maxCellY;
      let maxInkY = minCellY;

      for (let pixelY = minCellY; pixelY <= maxCellY; pixelY += 1) {
        for (let pixelX = minCellX; pixelX <= maxCellX; pixelX += 1) {
          const alpha = image.data[(pixelY * textCanvas.width + pixelX) * 4 + 3] / 255;
          if (alpha < 0.01) continue;
          inkMass += alpha;
          weightedX += (pixelX / TEXTURE_SCALE) * alpha;
          weightedY += (pixelY / TEXTURE_SCALE) * alpha;
          if (alpha > 0.08) {
            minInkX = Math.min(minInkX, pixelX);
            maxInkX = Math.max(maxInkX, pixelX);
            minInkY = Math.min(minInkY, pixelY);
            maxInkY = Math.max(maxInkY, pixelY);
          }
        }
      }

      const safeMass = Math.max(inkMass, 0.001);
      glyphCenterStats.push({
        centerX,
        centerY,
        centroidX: weightedX / safeMass,
        centroidY: weightedY / safeMass,
        inkMass: inkMass / (TEXTURE_SCALE * TEXTURE_SCALE),
        width: Math.max((maxInkX - minInkX + 1) / TEXTURE_SCALE, 1),
        height: Math.max((maxInkY - minInkY + 1) / TEXTURE_SCALE, 1),
      });
    }
  });

  const rebakeColorAtlas = (): void => {
    glyphTextAtlasContext.setTransform(1, 0, 0, 1, 0, 0);
    glyphTextAtlasContext.clearRect(
      0,
      0,
      glyphTextAtlasCanvas.width,
      glyphTextAtlasCanvas.height,
    );
    glyphColorAtlasContext.setTransform(1, 0, 0, 1, 0, 0);
    glyphColorAtlasContext.clearRect(
      0,
      0,
      glyphColorAtlasCanvas.width,
      glyphColorAtlasCanvas.height,
    );
    glyphTextAtlasContext.setTransform(TEXTURE_SCALE, 0, 0, TEXTURE_SCALE, 0, 0);
    glyphColorAtlasContext.setTransform(TEXTURE_SCALE, 0, 0, TEXTURE_SCALE, 0, 0);

    const masses = glyphCenterStats.map((stats) => stats.inkMass);
    const minMass = Math.min(...masses);
    const maxMass = Math.max(...masses);

    glyphTextAtlasContext.save();
    glyphTextAtlasContext.fillStyle = '#ffffff';
    glyphTextAtlasContext.font = TEXT_FONT;
    glyphTextAtlasContext.textAlign = 'center';
    glyphTextAtlasContext.textBaseline = 'middle';

    let glyphSlot = 0;
    let statsIndex = 0;
    for (const line of TEXT_LINES) {
      for (const character of line) {
        if (character !== ' ') {
          const column = glyphSlot % GLYPH_ATLAS_COLUMNS;
          const row = Math.floor(glyphSlot / GLYPH_ATLAS_COLUMNS);
          const cellCenterX = (column + 0.5) * GLYPH_ATLAS_CELL_SIZE;
          const cellCenterY = (row + 0.5) * GLYPH_ATLAS_CELL_SIZE;
          glyphTextAtlasContext.fillText(character, cellCenterX, cellCenterY);

          const shape = getColorCenterShape(
            glyphCenterStats[statsIndex],
            minMass,
            maxMass,
            parameters,
          );
          drawColorCenter(
            glyphColorAtlasContext,
            cellCenterX + shape.offsetX,
            cellCenterY + shape.offsetY,
            shape.radiusX,
            shape.radiusY,
            shape.opacity,
          );
          statsIndex += 1;
        }
        glyphSlot += 1;
      }
    }
    glyphTextAtlasContext.restore();
  };
  rebakeColorAtlas();

  const glyphSpringCells: THREE.Vector4[] = [];
  const lineLayouts: THREE.Vector4[] = [];
  let measuredGlyphIndex = 0;
  let glyphSlotOffset = 0;
  TEXT_LINES.forEach((line, lineIndex) => {
    const startX = ART_WIDTH / 2 - ((line.length - 1) * CHARACTER_ADVANCE) / 2;
    const centerY = FIRST_LINE_Y + lineIndex * LINE_HEIGHT;
    lineLayouts.push(new THREE.Vector4(
      startX,
      1 - centerY / ART_HEIGHT,
      line.length,
      glyphSlotOffset,
    ));

    for (let characterIndex = 0; characterIndex < line.length; characterIndex += 1) {
      const centerX = startX + characterIndex * CHARACTER_ADVANCE;
      if (line[characterIndex] === ' ') {
        glyphSpringCells.push(new THREE.Vector4(
          centerX / ART_WIDTH,
          1 - centerY / ART_HEIGHT,
          0,
          0,
        ));
        continue;
      }
      const stats = glyphCenterStats[measuredGlyphIndex];
      measuredGlyphIndex += 1;
      glyphSpringCells.push(new THREE.Vector4(
        stats.centroidX / ART_WIDTH,
        1 - stats.centroidY / ART_HEIGHT,
        stats.width * 0.5 / ART_WIDTH,
        stats.height * 0.5 / ART_HEIGHT,
      ));
    }
    glyphSlotOffset += line.length;
  });

  // R은 실제 글자 반폭, G는 글자가 있는 slot인지 저장한다. 변형 pass는
  // tracking cell 밖으로 이동한 넓은 글자도 이 정보로 계속 찾을 수 있다.
  const glyphMetadataData = new Uint8Array(GLYPH_SLOT_COUNT * 4);
  let glyphMetadataSlot = 0;
  textContext.save();
  textContext.font = TEXT_FONT;
  for (const line of TEXT_LINES) {
    for (const character of line) {
      if (character !== ' ') {
        const metrics = textContext.measureText(character);
        const measuredHalfWidth = Math.max(
          metrics.actualBoundingBoxLeft || metrics.width * 0.5,
          metrics.actualBoundingBoxRight || metrics.width * 0.5,
          CHARACTER_ADVANCE * 0.5,
        ) + 1.5;
        glyphMetadataData[glyphMetadataSlot * 4] = Math.round(
          THREE.MathUtils.clamp(
            measuredHalfWidth / MAX_GLYPH_HALF_WIDTH,
            0,
            1,
          ) * 255,
        );
        glyphMetadataData[glyphMetadataSlot * 4 + 1] = 255;
      }
      glyphMetadataSlot += 1;
    }
  }
  textContext.restore();

  return {
    glyphTextAtlasCanvas,
    glyphColorAtlasCanvas,
    glyphSpringCells,
    lineLayouts,
    glyphMetadataData,
    rebakeColorAtlas,
  };
}
