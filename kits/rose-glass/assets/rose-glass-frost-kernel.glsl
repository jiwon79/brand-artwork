// Material-space frost kernel used by the reference. q is normalized body space.
float hashRose(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noiseRose(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  return mix(mix(hashRose(i), hashRose(i+vec2(1,0)), f.x),
    mix(hashRose(i+vec2(0,1)), hashRose(i+vec2(1,1)), f.x), f.y);
}

vec3 reliefNoiseRose(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0 - 2.0*f), du = 6.0*f*(1.0 - f);
  float a = hashRose(i), b = hashRose(i + vec2(1,0));
  float c = hashRose(i + vec2(0,1)), d = hashRose(i + vec2(1,1));
  float crossTerm = a - b - c + d;
  return vec3(a + (b-a)*u.x + (c-a)*u.y + crossTerm*u.x*u.y,
    du*vec2(b-a+crossTerm*u.y, c-a+crossTerm*u.x));
}

// grainUV is measured in reference pixels and follows material deformation.
// Derivatives fade only subpixel relief, preserving the larger inclusions.
vec3 applyRoseFrost(vec3 srgbColor, vec2 grainUV, vec2 q, float edge,
  vec2 grainLight, float grainAmount, int bodyId) {
  float filter = 1.0 - smoothstep(1.1, 3.5, length(fwidth(grainUV)));
  vec3 micro = reliefNoiseRose(grainUV * 0.76);
  vec3 coarse = reliefNoiseRose(grainUV * 0.29 + 17.3);
  float fine = noiseRose(grainUV * 2.1) - 0.5;
  float mottling = noiseRose(grainUV * 0.34) - 0.5;
  float surfaceRelief = bodyId == 2 ? 1.0 : 0.20;
  float normalRelief = dot(micro.yz*0.018 + coarse.yz*0.009, grainLight)
    * filter * surfaceRelief;
  float fineStrength = bodyId == 2 ? 0.026 : 0.012;
  float mottleStrength = bodyId == 2 ? 0.025 : 0.012;
  float visibility = bodyId == 2 ? 0.65 + 0.35*exp(-pow((q.y+0.075-q.x*0.27)/0.34,2.0))
    : 0.48 + 0.35*sqrt(edge);
  return srgbColor + (fine*fineStrength*filter + mottling*mottleStrength + normalRelief)
    * grainAmount * visibility * (1.0 + edge*0.35);
}

// Grain amplitude target: most adjacent-pixel sRGB changes stay within 2-7 levels.
// Larger contrast belongs to sparse buried inclusions, not the fine frost layer.
