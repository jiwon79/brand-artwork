import * as THREE from 'three';
import GUI from 'lil-gui';
import { exposeGuiInDebugMode } from '../../common/debug';

const MAX_LIGHTS = 2;

type Light = {
  position: THREE.Vector2;
  initialPosition: THREE.Vector2;
  target: THREE.Vector2;
  color: THREE.Color;
  intensity: number;
  spread: number;
};

const stage = document.getElementById('stage') as HTMLCanvasElement;
const cursor = document.getElementById('cursor') as HTMLDivElement;
const errorEl = document.getElementById('error') as HTMLDivElement;
const fpsEl = document.getElementById('fps') as HTMLSpanElement;
const infoToggle = document.getElementById('info-toggle') as HTMLButtonElement;
const infoPanel = document.getElementById('info-panel') as HTMLElement;

const params = {
  logoScale: 0.345,
  logoY: 0.49,
  intensity: 0.96,
  haze: 0.76,
  shadow: 0.88,
  transmission: 0.18,
  refraction: 0.014,
  dispersion: 0.0045,
  edgeGlow: 0.96,
  ambientRays: 0.68,
  grain: 0.18,
  autoSwivel: true,
  swivelAmount: 0.018,
};

const lights: Light[] = [
  {
    position: new THREE.Vector2(0.235, 0.805),
    initialPosition: new THREE.Vector2(0.235, 0.805),
    target: new THREE.Vector2(0.5, 0.49),
    color: new THREE.Color('#fff8ef'),
    intensity: 1,
    spread: 0.30,
  },
  {
    position: new THREE.Vector2(0.785, 0.735),
    initialPosition: new THREE.Vector2(0.785, 0.735),
    target: new THREE.Vector2(0.5, 0.49),
    color: new THREE.Color('#edf7ff'),
    intensity: 0.96,
    spread: 0.23,
  },
];

let stageRect = stage.getBoundingClientRect();
let activeLight = 0;
let dragging = false;
let alternateLight = 0;

function showError(message: string): void {
  errorEl.textContent = message;
  errorEl.classList.add('show');
}

window.addEventListener('error', (event) => {
  showError(`Error: ${event.message || 'unknown'}`);
});

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: stage,
    alpha: false,
    antialias: false,
    powerPreference: 'high-performance',
  });
} catch (error) {
  showError(`WebGL unavailable: ${(error as Error).message}`);
  throw error;
}

