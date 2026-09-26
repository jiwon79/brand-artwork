precision highp float;
uniform vec3 uFurTipColor;
varying vec3 vFurColor;
varying float vAlong;
varying float vAcross;
varying float vSilhouette;

void main() {
  float edge = 1.0 - smoothstep(0.1, 1.0, abs(vAcross));
  float tip = pow(1.0 - vAlong, 0.9);
  float rim = mix(0.42, 1.0, pow(vSilhouette, 1.6));
  float opacity = 0.26 * edge * tip * rim;
  vec3 color = mix(vFurColor, uFurTipColor, vAlong * 0.13);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), opacity);
}
