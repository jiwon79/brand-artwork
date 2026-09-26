precision highp float;
varying vec2 vWorld;
uniform vec2 uShadow;
uniform float uShadowScale;

void main() {
  float vertical = clamp((360.0 - vWorld.y) / 720.0, 0.0, 1.0);
  vec3 color = mix(vec3(0.249, 0.380, 0.883), vec3(0.466, 0.489, 0.887), smoothstep(0.0, 1.0, vertical));
  color += 0.010 * sin(vWorld.x * 0.004 + vWorld.y * 0.002);
  vec2 ellipse = (vWorld - uShadow) / vec2(136.0 * uShadowScale, 39.0 * uShadowScale);
  float shadow = exp(-dot(ellipse, ellipse) * 0.74);
  color = mix(color, vec3(0.075, 0.319, 0.863), shadow * 0.70);
  gl_FragColor = vec4(color, 1.0);
}
