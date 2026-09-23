// Minimal material contract for the four supplied RGB textures.
// Upload PNGs with UNPACK_FLIP_Y_WEBGL=false and sample using top-left UV.
uniform sampler2D uPlateBase;
uniform sampler2D uDeltaUpper;
uniform sampler2D uDeltaLower;
uniform sampler2D uDeltaForeground;

vec2 roseGlassUV(vec2 referencePoint) {
  return vec2((referencePoint.x + 65.0) / 720.0,
    referencePoint.y / 1280.0);
}

vec3 signedDelta(sampler2D source, vec2 inverseDeformedPoint) {
  // An 8-bit source value 128 decodes to +1/255; the base plate compensates.
  return 2.0 * texture(source, roseGlassUV(inverseDeformedPoint)).rgb - 1.0;
}

vec3 roseGlassRestingColor(vec2 screenPoint, vec2 upperPoint,
  vec2 lowerPoint, vec2 foregroundPoint) {
  vec3 color = texture(uPlateBase, roseGlassUV(screenPoint)).rgb;
  color += signedDelta(uDeltaUpper, upperPoint);
  color += signedDelta(uDeltaLower, lowerPoint);
  color += signedDelta(uDeltaForeground, foregroundPoint);
  return clamp(color, 0.0, 1.0);
}

// screenPoint = vec2(outputUV.x * 720.0 - 65.0, outputUV.y * 1280.0),
// where outputUV uses a top-left origin. Idle: all four points are screenPoint.
// For a drag, inverse-deform only the
// corresponding body's point. Add moving white reflections after this decode;
// never replace the photographed frost or thick edge with flat gradients.
