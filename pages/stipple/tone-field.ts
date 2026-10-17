/** Remove narrow dark ridges before converting a source image to ink density. */
function extremumPass(source: Float32Array, width: number, height: number, radius: number, horizontal: boolean, minimum: boolean) {
  const result = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = minimum ? Infinity : -Infinity;
      for (let offset = -radius; offset <= radius; offset++) {
        const px = horizontal ? Math.max(0, Math.min(width - 1, x + offset)) : x;
        const py = horizontal ? y : Math.max(0, Math.min(height - 1, y + offset));
        const sample = source[py * width + px];
        value = minimum ? Math.min(value, sample) : Math.max(value, sample);
      }
      result[y * width + x] = value;
    }
  }
  return result;
}

function boxPass(source: Float32Array, width: number, height: number, radius: number, horizontal: boolean) {
  const result = new Float32Array(source.length);
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const index = (line: number, position: number) => horizontal ? line * width + position : position * width + line;
  const clamp = (position: number) => Math.max(0, Math.min(length - 1, position));
  for (let line = 0; line < lines; line++) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset++) sum += source[index(line, clamp(offset))];
    for (let position = 0; position < length; position++) {
      result[index(line, position)] = sum / (radius * 2 + 1);
      sum += source[index(line, clamp(position + radius + 1))] - source[index(line, clamp(position - radius))];
    }
  }
  return result;
}

function diffuse(source: Float32Array, width: number, height: number, radius: number) {
  let result = source;
  // Three separable box convolutions approximate a Gaussian without a hard cutoff.
  for (let pass = 0; pass < 3; pass++) {
    result = boxPass(result, width, height, radius, true);
    result = boxPass(result, width, height, radius, false);
  }
  return result;
}

/** Input/output values are ink coverage, 0 = paper, 1 = black. Work at 600 × 750. */
export function softenInkField(darkness: Float32Array, width: number, height: number) {
  // A grayscale opening removes thin contour strokes while retaining wide shadow masses.
  let opened = extremumPass(darkness, width, height, 3, true, true);
  opened = extremumPass(opened, width, height, 3, false, true);
  opened = extremumPass(opened, width, height, 3, true, false);
  opened = extremumPass(opened, width, height, 3, false, false);
  const cleaned = Float32Array.from(darkness, (value, index) => value * 0.06 + Math.min(value, opened[index]) * 0.94);
  const form = diffuse(cleaned, width, height, 2);
  const feather = diffuse(cleaned, width, height, 6);
  return Float32Array.from(form, (value, index) => value * 0.72 + feather[index] * 0.28);
}
