precision highp float;

uniform vec2 uResolution;
uniform float uFrame;
uniform float uTime;
uniform vec2 uBody;
uniform sampler2D uMotionAtlas;
uniform sampler2D uAppearanceAtlas;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

vec2 atlasUv(float frame, vec2 p) {
  float column = mod(frame, 11.0);
  float row = floor(frame / 11.0);
  vec2 frameUv = clamp(p / 720.0, vec2(0.5 / 360.0), vec2(1.0 - 0.5 / 360.0));
  return vec2((column + frameUv.x) / 11.0, 1.0 - (row + frameUv.y) / 11.0);
}

vec2 appearanceUv(float frame, vec2 p) {
  float column = mod(frame, 11.0);
  float row = floor(frame / 11.0);
  vec2 framePixel = clamp(p / 720.0, 0.0, 1.0) * 360.0;
  return vec2((column * 368.0 + 4.0 + framePixel.x) / 4048.0,
              1.0 - (row * 368.0 + 4.0 + framePixel.y) / 4048.0);
}

void main() {
  float unit = min(uResolution.x, uResolution.y) / 720.0;
  vec2 p = vec2(
    (gl_FragCoord.x - uResolution.x * 0.5) / unit + 360.0,
    (uResolution.y * 0.5 - gl_FragCoord.y) / unit + 360.0
  );
  vec2 mask = vec2(0.0);
  float first = floor(uFrame);
  float second = mod(first + 1.0, 120.0);
  float fraction = fract(uFrame);
  vec2 recordedP = clamp(p, vec2(0.0), vec2(720.0));
  vec3 recorded = mix(
    texture2D(uAppearanceAtlas, appearanceUv(first, recordedP)).rgb,
    texture2D(uAppearanceAtlas, appearanceUv(second, recordedP)).rgb,
    fraction
  );
  if (p.x >= 0.0 && p.x <= 720.0 && p.y >= 0.0 && p.y <= 720.0) {
    vec2 uvFirst = atlasUv(first, p);
    vec2 uvSecond = atlasUv(second, p);
    mask = mix(texture2D(uMotionAtlas, uvFirst).rg, texture2D(uMotionAtlas, uvSecond).rg, fraction);
  }

  vec2 local = p - uBody;
  // Add fine, directional hairs to the source-derived color frames.
  float core = smoothstep(0.095, 0.78, mask.r);
  float halo = smoothstep(0.035, 0.68, mask.g);
  float angle = atan(local.y, local.x);
  float filaments = pow(max(0.0, sin(angle * 347.0 + sin(angle * 39.0) * 2.4)), 16.0);
  float fiberNoise = noise(p * 0.58 + vec2(uTime * 0.15, 0.0));
  float fringe = max(0.0, halo - core);
  float upper = 1.0 - smoothstep(-20.0, 100.0, local.y);
  float clusters = smoothstep(0.28, 0.70, noise(vec2(angle * 17.0, uFrame * 0.018)));
  float hair = fringe * (filaments * clusters * (0.08 + upper * 0.56) + fiberNoise * 0.02);
  vec3 hairColor = mix(vec3(0.87, 0.72, 0.93), vec3(1.0, 0.87, 0.87), upper);
  vec3 color = mix(recorded, hairColor, clamp(hair, 0.0, 0.30));
  gl_FragColor = vec4(color, 1.0);
}
