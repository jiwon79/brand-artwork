precision highp float;
varying vec3 vFurColor;
varying float vAlong;
varying float vAcross;
varying float vSilhouette;

void main() {
  float edge = 1.0 - smoothstep(0.1, 1.0, abs(vAcross));
  float tip = pow(1.0 - vAlong, 1.5);
  float rim = mix(0.18, 1.0, pow(vSilhouette, 1.7));
  float opacity = 0.38 * edge * tip * rim;
  gl_FragColor = vec4(clamp(vFurColor, 0.0, 1.0), opacity);
}
