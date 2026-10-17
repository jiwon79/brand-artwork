export const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const fragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uImage;
uniform sampler2D uMask;
uniform float uSize;
uniform float uDensity;
uniform vec2 uResolution;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 paperSize = vec2(1200.0, 1500.0);
  vec2 p = vUv * paperSize;
  float cellSize = 2.8;
  vec2 cell = floor(p / cellSize);
  float ink = 0.0;
  float aa = max(paperSize.x / uResolution.x, 0.45) * 0.65;
  // Check neighbors so jittered dots are never clipped at cell boundaries.
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 c = cell + vec2(float(x), float(y));
      vec2 center = (c + vec2(hash(c), hash(c + 93.7))) * cellSize;
      vec3 rgb = texture2D(uImage, center / paperSize).rgb;
      float luminance = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
      float dark = pow(clamp((1.0 - luminance) * 1.05, 0.0, 1.0), 1.25);
      float exists = step(0.002, dark) * step(hash(c + 271.3), min(dark * uDensity, 0.98));
      float radius = uSize * mix(0.62, 1.18, hash(c + 17.1)) * mix(0.55, 1.15, dark);
      float dotInk = (1.0 - smoothstep(max(0.0, radius - aa), radius + aa, distance(p, center))) * exists;
      ink = max(ink, dotInk * mix(0.55, 0.94, hash(c + 52.0)));
    }
  }
  float reveal = texture2D(uMask, vUv).r;
  // A faint underdrawing helps locate the subject on untouched paper.
  float visibleInk = ink * mix(0.065, 1.0, reveal);
  float grain = hash(floor(p * 1.7)) - 0.5;
  float fibers = hash(vec2(floor(p.x * 0.5), floor(p.y * 3.0))) - 0.5;
  vec3 paper = vec3(0.966, 0.953, 0.918) + grain * 0.025 + fibers * 0.012;
  vec3 color = mix(paper, vec3(0.11, 0.105, 0.09), visibleInk);
  gl_FragColor = vec4(color, 1.0);
}
`;
