import { gzipSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { generateDensity, bakeShadow, encodeVolume, DEFAULT_SEED } from '../pages/clouds/volume.ts';
const directory = new URL('../pages/clouds/assets/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const formation of ['cumulus', 'tower', 'bank']) {
  const start = performance.now(), density = generateDensity(formation, DEFAULT_SEED);
  const shadow = bakeShadow(density);
  const compressed = gzipSync(new Uint8Array(encodeVolume(density, shadow, DEFAULT_SEED)), { level: 9 });
  await writeFile(new URL(`${formation}.cloud`, directory), compressed);
  console.log(`${formation}: ${compressed.length} compressed bytes, ${Math.round(performance.now() - start)} ms`);
}
