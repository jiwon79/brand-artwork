uniform vec3 uBaseColor;
uniform vec3 uCoolColor;
uniform vec3 uBlushColor;
uniform vec3 uWarmColor;
uniform vec3 uHighlightColor;
uniform vec3 uBottomColor;
uniform vec3 uDetailColor;

float glow(vec2 point, vec2 center, vec2 spread) {
  vec2 p = (point - center) / spread;
  return exp(-dot(p, p) * 0.5);
}

vec3 peachColor(vec2 p, float cheekStrength) {
  vec3 color = uBaseColor;
  color = mix(color, uCoolColor, glow(p, vec2(-107., -18.), vec2(82., 112.)) * 0.82);
  color = mix(color, uBlushColor, glow(p, vec2(12., 3.), vec2(71., 65.)) * 0.82);
  color = mix(color, uWarmColor, glow(p, vec2(76., -4.), vec2(65., 101.)) * 0.96 * smoothstep(-10., 65., p.x));
  color = mix(color, uHighlightColor, glow(p, vec2(-4., 116.), vec2(72., 44.)) * 0.94);
  float cheek = glow(p, vec2(112., -42.), vec2(43., 42.)) * cheekStrength;
  color = mix(color, uWarmColor, cheek * 0.78);
  color = mix(color, uHighlightColor, glow(p, vec2(99., -14.), vec2(24., 27.)) * cheekStrength * 0.42);
  float cleft = glow(p, vec2(89., -47.), vec2(19., 29.)) * cheekStrength;
  color = mix(color, uDetailColor, cleft * 0.70);
  color = mix(color, uBottomColor, (1.0 - smoothstep(-150., -45., p.y)) * 0.48);
  float warm = glow(p, vec2(48., -1.), vec2(95., 82.))
    * smoothstep(-105., -28., p.y) * (1.0 - smoothstep(54., 112., p.y));
  color.r += warm * 0.075;
  color.b -= warm * 0.045;
  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(vec3(luminance), color, 1.16);
}
