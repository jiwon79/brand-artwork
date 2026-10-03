export type LetterSample = { luminance: number; face: number };

/** A filled J used only as a luminance mask. The visible letter is composed
 * entirely of real dice, never a text overlay. */
function insideJ(x: number, y: number) {
  const top = x >= -0.3 && x <= 0.3 && y >= 0.36 && y <= 0.5;
  const stem = x >= 0.14 && x <= 0.3 && y >= -0.19 && y <= 0.5;
  const radius = Math.hypot(x, y + 0.19);
  const hook = y <= -0.19 && radius >= 0.14 && radius <= 0.3;
  const terminal = x >= -0.3 && x <= -0.14 && y >= -0.19 && y <= -0.08;
  return top || stem || hook || terminal;
}

export function sampleLetter(x: number, y: number, width: number, height: number): LetterSample {
  const size = Math.min(height * 0.76, width * 1.32);
  const samples = 16;
  let covered = 0;
  // Area sampling keeps the hook and stroke boundaries legible in a coarse grid.
  for (let row = 0; row < samples; row++) {
    for (let column = 0; column < samples; column++) {
      const sx = x + ((column + 0.5) / samples - 0.5) * 0.78;
      const sy = y + ((row + 0.5) / samples - 0.5) * 0.78;
      if (insideJ(sx / size, sy / size)) covered++;
    }
  }
  const luminance = covered / (samples * samples);
  return { luminance, face: 1 + Math.round(luminance * 5) };
}
