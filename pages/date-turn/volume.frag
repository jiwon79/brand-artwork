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
uniform float prismRadius;
uniform float prismHalfLength;
uniform float extrusionDepth;
uniform float fieldSpan;
uniform vec2 glyphScale;
uniform vec3 numberColor;
uniform vec3 sideColor;
uniform vec3 inkInset;
uniform float inspectMode;
uniform float inspectPart;
uniform vec4 inspectLayers;
uniform vec3 inspectBackground;
uniform float inspectPixelWidth;

const float ROOT3 = 1.73205080757;
float field(sampler2D source, vec2 point) {
  point /= glyphScale;
  vec2 uv = point / fieldSpan + 0.5;
  vec2 outside = max(abs(point) - fieldSpan * 0.5, 0.0);
  vec4 encoded = texture2D(source, clamp(uv, 0.0, 1.0));
  float distance = ((encoded.r * 65280.0 + encoded.g * 255.0) / 65535.0 - 0.5) * 2.0 * fieldSpan;
  return (distance + length(outside)) * min(glyphScale.x, glyphScale.y);
}

vec3 numeralFields(vec3 p) {
  return vec3(field(face0, p.xy),
    field(face1, vec2(p.x, -0.5 * p.y - 0.8660254 * p.z)),
    field(face2, vec2(p.x, -0.5 * p.y + 0.8660254 * p.z)));
}

vec3 planes(vec3 p) {
  return vec3(p.z, 0.8660254 * p.y - 0.5 * p.z, -0.8660254 * p.y - 0.5 * p.z) - apothem;
}

float volume(vec3 p) {
  vec3 glyph = numeralFields(p);
  vec3 fromBase = planes(p) + extrusionDepth;
  // One finite regular triangular prism. Its three side normals have unit length.
  float prism = max(abs(p.x) - prismHalfLength, max(fromBase.x, max(fromBase.y, fromBase.z)));
  // Each raw glyph is swept from its base plane to its tip plane, along that face normal.
  // No rounded envelope, counter filling, face clipping, or smooth union is applied.
  vec3 slabs = max(-fromBase, fromBase - extrusionDepth);
  vec3 numerals = max(glyph, slabs);
  float extrusions = min(numerals.x, min(numerals.y, numerals.z));
  if (inspectMode > 0.0 && inspectPart > 0.5) return inspectPart < 1.5 ? prism : extrusions;
  return min(prism, extrusions);
}

vec3 surfaceNormal(vec3 p) {
  // Estimate over roughly two field texels; this only shades, never rounds the geometry.
  vec2 d = vec2(fieldSpan * min(glyphScale.x, glyphScale.y) / 384.0, 0.0);
  vec3 gradient = vec3(volume(p + d.xyy) - volume(p - d.xyy),
    volume(p + d.yxy) - volume(p - d.yxy), volume(p + d.yyx) - volume(p - d.yyx));
  return gradient / max(length(gradient), 0.000001);
}

// Solid contours lie on the extruded tips; dashed rectangles lie on the prism's base faces.
vec4 inspectFace(sampler2D source, vec3 origin, vec3 direction, vec3 normal, vec3 tangent,
  vec3 color, float hitTravel, float pixelWidth) {
  float facing = dot(normal, direction);
  if (abs(facing) < 0.0001) return vec4(0.0);
  float travel = (apothem - dot(normal, origin)) / facing;
  float baseTravel = (prismRadius - dot(normal, origin)) / facing;
  if (travel < 0.0 || baseTravel < 0.0) return vec4(0.0);
  vec3 p = origin + direction * travel;
  vec3 base = origin + direction * baseTravel;
  vec2 uv = vec2(p.x, dot(tangent, p));
  vec2 baseUv = vec2(base.x, dot(tangent, base));
  float width = pixelWidth / max(abs(facing), 0.2);
  float visibility = travel > hitTravel + 0.018 ? inspectLayers.w * 0.3 : 1.0;
  float baseVisibility = baseTravel > hitTravel + 0.018 ? inspectLayers.w * 0.3 : 1.0;
  float glyph = field(source, uv);
  float glyphLine = (1.0 - smoothstep(width, width * 2.0, abs(glyph))) * inspectLayers.x * visibility;
  vec2 q = abs(baseUv) - vec2(prismHalfLength, ROOT3 * prismRadius);
  float rectangle = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float dash = step(0.38, fract((baseUv.x + baseUv.y) * 13.0));
  float baseLine = (1.0 - smoothstep(width, width * 2.0, abs(rectangle))) * dash * inspectLayers.y * baseVisibility;
  vec2 gridDistance = abs(fract(baseUv / 0.25 + 0.5) - 0.5) * 0.25;
  float grid = (1.0 - smoothstep(width * 0.5, width, min(gridDistance.x, gridDistance.y))) * step(rectangle, 0.0);
  float frame = grid * 0.2 * inspectLayers.z * baseVisibility;
  float fill = (1.0 - smoothstep(-width, width, glyph)) * inspectLayers.x * 0.06 * visibility;
  return vec4(color, max(glyphLine, max(baseLine, max(frame, fill))));
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
  float extent = max(2.0 * prismRadius, apothem + fieldSpan * glyphScale.y * 0.5);
  float halfLength = max(prismHalfLength, fieldSpan * glyphScale.x * 0.5);
  vec3 low = vec3(-halfLength, -extent, -extent);
  vec3 high = -low;
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
  vec3 glyph = numeralFields(hit);
  glyph += inkInset;
  float ink = 0.0;
  if (abs(clip.x) < 0.004 && direction.z < -0.02) ink = max(ink, 1.0 - smoothstep(-0.003, 0.003, glyph.x));
  if (abs(clip.y) < 0.004 && 0.8660254 * direction.y - 0.5 * direction.z < -0.02) ink = max(ink, 1.0 - smoothstep(-0.003, 0.003, glyph.y));
  if (abs(clip.z) < 0.004 && -0.8660254 * direction.y - 0.5 * direction.z < -0.02) ink = max(ink, 1.0 - smoothstep(-0.003, 0.003, glyph.z));
  gl_FragColor = vec4(mix(sideColor, numberColor, ink), 1.0);
}
