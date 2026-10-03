precision highp float;
varying vec2 vUv;
uniform sampler2D face0;
uniform sampler2D face1;
uniform sampler2D face2;
uniform mat3 inverseRotation;
uniform vec2 viewSize;
uniform float objectScale;
uniform float bounce;
uniform float apothem;
uniform float padding;
uniform float fieldSpan;
uniform vec3 numberColor;
uniform vec3 sideColor;
uniform vec3 inkInset;

const float ROOT3 = 1.73205080757;

float smoothUnion(float a, float b, float radius) {
  float blend = max(radius - abs(a - b), 0.0) / radius;
  return min(a, b) - blend * blend * radius * 0.25;
}

vec2 field(sampler2D source, vec2 point) {
  vec2 uv = point / fieldSpan + 0.5;
  vec2 outside = max(abs(point) - fieldSpan * 0.5, 0.0);
  vec4 encoded = texture2D(source, clamp(uv, 0.0, 1.0));
  vec2 distance = ((encoded.rb * 65280.0 + encoded.ga * 255.0) / 65535.0 - 0.5) * 2.0 * fieldSpan;
  return distance + length(outside);
}

void numeralFields(vec3 p, out vec3 glyph, out vec3 body) {
  vec2 a = field(face0, p.xy);
  vec2 b = field(face1, vec2(p.x, -0.5 * p.y - 0.8660254 * p.z));
  vec2 c = field(face2, vec2(p.x, -0.5 * p.y + 0.8660254 * p.z));
  glyph = vec3(a.x, b.x, c.x);
  body = vec3(a.y, b.y, c.y);
}

float radiusAt(float x) {
  // Rounded numeral lobes soften the housing while keeping a single 3D volume.
  float local = min(abs(x - 0.64), abs(x + 0.64)) / 0.86;
  float radius = apothem * sqrt(max(0.0, 1.0 - local * local));
  float bridge = 0.53 * (1.0 - smoothstep(0.32, 0.46, abs(x)));
  return bridge > 0.0 ? -smoothUnion(-radius, -bridge, 0.05) : radius;
}

vec3 planes(vec3 p) {
  return vec3(p.z, 0.8660254 * p.y - 0.5 * p.z, -0.8660254 * p.y - 0.5 * p.z) - apothem;
}

float volume(vec3 p) {
  vec3 glyph, bodyField;
  numeralFields(p, glyph, bodyField);
  vec3 clip = planes(p);
  float radial = radiusAt(p.x);
  vec3 housing = clip + apothem - radial;
  // Closed counters belong to the ink, not the shared wall between faces.
  float numerals = smoothUnion(smoothUnion(bodyField.x, bodyField.y, 0.16), bodyField.z, 0.16);
  float body = max(numerals - padding, max(housing.x, max(housing.y, housing.z)) * 0.35);
  // Flat numeral caps keep the type undistorted. Their supports meet the rounded body.
  float thickness = apothem - radial + 0.06;
  vec3 slabs = max(clip, -clip - thickness);
  vec3 letters = max(glyph, slabs * 0.35);
  float supports = max(min(letters.x, min(letters.y, letters.z)), max(clip.x, max(clip.y, clip.z)));
  // Fillet only the joins, then restore the flat face planes for crisp numeral caps.
  float joined = smoothUnion(body, supports, 0.08);
  return max(joined, max(clip.x, max(clip.y, clip.z)) * 0.35);
}

vec2 boxHit(vec3 origin, vec3 direction) {
  vec3 low = vec3(-fieldSpan * 0.5, -ROOT3 * apothem, -2.0 * apothem);
  vec3 high = vec3(fieldSpan * 0.5, ROOT3 * apothem, apothem);
  vec3 inverse = 1.0 / (direction + vec3(0.0000001));
  vec3 a = (low - origin) * inverse;
  vec3 b = (high - origin) * inverse;
  vec3 nearValue = min(a, b);
  vec3 farValue = max(a, b);
  return vec2(max(nearValue.x, max(nearValue.y, nearValue.z)), min(farValue.x, min(farValue.y, farValue.z)));
}

void main() {
  vec2 position = (vUv - 0.5) * viewSize;
  position.y -= bounce;
  vec3 origin = inverseRotation * vec3(position / objectScale, 8.0);
  vec3 direction = inverseRotation * vec3(0.0, 0.0, -1.0);
  vec2 interval = boxHit(origin, direction);
  if (interval.y < max(interval.x, 0.0)) { gl_FragColor = vec4(0.0); return; }
  float travel = max(interval.x, 0.0);
  vec3 hit = vec3(0.0);
  bool found = false;
  for (int step = 0; step < 160; step++) {
    hit = origin + direction * travel;
    float distance = volume(hit);
    if (distance < 0.0018) { found = true; break; }
    travel += max(distance * 0.8, 0.001);
    if (travel > interval.y) break;
  }
  if (!found) { gl_FragColor = vec4(0.0); return; }
  vec3 clip = planes(hit);
  vec3 glyph, bodyField;
  numeralFields(hit, glyph, bodyField);
  glyph += inkInset;
  float ink = 0.0;
  if (clip.x > -0.004 && direction.z < -0.02) ink = max(ink, 1.0 - smoothstep(-0.003, 0.003, glyph.x));
  if (clip.y > -0.004 && 0.8660254 * direction.y - 0.5 * direction.z < -0.02) ink = max(ink, 1.0 - smoothstep(-0.003, 0.003, glyph.y));
  if (clip.z > -0.004 && -0.8660254 * direction.y - 0.5 * direction.z < -0.02) ink = max(ink, 1.0 - smoothstep(-0.003, 0.003, glyph.z));
  gl_FragColor = vec4(mix(sideColor, numberColor, ink), 1.0);
}
