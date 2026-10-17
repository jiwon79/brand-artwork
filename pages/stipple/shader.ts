export const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const fragmentShader = /* glsl */ `
precision highp float;
uniform sampler2D uImage;
uniform sampler2D uMask;
uniform sampler2D uScreen;
uniform float uSize;
uniform float uDensity;
uniform vec2 uResolution;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float screenRank(vec2 position) {
  vec2 encoded = texture2D(uScreen, position / (256.0 * uSize * 0.44)).rg;
  return dot(encoded, vec2(65280.0, 255.0)) / 65535.0;
}
float inkAt(vec2 p, float tone) {
  float rank = screenRank(p);
  return smoothstep(rank - 0.035, rank + 0.035, tone);
}
void main() {
  vec2 p = vUv * vec2(1200.0, 1500.0);
  vec3 source = texture2D(uImage, vUv).rgb;
  float luminance = dot(source, vec3(0.2126, 0.7152, 0.0722));
  // The source is a contour-suppressed, softly feathered density field.
  // Leave paper between dots even in shadows instead of filling a black silhouette.
  float tone = clamp(pow(max(0.0, 1.0 - luminance), 1.02) * 0.64 * uDensity, 0.0, 0.92);
  // Integrate fine dots over the output pixel instead of letting subpixel
  // samples alias into coarse noise when the paper is displayed smaller.
  vec2 subpixel = vec2(1200.0, 1500.0) / uResolution * 0.25;
  float ink = (inkAt(p + subpixel, tone)
    + inkAt(p - subpixel, tone)
    + inkAt(p + vec2(subpixel.x, -subpixel.y), tone)
    + inkAt(p + vec2(-subpixel.x, subpixel.y), tone)) * 0.25;
  // A trace of ink spread softens dots while leaving almost all tone to coverage.
  ink = mix(tone, ink, 0.96);
  ink *= smoothstep(0.0, 0.012, tone);
  float reveal = texture2D(uMask, vUv).r;
  float visibleInk = ink * mix(0.045, 1.0, reveal);
  float grain = hash(floor(p * 1.7)) - 0.5;
  float fibers = hash(vec2(floor(p.x * 0.5), floor(p.y * 3.0))) - 0.5;
  vec3 paper = vec3(0.966, 0.953, 0.928) + grain * 0.012 + fibers * 0.006;
  gl_FragColor = vec4(mix(paper, vec3(0.09, 0.085, 0.075), visibleInk), 1.0);
}
`;
