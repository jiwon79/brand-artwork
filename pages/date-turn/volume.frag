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
uniform float inspectMode;
uniform float inspectPart;
uniform vec4 inspectLayers;
uniform vec3 inspectBackground;
uniform float inspectPixelWidth;

const float ROOT3 = 1.73205080757;
const float LOBE_OFFSET = 0.64;
const float LOBE_RADIUS = 0.86;

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
  float local = min(abs(x - LOBE_OFFSET), abs(x + LOBE_OFFSET)) / LOBE_RADIUS;
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
  // A zero radius still leaves a surface on the x axis; close it at the lobe ends.
  float housingDistance = max(max(housing.x, max(housing.y, housing.z)), abs(p.x) - (LOBE_OFFSET + LOBE_RADIUS));
  // Closed counters belong to the ink, not the shared wall between faces.
  float numerals = smoothUnion(smoothUnion(bodyField.x, bodyField.y, 0.16), bodyField.z, 0.16);
  float body = max(numerals - padding, housingDistance * 0.35);
  // Flat numeral caps keep the type undistorted. Their supports meet the rounded body.
  float thickness = apothem - radial + 0.06;
  vec3 slabs = max(clip, -clip - thickness);
  vec3 letters = max(glyph, slabs * 0.35);
  float supports = max(min(letters.x, min(letters.y, letters.z)), max(clip.x, max(clip.y, clip.z)));
  // Fillet only the joins, then restore the flat face planes for crisp numeral caps.
  float joined = smoothUnion(body, supports, 0.08);
  if (inspectMode > 0.0 && inspectPart > 0.5) joined = inspectPart < 1.5 ? body : supports;
  return max(joined, max(clip.x, max(clip.y, clip.z)) * 0.35);
}

vec3 surfaceNormal(vec3 p) {
  vec2 d = vec2(0.002, 0.0);
  vec3 gradient = vec3(volume(p + d.xyy) - volume(p - d.xyy),
    volume(p + d.yxy) - volume(p - d.yxy), volume(p + d.yyx) - volume(p - d.yyx));
  return gradient / max(length(gradient), 0.000001);
}

// These are contours of the same sampled fields used by the solid, on its three actual planes.
// The dashed contour is an input field offset, not the final 3D silhouette or a polygon mesh.
vec4 inspectFace(sampler2D source, vec3 origin, vec3 direction, vec3 normal, vec3 tangent,
  vec3 color, float hitTravel, float pixelWidth) {
  float facing = dot(normal, direction);
  if (abs(facing) < 0.0001) return vec4(0.0);
  float travel = (apothem - dot(normal, origin)) / facing;
  if (travel < 0.0) return vec4(0.0);
  vec3 p = origin + direction * travel;
  vec2 uv = vec2(p.x, dot(tangent, p));
  if (abs(uv.x) > 1.65 || abs(uv.y) > 1.12) return vec4(0.0);
  float hidden = travel > hitTravel + 0.018 ? 1.0 : 0.0;
  float visibility = hidden > 0.5 ? inspectLayers.w * 0.3 : 1.0;
  vec2 distances = field(source, uv);
  float width = pixelWidth / max(abs(facing), 0.2);
  float glyphLine = 1.0 - smoothstep(width, width * 2.0, abs(distances.x));
  float dash = step(0.38, fract((uv.x + uv.y) * 13.0));
  float bodyLine = (1.0 - smoothstep(width, width * 2.0, abs(distances.y - padding))) * dash;
  vec2 gridDistance = abs(fract(uv / 0.25 + 0.5) - 0.5) * 0.25;
  float grid = 1.0 - smoothstep(width * 0.5, width, min(gridDistance.x, gridDistance.y));
  float borderDistance = min(abs(abs(uv.x) - 1.6), abs(abs(uv.y) - 1.06));
  float border = 1.0 - smoothstep(width, width * 2.0, borderDistance);
  float line = max(glyphLine * inspectLayers.x, bodyLine * inspectLayers.y);
  float frame = max(grid * 0.13, border * 0.4) * inspectLayers.z;
  float fill = (1.0 - smoothstep(-width, width, distances.x)) * inspectLayers.x * 0.06;
  return vec4(color, max(line, max(frame, fill)) * visibility);
}