renderer.setClearColor(0x050001, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(stageRect.width, stageRect.height, false);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const logoTexture = new THREE.TextureLoader().load(
  './assets/nasa-worm.svg',
  (texture) => {
    texture.needsUpdate = true;
  },
  undefined,
  () => showError('NASA logo mask could not be loaded'),
);
logoTexture.minFilter = THREE.LinearFilter;
logoTexture.magFilter = THREE.LinearFilter;
logoTexture.wrapS = THREE.ClampToEdgeWrapping;
logoTexture.wrapT = THREE.ClampToEdgeWrapping;
logoTexture.colorSpace = THREE.NoColorSpace;

const uniforms = {
  uLogo: { value: logoTexture },
  uResolution: { value: new THREE.Vector2(stageRect.width, stageRect.height) },
  uLogoRect: { value: new THREE.Vector4() },
  uLightPos: { value: lights.map((light) => light.position.clone()) },
  uLightTarget: { value: lights.map((light) => light.target.clone()) },
  uLightColor: { value: lights.map((light) => light.color.clone()) },
  uLightIntensity: { value: lights.map((light) => light.intensity) },
  uLightSpread: { value: lights.map((light) => light.spread) },
  uTime: { value: 0 },
  uIntensity: { value: params.intensity },
  uHaze: { value: params.haze },
  uShadow: { value: params.shadow },
  uTransmission: { value: params.transmission },
  uRefraction: { value: params.refraction },
  uDispersion: { value: params.dispersion },
  uEdgeGlow: { value: params.edgeGlow },
  uAmbientRays: { value: params.ambientRays },
  uGrain: { value: params.grain },
};

const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;

  #define MAX_LIGHTS ${MAX_LIGHTS}
  varying vec2 vUv;

  uniform sampler2D uLogo;
  uniform vec2 uResolution;
  uniform vec4 uLogoRect;
  uniform vec2 uLightPos[MAX_LIGHTS];
  uniform vec2 uLightTarget[MAX_LIGHTS];
  uniform vec3 uLightColor[MAX_LIGHTS];
  uniform float uLightIntensity[MAX_LIGHTS];
  uniform float uLightSpread[MAX_LIGHTS];
  uniform float uTime;
  uniform float uIntensity;
  uniform float uHaze;
  uniform float uShadow;
  uniform float uTransmission;
  uniform float uRefraction;
  uniform float uDispersion;
  uniform float uEdgeGlow;
  uniform float uAmbientRays;
  uniform float uGrain;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise21(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += noise21(p) * amplitude;
      p = p * 2.03 + vec2(17.13, 9.21);
      amplitude *= 0.5;
    }
    return value;
  }

  float cross2(vec2 a, vec2 b) {
    return a.x * b.y - a.y * b.x;
  }

  float logoMask(vec2 uv) {
    vec2 logoUv = (uv - uLogoRect.xy) / uLogoRect.zw;
    vec2 lower = step(vec2(0.0), logoUv);
    vec2 upper = step(logoUv, vec2(1.0));
    float inside = lower.x * lower.y * upper.x * upper.y;
    return texture2D(uLogo, logoUv).a * inside;
  }

  vec3 backgroundAt(vec2 uv) {
    vec2 p = uv - vec2(0.5, 0.48);
    p.x *= uResolution.x / uResolution.y;

    float radius = length(p);
    float vignette = 1.0 - smoothstep(0.28, 0.92, radius);
    float centerBloom = exp(-radius * 2.8);
    float angle = atan(p.y, p.x);
    float curtain = fbm(vec2(angle * 3.1 + 2.7, radius * 4.0 - uTime * 0.012));
    curtain = pow(max(curtain - 0.30, 0.0), 1.6);

    vec3 base = vec3(0.095, 0.0004, 0.0012);
    base += vec3(0.34, 0.002, 0.006) * centerBloom * 0.90;
    base += vec3(0.34, 0.001, 0.005) * curtain * vignette * uAmbientRays;
    base *= mix(0.45, 1.0, vignette);
    return base;
  }

  vec3 rawLight(
    vec2 uv,
    vec2 lightPos,
    vec2 lightTarget,
    vec3 lightColor,
    float lightIntensity,
    float spread
  ) {
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 relative = (uv - lightPos) * aspect;
    vec2 axis = normalize((lightTarget - lightPos) * aspect);
    float distanceToLight = length(relative);
    vec2 rayDirection = relative / max(distanceToLight, 0.0001);

    float alignment = dot(rayDirection, axis);
    float signedAngle = atan(cross2(axis, rayDirection), alignment);
    float cone = 1.0 - smoothstep(spread - 0.014, spread + 0.012, abs(signedAngle));
    cone *= step(0.0, alignment);

    float polarNoise = fbm(vec2(signedAngle * 37.0, distanceToLight * 5.0 - uTime * 0.05));
    float fineRays = noise21(vec2(signedAngle * 190.0, distanceToLight * 2.2 + uTime * 0.025));
    float haze = mix(1.0, 0.74 + polarNoise * 0.26 + fineRays * 0.04, uHaze);
    float distanceFade = exp(-distanceToLight * 0.24);
    float body = cone * haze * distanceFade;

    float edgeWarm = exp(-abs(signedAngle + spread) * 94.0) * cone;
    float edgeCool = exp(-abs(signedAngle - spread) * 94.0) * cone;
    vec3 spectralEdge = vec3(1.0, 0.28, 0.02) * edgeWarm * 0.34;
    spectralEdge += vec3(0.02, 0.36, 1.0) * edgeCool * 0.42;

    float sourceCore = exp(-distanceToLight * 155.0);
    float sourceHalo = exp(-distanceToLight * 34.0);
    vec3 source = lightColor * (sourceCore * 3.3 + sourceHalo * 0.52);

    return (lightColor * body + spectralEdge) * lightIntensity * uIntensity + source * lightIntensity;
  }

  float opticalDepth(vec2 lightPos, vec2 destination, float spectralOffset) {
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 light = lightPos * aspect;
    vec2 pixel = destination * aspect;
    vec2 logoCenter = (uLogoRect.xy + uLogoRect.zw * 0.5) * aspect;
    vec2 axis = normalize(logoCenter - light);
    vec2 perpendicular = vec2(-axis.y, axis.x);
    float logoDistance = dot(logoCenter - light, axis);
    float pixelDistance = dot(pixel - light, axis);

    if (pixelDistance <= logoDistance) return 0.0;

    float projectionScale = logoDistance / max(pixelDistance, 0.0001);
    vec2 projected = light + (pixel - light) * projectionScale;
    vec2 projectedUv = (projected + perpendicular * spectralOffset) / aspect;
    vec2 blurX = vec2(uLogoRect.z * 0.045, 0.0);
    vec2 blurY = vec2(0.0, uLogoRect.w * 0.16);
    float blurredMask = logoMask(projectedUv) * 0.14;
    blurredMask += logoMask(projectedUv + blurX) * 0.10;
    blurredMask += logoMask(projectedUv - blurX) * 0.10;
    blurredMask += logoMask(projectedUv + blurX * 2.0) * 0.06;
    blurredMask += logoMask(projectedUv - blurX * 2.0) * 0.06;
    blurredMask += logoMask(projectedUv + blurY) * 0.10;
    blurredMask += logoMask(projectedUv - blurY) * 0.10;
    blurredMask += logoMask(projectedUv + blurY * 2.0) * 0.06;
    blurredMask += logoMask(projectedUv - blurY * 2.0) * 0.06;
    blurredMask += logoMask(projectedUv + blurX + blurY) * 0.055;
    blurredMask += logoMask(projectedUv + blurX - blurY) * 0.055;
    blurredMask += logoMask(projectedUv - blurX + blurY) * 0.055;
    blurredMask += logoMask(projectedUv - blurX - blurY) * 0.055;
    float contact = smoothstep(logoDistance, logoDistance + 0.018, pixelDistance);
    return smoothstep(0.06, 0.46, blurredMask) * contact;
  }

  float behindLogoPlane(vec2 lightPos, vec2 destination) {
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 light = lightPos * aspect;
    vec2 pixel = destination * aspect;
    vec2 logoCenter = (uLogoRect.xy + uLogoRect.zw * 0.5) * aspect;
    vec2 axis = normalize(logoCenter - light);
    float logoDistance = dot(logoCenter - light, axis);
    float pixelDistance = dot(pixel - light, axis);
    return smoothstep(logoDistance - 0.01, logoDistance + 0.035, pixelDistance);
  }

  vec2 refractionBend(vec2 lightPos, vec2 destination) {
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 light = lightPos * aspect;
    vec2 pixel = destination * aspect;
    vec2 logoCenter = (uLogoRect.xy + uLogoRect.zw * 0.5) * aspect;
    vec2 axis = normalize(logoCenter - light);
    float logoDistance = dot(logoCenter - light, axis);
    float pixelDistance = dot(pixel - light, axis);

    if (pixelDistance <= logoDistance) return vec2(0.0);

    float projectionScale = logoDistance / max(pixelDistance, 0.0001);
    vec2 projectedUv = (light + (pixel - light) * projectionScale) / aspect;
    vec2 normalStep = 3.0 / uResolution;
    vec2 gradient = vec2(
      logoMask(projectedUv + vec2(normalStep.x, 0.0)) - logoMask(projectedUv - vec2(normalStep.x, 0.0)),
      logoMask(projectedUv + vec2(0.0, normalStep.y)) - logoMask(projectedUv - vec2(0.0, normalStep.y))
    );
    float gradientLength = length(gradient);
    vec2 normal = gradient / max(gradientLength, 0.0001);
    float travel = clamp((pixelDistance - logoDistance) / max(logoDistance, 0.0001), 0.0, 1.8);
    return normal * uRefraction * travel * smoothstep(0.01, 0.42, gradientLength) * 2.4;
  }

  vec3 environmentWithoutOcclusion(vec2 uv) {
    vec3 color = backgroundAt(uv);
    for (int lightIndex = 0; lightIndex < MAX_LIGHTS; lightIndex++) {
      color += rawLight(
        uv,
        uLightPos[lightIndex],
        uLightTarget[lightIndex],
        uLightColor[lightIndex],
        uLightIntensity[lightIndex],
        uLightSpread[lightIndex]
      );
    }
    return color;
  }

  void main() {
    vec2 uv = vUv;
    vec3 color = backgroundAt(uv);
    float centerMask = logoMask(uv);

    for (int lightIndex = 0; lightIndex < MAX_LIGHTS; lightIndex++) {
      vec3 light = rawLight(
        uv,
        uLightPos[lightIndex],
        uLightTarget[lightIndex],
        uLightColor[lightIndex],
        uLightIntensity[lightIndex],
        uLightSpread[lightIndex]
      );

      vec2 bend = refractionBend(uLightPos[lightIndex], uv);
      vec2 bendDirection = normalize(bend + vec2(0.00001));
      vec3 bentRed = rawLight(
        uv + bend + bendDirection * uDispersion,
        uLightPos[lightIndex], uLightTarget[lightIndex], uLightColor[lightIndex],
        uLightIntensity[lightIndex], uLightSpread[lightIndex]
      );
      vec3 bentGreen = rawLight(
        uv + bend,
        uLightPos[lightIndex], uLightTarget[lightIndex], uLightColor[lightIndex],
        uLightIntensity[lightIndex], uLightSpread[lightIndex]
      );
      vec3 bentBlue = rawLight(
        uv + bend - bendDirection * uDispersion,
        uLightPos[lightIndex], uLightTarget[lightIndex], uLightColor[lightIndex],
        uLightIntensity[lightIndex], uLightSpread[lightIndex]
      );
      vec3 refractedLight = vec3(bentRed.r, bentGreen.g, bentBlue.b);

      float depthRed = opticalDepth(uLightPos[lightIndex], uv, uDispersion * 0.14);
      float depthGreen = opticalDepth(uLightPos[lightIndex], uv, 0.0);
      float depthBlue = opticalDepth(uLightPos[lightIndex], uv, -uDispersion * 0.14);
      vec3 depth = vec3(depthRed, depthGreen, depthBlue) * (1.0 - centerMask);
      vec3 visibility = 1.0 - depth * uShadow * (1.0 - uTransmission);
      float behind = behindLogoPlane(uLightPos[lightIndex], uv) * (1.0 - centerMask);
      float outgoing = lightIndex == 0 ? 0.74 : 0.12;
      float bendAmount = smoothstep(0.0002, max(uRefraction * 0.85, 0.0003), length(bend));
      light = mix(light, refractedLight, behind * bendAmount * 0.88);
      light += abs(refractedLight - light) * behind * bendAmount * 0.32;
      visibility *= mix(1.0, outgoing, behind);

      float averageDepth = (depthRed + depthGreen + depthBlue) / 3.0;
      color *= 1.0 - averageDepth * uShadow * 0.60 * (1.0 - centerMask);
      color += light * visibility;

      vec3 spectralShadow = vec3(depthGreen - depthRed, 0.0, depthGreen - depthBlue);
      color += max(spectralShadow, 0.0) * vec3(0.12, 0.01, 0.15) * uEdgeGlow;
    }

    vec2 normalStep = 2.4 / uResolution;
    float maskLeft = logoMask(uv - vec2(normalStep.x, 0.0));
    float maskRight = logoMask(uv + vec2(normalStep.x, 0.0));
    float maskDown = logoMask(uv - vec2(0.0, normalStep.y));
    float maskUp = logoMask(uv + vec2(0.0, normalStep.y));
    vec2 maskGradient = vec2(maskRight - maskLeft, maskUp - maskDown);
    vec2 surfaceNormal = normalize(maskGradient + vec2(0.00001));

    float dilated = max(max(maskLeft, maskRight), max(maskDown, maskUp));
    float eroded = min(min(maskLeft, maskRight), min(maskDown, maskUp));
    float rim = clamp(dilated - eroded, 0.0, 1.0);

    vec2 glowStep = 7.0 / uResolution;
    float wideMask = max(
      max(logoMask(uv - vec2(glowStep.x, 0.0)), logoMask(uv + vec2(glowStep.x, 0.0))),
      max(logoMask(uv - vec2(0.0, glowStep.y)), logoMask(uv + vec2(0.0, glowStep.y)))
    );
    float outerGlow = max(wideMask - centerMask, 0.0);

    vec2 refractVector = -surfaceNormal * uRefraction * (0.22 + rim * 0.78);
    vec3 refractedRed = environmentWithoutOcclusion(uv + refractVector + surfaceNormal * uDispersion * 0.70);
    vec3 refractedGreen = environmentWithoutOcclusion(uv + refractVector);
    vec3 refractedBlue = environmentWithoutOcclusion(uv + refractVector - surfaceNormal * uDispersion * 0.70);
    vec3 refracted = vec3(refractedRed.r, refractedGreen.g, refractedBlue.b);

    float surfaceIllumination = 0.0;
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 aspectNormal = normalize(surfaceNormal * aspect);
    for (int lightIndex = 0; lightIndex < MAX_LIGHTS; lightIndex++) {
      vec2 towardLight = normalize((uLightPos[lightIndex] - uv) * aspect);
      surfaceIllumination += pow(max(dot(aspectNormal, towardLight), 0.0), 2.4) * uLightIntensity[lightIndex];
    }

    vec3 glass = refracted * 0.12;
    glass = mix(glass, vec3(0.36, 0.001, 0.006), 0.88);
    glass += vec3(1.0, 0.10, 0.07) * surfaceIllumination * rim * 0.20;
    glass += vec3(0.11, 0.001, 0.006) * (1.0 - rim);
    color = mix(color, glass, centerMask * 0.90);

    color += vec3(1.0, 0.02, 0.035) * outerGlow * 0.46 * uEdgeGlow;
    color += vec3(1.0, 0.12, 0.11) * rim * (0.34 + surfaceIllumination * 0.78) * uEdgeGlow;
    color += vec3(0.95, 0.55, 0.32) * max(surfaceNormal.x, 0.0) * rim * 0.12 * uEdgeGlow;
    color += vec3(0.08, 0.27, 1.0) * max(-surfaceNormal.x, 0.0) * rim * 0.12 * uEdgeGlow;

    float vignette = smoothstep(0.94, 0.28, length((uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0)));
    color *= mix(0.60, 1.0, vignette);

    float grain = hash21(gl_FragCoord.xy + fract(uTime) * 173.0) - 0.5;
    color += grain * uGrain * (0.16 + dot(color, vec3(0.333)) * 0.09);
    color = max(color, vec3(0.0));
    color = color / (1.0 + color * 0.54);
    color = pow(color, vec3(0.86));

    gl_FragColor = vec4(color, 1.0);
  }
