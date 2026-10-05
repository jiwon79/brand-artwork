precision highp float;
varying vec2 vUv;
uniform sampler2D image;
uniform vec2 pixelSize;
uniform float lineWidth;
uniform vec3 lineColor;
uniform vec3 backgroundColor;
void main() {
  vec4 center = texture2D(image, vUv);
  vec2 d = pixelSize * lineWidth * 0.5;
  float low = center.a;
  float high = center.a;
  float coverage = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float alpha = texture2D(image, vUv + vec2(float(x), float(y)) * d).a;
      low = min(low, alpha);
      high = max(high, alpha);
      coverage += alpha;
    }
  }
  vec3 color = mix(backgroundColor, center.rgb, center.a);
  // Avoid amplifying isolated subpixel misses from grazing volume rays.
  float edge = (coverage > 7.5 || coverage < 1.5) ? 0.0 : high - low;
  color = mix(color, lineColor, edge);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
