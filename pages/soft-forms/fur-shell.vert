attribute vec3 basePosition;
uniform float uCheek;
varying vec3 vFurColor;
varying vec3 vFurSample;
varying float vSilhouette;

void main() {
  vFurColor = peachColor(basePosition.xy, uCheek);
  vFurSample = basePosition;
  vec3 viewNormal = normalize(normalMatrix * normal);
  vSilhouette = 1.0 - abs(viewNormal.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