`;

const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader,
  fragmentShader,
  depthTest: false,
  depthWrite: false,
});

const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
scene.add(quad);

function updateLogoRect(): void {
  const minDimension = Math.min(stageRect.width, stageRect.height);
  const logoWidthPx = minDimension * params.logoScale;
  const logoHeightPx = logoWidthPx * (141.732 / 508.204);
  const logoWidthUv = logoWidthPx / stageRect.width;
  const logoHeightUv = logoHeightPx / stageRect.height;
  uniforms.uLogoRect.value.set(
    0.5 - logoWidthUv / 2,
    params.logoY - logoHeightUv / 2,
    logoWidthUv,
    logoHeightUv,
  );
  for (const light of lights) light.target.set(0.5, params.logoY);
}

function syncUniforms(elapsedSeconds: number): void {
  uniforms.uTime.value = elapsedSeconds;
  uniforms.uIntensity.value = params.intensity;
  uniforms.uHaze.value = params.haze;
  uniforms.uShadow.value = params.shadow;
  uniforms.uTransmission.value = params.transmission;
  uniforms.uRefraction.value = params.refraction;
  uniforms.uDispersion.value = params.dispersion;
  uniforms.uEdgeGlow.value = params.edgeGlow;
  uniforms.uAmbientRays.value = params.ambientRays;
  uniforms.uGrain.value = params.grain;

  for (let index = 0; index < lights.length; index += 1) {
    const light = lights[index];
    const destination = uniforms.uLightPos.value[index];
    if (!dragging || activeLight !== index) {
      const swivel = params.autoSwivel
        ? Math.sin(elapsedSeconds * (0.32 + index * 0.06) + index * 2.1) * params.swivelAmount
        : 0;
      destination.set(light.position.x + swivel, light.position.y + swivel * (index === 0 ? 0.35 : -0.25));
    } else {
      destination.copy(light.position);
    }
    uniforms.uLightTarget.value[index].copy(light.target);
    uniforms.uLightIntensity.value[index] = light.intensity;
    uniforms.uLightSpread.value[index] = light.spread;
  }
}

function normalizedPointer(clientX: number, clientY: number): THREE.Vector2 {
  return new THREE.Vector2(
    THREE.MathUtils.clamp((clientX - stageRect.left) / stageRect.width, 0.04, 0.96),
    THREE.MathUtils.clamp(1 - (clientY - stageRect.top) / stageRect.height, 0.05, 0.95),
  );
}

function distanceToLightInPixels(pointer: THREE.Vector2, light: Light): number {
  const dx = (pointer.x - light.position.x) * stageRect.width;
  const dy = (pointer.y - light.position.y) * stageRect.height;
  return Math.hypot(dx, dy);
}

function selectLight(pointer: THREE.Vector2): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < lights.length; index += 1) {
    const distance = distanceToLightInPixels(pointer, lights[index]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  if (nearestDistance <= 76) return nearestIndex;
  const nextIndex = alternateLight;
  alternateLight = (alternateLight + 1) % lights.length;
  return nextIndex;
}

function moveLight(index: number, pointer: THREE.Vector2): void {
  lights[index].position.copy(pointer);
}

function resetLights(): void {
  lights.forEach((light) => light.position.copy(light.initialPosition));
  activeLight = 0;
  alternateLight = 0;
}

function positionCursor(clientX: number, clientY: number): void {
  cursor.style.transform = `translate(${clientX}px, ${clientY}px) translate(-50%, -50%)`;
}

window.addEventListener('pointermove', (event) => {
  positionCursor(event.clientX, event.clientY);
  if (!dragging) return;
  moveLight(activeLight, normalizedPointer(event.clientX, event.clientY));
});

stage.addEventListener('pointerdown', (event) => {
  dragging = true;
  const pointer = normalizedPointer(event.clientX, event.clientY);
  activeLight = selectLight(pointer);
  moveLight(activeLight, pointer);
  stage.setPointerCapture(event.pointerId);
});

stage.addEventListener('pointerup', (event) => {
  dragging = false;
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
});

stage.addEventListener('pointercancel', () => {
  dragging = false;
});

stage.addEventListener('dblclick', resetLights);
window.addEventListener('blur', () => {
  dragging = false;
});

window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'r') resetLights();
});

infoToggle.addEventListener('click', () => {
  const open = infoToggle.getAttribute('aria-expanded') !== 'true';
  infoToggle.setAttribute('aria-expanded', String(open));
  infoPanel.setAttribute('aria-hidden', String(!open));
  infoPanel.classList.toggle('is-open', open);
});

const gui = exposeGuiInDebugMode(new GUI({ title: 'Refraction' }));
const compositionFolder = gui.addFolder('Composition');
compositionFolder.add(params, 'logoScale', 0.24, 0.65, 0.005).name('Logo scale').onChange(updateLogoRect);
compositionFolder.add(params, 'logoY', 0.35, 0.65, 0.005).name('Logo Y').onChange(updateLogoRect);
compositionFolder.add(params, 'ambientRays', 0, 1, 0.01).name('Ambient rays');
compositionFolder.add(params, 'grain', 0, 0.4, 0.005).name('Grain');

const opticsFolder = gui.addFolder('Optics');
opticsFolder.add(params, 'intensity', 0, 2.5, 0.01).name('Intensity');
opticsFolder.add(params, 'haze', 0, 1, 0.01).name('Haze');
opticsFolder.add(params, 'shadow', 0, 1, 0.01).name('Shadow');
opticsFolder.add(params, 'transmission', 0, 0.65, 0.01).name('Transmission');
opticsFolder.add(params, 'refraction', 0, 0.04, 0.0005).name('Refraction');
opticsFolder.add(params, 'dispersion', 0, 0.015, 0.00025).name('Dispersion');
opticsFolder.add(params, 'edgeGlow', 0, 2.5, 0.01).name('Edge glow');

const motionFolder = gui.addFolder('Motion');
motionFolder.add(params, 'autoSwivel').name('Auto swivel');
motionFolder.add(params, 'swivelAmount', 0, 0.06, 0.001).name('Swivel amount');

for (let index = 0; index < lights.length; index += 1) {
  const lightFolder = gui.addFolder(`Light ${index + 1}`);
  lightFolder.add(lights[index], 'intensity', 0, 2, 0.01).name('Intensity');
  lightFolder.add(lights[index], 'spread', 0.08, 0.55, 0.005).name('Spread');
}

function handleResize(): void {
  stageRect = stage.getBoundingClientRect();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(stageRect.width, stageRect.height, false);
  uniforms.uResolution.value.set(stageRect.width, stageRect.height);
  updateLogoRect();
}

let resizeTimer: number | undefined;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(handleResize, 80);
});
window.visualViewport?.addEventListener('resize', handleResize);

const clock = new THREE.Clock();
let fpsFrameCount = 0;
let fpsLastUpdate = performance.now();

function tick(): void {
  const elapsed = clock.getElapsedTime();
  syncUniforms(elapsed);
  renderer.render(scene, camera);

  fpsFrameCount += 1;
  const now = performance.now();
  if (now - fpsLastUpdate >= 500) {
    const fps = Math.round((fpsFrameCount * 1000) / (now - fpsLastUpdate));
    fpsEl.textContent = `${fps.toString().padStart(2, '0')} FPS`;
    fpsFrameCount = 0;
    fpsLastUpdate = now;
  }

  requestAnimationFrame(tick);
}

updateLogoRect();
tick();
