// Rose Glass implementation notes. Values use the 590 x 1280 reference space.
// Palette constants are sRGB. Convert them with toLinear() before lighting.

// The resting visible contour, grain and thick edge come from the four signed
// layer PNGs. Use the three SVG masks for picking and new moving highlights.
// Rasterize every SVG on the full 590 x 1280 material canvas. Upload with
// UNPACK_FLIP_Y_WEBGL=false and sample after inverse deformation.
float fixedShapeMask(sampler2D maskTexture, vec2 inverseDeformedReferencePoint) {
  vec2 uv = vec2(inverseDeformedReferencePoint.x / 590.0,
    inverseDeformedReferencePoint.y / 1280.0);
  return texture(maskTexture, clamp(uv, 0.0, 1.0)).a;
}

// Keep this analytic field for material coordinates, picking and deformation.
// Do not use it as the final visible silhouette when a fixed SVG mask is available.
float superellipseField(vec2 q, float exponent) {
  return pow(abs(q.x), exponent) + pow(abs(q.y), exponent);
}

float gaussianHalfPlane(float distancePx, float sigmaPx) {
  float t = distancePx / max(sigmaPx, 0.1);
  return 0.5 + 0.5 * sign(t) * sqrt(1.0 - exp(-0.63662 * t * t));
}

vec2 edgeVolume(vec2 q, int bodyId) {
  float left = 1.0 - smoothstep(-0.92, -0.22, q.x);
  float right = smoothstep(0.22, 0.92, q.x);
  float base = smoothstep(0.25, 0.96, q.y);
  if (bodyId == 2) {
    float shoulder = exp(-pow((q.y + 0.12) / 0.90, 2.0));
    return vec2(14.0 + 45.0*left*shoulder + 55.0*right + 20.0*base,
                0.22 + 0.45*left*shoulder + 0.45*right + 0.18*base);
  }
  if (bodyId == 0) return vec2(12.0 + 18.0*left + 24.0*right + 8.0*base,
                               0.20 + 0.60*left + 0.53*right + 0.12*base);
  return vec2(14.0 + 22.0*left + 24.0*right + 12.0*base,
              0.20 + 0.60*left + 0.64*right + 0.18*base);
}

float progressiveEdgeBlur(float insideDistancePx, float localWidthPx, float blurPx) {
  return blurPx * exp(-pow(max(insideDistancePx, 0.0) / localWidthPx, 1.35));
}

vec2 automaticLight(float seconds, vec2 home, float orbit) {
  float t = seconds * 0.35 * 0.65;
  return home + vec2(sin(t) * 310.0,
    ((cos(t * 0.73) - 1.0) * 190.0 + sin(t * 0.51) * 260.0) * orbit);
}

float dynamicMaterialScale(float activeAndRecoveringGrips) {
  return inversesqrt(1.0 + max(0.0, activeAndRecoveringGrips - 1.0) * 0.4);
}

vec2 upperProfile(float y) {
  float t = (-y - 0.30) / 0.44;
  float root = sqrt(t*t + 0.035);
  float taper = 0.5 * (t + root);
  return vec2(245.0 * (1.0 - 0.22*taper*taper), 122.5*taper*(1.0 + t/root));
}

vec2 foregroundProfile(float y) {
  float lower = clamp((y + 0.10) / 0.40, 0.0, 1.0);
  float taper = lower*lower*(3.0 - 2.0*lower);
  float slope = 6.0*lower*(1.0 - lower) / 0.40;
  return vec2(252.0*(1.0 - 0.11*y - 0.0325*taper), -252.0*(0.11 + 0.0325*slope));
}

// Material pass: RGB stores sharp linear-light material color; A stores blur radius.
// Resolve pass: sample a 5 x 5 binomial kernel using A, then convert once to sRGB.
