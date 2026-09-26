attribute vec3 instanceRoot;
attribute vec3 instanceTip;
attribute vec3 instanceDirection;
attribute float instanceWidth;
uniform float uCheek;
varying vec3 vFurColor;
varying float vAlong;
varying float vAcross;
varying float vSilhouette;

void main() {
  vec4 viewRoot = modelViewMatrix * vec4(instanceRoot, 1.0);
  vec4 viewTip = modelViewMatrix * vec4(instanceTip, 1.0);
  vec2 axis = viewTip.xy - viewRoot.xy;
  vec2 across = length(axis) > 0.001 ? normalize(vec2(-axis.y, axis.x)) : vec2(1.0, 0.0);
  float along = position.y;
  vec4 viewPosition = mix(viewRoot, viewTip, along);
  viewPosition.xy += across * position.x * instanceWidth * pow(1.0 - along, 0.8);

  vFurColor = peachColor(instanceRoot.xy, uCheek);
  vAlong = along;
  vAcross = position.x;
  vSilhouette = 1.0 - abs(normalize(mat3(modelViewMatrix) * instanceDirection).z);
  gl_Position = projectionMatrix * viewPosition;
}
