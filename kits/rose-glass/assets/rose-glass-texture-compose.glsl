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

vec3 signedDelta(sampler2D source, vec2 referencePoint) {
  // An 8-bit source value 128 decodes to +1/255; the base plate compensates.
  return 2.0 * texture(source, roseGlassUV(referencePoint)).rgb - 1.0;
}

vec3 roseGlassRestingColor(vec2 screenPoint) {
  vec3 color = texture(uPlateBase, roseGlassUV(screenPoint)).rgb;
  color += signedDelta(uDeltaUpper, screenPoint);
  color += signedDelta(uDeltaLower, screenPoint);
  color += signedDelta(uDeltaForeground, screenPoint);
  return clamp(color, 0.0, 1.0);
}

// screenPoint = vec2(outputUV.x * 720.0 - 65.0, outputUV.y * 1280.0),
// where outputUV uses a top-left origin. This function is a static-image
// validation recipe, not the interactive renderer. Warping a signed delta
// creates seams because each delta already depends on the underlayer at its
// original screen position. Follow ../INTERACTION.md for depth-aware dragging.