void blendFace(inout vec3 color, vec4 face) {
  color = mix(color, face.rgb, face.a);
}

float planeDepth(vec3 origin, vec3 direction, vec3 normal) {
  float facing = dot(normal, direction);
  if (abs(facing) < 0.0001) return 100000.0;
  float travel = (apothem - dot(normal, origin)) / facing;
  return travel >= 0.0 ? travel : 100000.0;
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
  bool intersects = interval.y >= max(interval.x, 0.0);
  if (!intersects && inspectMode < 0.5) { gl_FragColor = vec4(0.0); return; }
  float travel = max(interval.x, 0.0);
  vec3 hit = vec3(0.0);
  bool found = false;
  for (int step = 0; step < 160; step++) {
    if (!intersects || inspectMode > 2.5) break;
    hit = origin + direction * travel;
    float distance = volume(hit);
    if (distance < 0.0018) { found = true; break; }
    travel += max(distance * 0.8, 0.001);
    if (travel > interval.y) break;
  }
  if (!found && inspectMode < 0.5) { gl_FragColor = vec4(0.0); return; }
  if (inspectMode > 0.5) {
    vec3 color = inspectBackground;
    if (found) {
      vec3 normal = surfaceNormal(hit);
      if (inspectMode > 1.5) color = normal * 0.5 + 0.5;
      else {
        vec3 light = inverseRotation * normalize(vec3(-0.4, 0.8, 1.0));
        float shading = 0.42 + 0.58 * max(dot(normal, light), 0.0);
        color = vec3(0.67, 0.72, 0.79) * shading;
        if (inspectLayers.z > 0.5) {
          vec3 gridDistance = abs(fract(hit / 0.25 + 0.5) - 0.5) * 0.25;
          vec3 gridLines = (1.0 - smoothstep(vec3(0.003), vec3(0.008), gridDistance)) * (1.0 - abs(normal));
          color *= 1.0 - 0.22 * max(gridLines.x, max(gridLines.y, gridLines.z));
        }
      }
    }
    float hitTravel = found ? travel : 1000.0;
    float pixelWidth = inspectPixelWidth;
    vec4 a = inspectFace(face0, origin, direction, vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 0.0), vec3(0.88, 0.16, 0.07), hitTravel, pixelWidth);
    vec4 b = inspectFace(face1, origin, direction, vec3(0.0, 0.8660254, -0.5), vec3(0.0, -0.5, -0.8660254), vec3(0.07, 0.3, 0.9), hitTravel, pixelWidth);
    vec4 c = inspectFace(face2, origin, direction, vec3(0.0, -0.8660254, -0.5), vec3(0.0, -0.5, 0.8660254), vec3(0.02, 0.55, 0.26), hitTravel, pixelWidth);
    // Sort the three ray/plane intersections so translucent rear contours cannot cover front ones.
    float ta = planeDepth(origin, direction, vec3(0.0, 0.0, 1.0));
    float tb = planeDepth(origin, direction, vec3(0.0, 0.8660254, -0.5));
    float tc = planeDepth(origin, direction, vec3(0.0, -0.8660254, -0.5));
    if (ta < tb) { vec4 swapFace = a; a = b; b = swapFace; float swapDepth = ta; ta = tb; tb = swapDepth; }
    if (tb < tc) { vec4 swapFace = b; b = c; c = swapFace; float swapDepth = tb; tb = tc; tc = swapDepth; }
    if (ta < tb) { vec4 swapFace = a; a = b; b = swapFace; }
    blendFace(color, a); blendFace(color, b); blendFace(color, c);
    gl_FragColor = vec4(color, 1.0);
    return;
  }
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
