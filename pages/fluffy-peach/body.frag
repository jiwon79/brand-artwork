varying vec3 vLocal;
varying vec3 vNormal;
uniform float uCheek;

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1., 0., 0.)), f.x), mix(hash(i + vec3(0., 1., 0.)), hash(i + vec3(1., 1., 0.)), f.x), f.y),
    mix(mix(hash(i + vec3(0., 0., 1.)), hash(i + vec3(1., 0., 1.)), f.x), mix(hash(i + vec3(0., 1., 1.)), hash(i + vec3(1., 1., 1.)), f.x), f.y), f.z);
}
void main() {
  vec3 normal = normalize(vNormal);
  vec3 color = peachColor(vLocal.xy, uCheek);
  color *= 0.98 + 0.02 * dot(normal, normalize(vec3(-0.35, 0.60, 0.72)));
  color += (noise(vLocal * 0.16) - 0.5) * 0.014;
  float alpha = smoothstep(0.0, 0.23, abs(normal.z));
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), alpha);
}
