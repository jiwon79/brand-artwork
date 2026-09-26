precision highp float;
uniform float uLayer;
varying vec3 vFurColor;
varying vec3 vFurSample;
varying float vSilhouette;

float furHash(vec3 point) {
  return fract(sin(dot(point, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float furNoise(vec3 point) {
  vec3 cell = floor(point);
  vec3 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(mix(furHash(cell), furHash(cell + vec3(1., 0., 0.)), local.x),
        mix(furHash(cell + vec3(0., 1., 0.)), furHash(cell + vec3(1., 1., 0.)), local.x), local.y),
    mix(mix(furHash(cell + vec3(0., 0., 1.)), furHash(cell + vec3(1., 0., 1.)), local.x),
        mix(furHash(cell + vec3(0., 1., 1.)), furHash(cell + vec3(1., 1., 1.)), local.x), local.y), local.z);
}

void main() {
  vec3 samplePoint = vFurSample * 0.23 + vec3(uLayer * 7.3, uLayer * 11.9, uLayer * 17.1);
  float broad = furNoise(samplePoint);
  float fine = furNoise(samplePoint * 2.7 + 19.7);
  float noiseCoverage = smoothstep(0.27 + 0.16 * uLayer, 0.78, mix(broad, fine, 0.48));
  float core = 1.0 - smoothstep(0.0, 0.48, uLayer);
  float coverage = mix(noiseCoverage, 0.72 + 0.28 * broad, core);
  float falloff = pow(1.0 - uLayer, 1.45);
  float rim = pow(vSilhouette, 1.35);
  float alpha = (0.055 + 0.17 * rim) * falloff * coverage;
  vec3 color = mix(vFurColor, vec3(0.98, 0.87, 0.94), 0.14 * uLayer);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), alpha);
}
