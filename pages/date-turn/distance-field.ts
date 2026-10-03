/** Exact squared Euclidean distance transform, separable into rows and columns. */
function transformLine(input: Float64Array, output: Float64Array, count: number, sites: Int32Array, boundaries: Float64Array): void {
  let k = 0;
  sites[0] = 0;
  boundaries[0] = -Infinity;
  boundaries[1] = Infinity;
  for (let q = 1; q < count; q++) {
    let intersection = 0;
    do {
      const p = sites[k];
      intersection = ((input[q] + q * q) - (input[p] + p * p)) / (2 * (q - p));
      if (intersection > boundaries[k]) break;
      k--;
    } while (k >= 0);
    k++;
    sites[k] = q;
    boundaries[k] = intersection;
    boundaries[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < count; q++) {
    while (boundaries[k + 1] < q) k++;
    const delta = q - sites[k];
    output[q] = delta * delta + input[sites[k]];
  }
}

function distanceTo(mask: Uint8Array, width: number, height: number, inside: boolean): Float64Array {
  const distances = new Float64Array(width * height);
  const length = Math.max(width, height);
  const input = new Float64Array(length);
  const output = new Float64Array(length);
  const sites = new Int32Array(length);
  const boundaries = new Float64Array(length + 1);
  // A finite sentinel avoids Infinity - Infinity at rows without a feature.
  const far = width * width + height * height + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) input[x] = Boolean(mask[y * width + x]) === inside ? 0 : far;
    transformLine(input, output, width, sites, boundaries);
    for (let x = 0; x < width; x++) distances[y * width + x] = output[x];
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) input[y] = distances[y * width + x];
    transformLine(input, output, height, sites, boundaries);
    for (let y = 0; y < height; y++) distances[y * width + x] = output[y];
  }
  return distances;
}

export function signedDistance(mask: Uint8Array, width: number, height: number): Float32Array {
  if (mask.length !== width * height || width < 1 || height < 1) throw new Error('Invalid field dimensions');
  const toInside = distanceTo(mask, width, height, true);
  const toOutside = distanceTo(mask, width, height, false);
  return Float32Array.from(toInside, (value, index) => {
    const distance = Math.sqrt(value) - Math.sqrt(toOutside[index]);
    return Math.sign(distance) * Math.max(0, Math.abs(distance) - 0.5);
  });
}

/** RG stores the glyph distance; BA stores its filled housing distance. */
export function encodeDistance(distances: Float32Array, pixelSize: number, range: number, housing: Float32Array = distances): Uint8Array<ArrayBuffer> {
  if (housing.length !== distances.length) throw new Error('Distance field dimensions must match');
  const encoded = new Uint8Array(distances.length * 4);
  distances.forEach((distance, index) => {
    const value = Math.round(Math.max(0, Math.min(1, distance * pixelSize / (2 * range) + 0.5)) * 65535);
    const body = Math.round(Math.max(0, Math.min(1, housing[index] * pixelSize / (2 * range) + 0.5)) * 65535);
    encoded[index * 4] = value >>> 8;
    encoded[index * 4 + 1] = value & 255;
    encoded[index * 4 + 2] = body >>> 8;
    encoded[index * 4 + 3] = body & 255;
  });
  return encoded;
}
