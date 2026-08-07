import * as THREE from 'three';
import GUI from 'lil-gui';

const ART_WIDTH = 480;
const ART_HEIGHT = 600;
const TEXTURE_SCALE = 3;
const FIELD_WIDTH = ART_WIDTH;
const FIELD_HEIGHT = ART_HEIGHT;
const COLOR_BLUR_TAPS = 12;
// Coverage stops at 10.2 artwork pixels, so a local 16→1 flood is sufficient.
const JFA_JUMPS = [16, 8, 4, 2, 1, 1];
const searchParams = new URLSearchParams(window.location.search);
const QA_MODE = searchParams.has('qa');
const qaPointerX = Number(searchParams.get('qaX'));
const qaPointerY = Number(searchParams.get('qaY'));
const QA_POINTER_LOCKED = searchParams.has('qaX')
  && searchParams.has('qaY')
  && Number.isFinite(qaPointerX)
  && Number.isFinite(qaPointerY);

const canvas = document.getElementById('artwork') as HTMLCanvasElement;
const error = document.getElementById('error') as HTMLParagraphElement;

const state = {
  radiusX: 175,
  radiusY: 155,
  radiusYBelow: 180,
  lightFalloff: 0.12,
  seedThreshold: 0.085,
  bodyRadius: 13.4,
  rimWidth: 3.6,
  colorBlurSigma: 6.0,
  colorBlurStep: 1.0,
  colorFloor: 0.055,
  colorRange: 0.64,
  hueBands: 0.31,
  colorCycle: 8.0,
  pointerEase: 4.3,
  pointerMaxSpeed: 300,
  activationAttack: 0.055,
  activationRelease: 0.34,
};

const lines = [
  'COLOR',
  'CHANGES',
  'EVERYTHING',
  'DEPENDING',
  'ON',
  'THE LIGHT',
  'THAT',
  'TOUCHES',
  'IT',
];

type Pointer = { x: number; y: number };

const initialPointer = {
  x: QA_POINTER_LOCKED ? THREE.MathUtils.clamp(qaPointerX, 0, 1) : 0.37,
  y: QA_POINTER_LOCKED ? THREE.MathUtils.clamp(qaPointerY, 0, 1) : 0.458,
};
const pointer: Pointer = { ...initialPointer };
const pointerTarget: Pointer = { ...pointer };
let artworkRect = { left: 0, top: 0, width: ART_WIDTH, height: ART_HEIGHT };
let startTime = performance.now();
let previousTime = startTime;
let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const textCanvas = document.createElement('canvas');
textCanvas.width = ART_WIDTH * TEXTURE_SCALE;
textCanvas.height = ART_HEIGHT * TEXTURE_SCALE;
const textContext = textCanvas.getContext('2d', { alpha: true });
if (!textContext) throw new Error('Unable to create the text mask.');

function drawTrackedLine(
  context: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  advance: number,
): void {
  const startX = centerX - ((text.length - 1) * advance) / 2;
  for (let index = 0; index < text.length; index += 1) {
    context.fillText(text[index], startX + index * advance, centerY);
  }
}

function bakeTextMask(): void {
  textContext.setTransform(TEXTURE_SCALE, 0, 0, TEXTURE_SCALE, 0, 0);
  textContext.clearRect(0, 0, ART_WIDTH, ART_HEIGHT);
  textContext.save();
  textContext.fillStyle = '#ffffff';
  textContext.font = '300 43px "Helvetica Neue", "Arial", sans-serif';
  textContext.textAlign = 'center';
  textContext.textBaseline = 'middle';
  const firstLineY = 132;
  const lineHeight = 42.2;
  const characterAdvance = 31.8;
  lines.forEach((line, index) => {
    drawTrackedLine(textContext, line, ART_WIDTH / 2, firstLineY + index * lineHeight, characterAdvance);
  });
  textContext.restore();
}

bakeTextMask();

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  });
} catch (caught) {
  error.classList.add('visible');
  throw caught;
}

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xfbfbfa, 1);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const geometry = new THREE.PlaneGeometry(2, 2);

const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const textTexture = new THREE.CanvasTexture(textCanvas);
textTexture.colorSpace = THREE.NoColorSpace;
textTexture.minFilter = THREE.LinearFilter;
textTexture.magFilter = THREE.LinearFilter;
textTexture.generateMipmaps = false;

const linearTargetOptions: THREE.RenderTargetOptions = {
  depthBuffer: false,
  stencilBuffer: false,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: THREE.HalfFloatType,
  colorSpace: THREE.NoColorSpace,
};

const nearestTargetOptions: THREE.RenderTargetOptions = {
  ...linearTargetOptions,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
};

const sourceTarget = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const historyTargetA = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const historyTargetB = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const colorHorizontalTarget = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const colorFieldTarget = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, linearTargetOptions);
const nearestTargetA = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, nearestTargetOptions);
const nearestTargetB = new THREE.WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, nearestTargetOptions);

const sourceMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uText;
    uniform vec2 uPointer;
    uniform vec2 uArtSize;
    uniform vec2 uRadius;
    uniform float uRadiusYBelow;
    uniform float uFalloff;

    void main() {
      float textMask = texture2D(uText, vUv).a;
      vec2 delta = (vUv - uPointer) * uArtSize;
      float verticalRadius = delta.y < 0.0 ? uRadiusYBelow : uRadius.y;
      float verticalRatio = abs(delta.y) / max(verticalRadius, 0.001);
      float horizontalTaper = mix(1.0, 0.55, smoothstep(0.25, 0.85, verticalRatio));
      vec2 effectiveRadius = vec2(uRadius.x * horizontalTaper, verticalRadius);
      float normalizedDistance = length(delta / max(effectiveRadius, vec2(0.001)));
      float light = 1.0 - smoothstep(uFalloff, 1.0, normalizedDistance);
      light *= smoothstep(1.04, 0.84, normalizedDistance);
      float excitedInk = textMask * pow(max(light, 0.0), 1.22);
      gl_FragColor = vec4(excitedInk, textMask, 0.0, 1.0);
    }
  `,
  uniforms: {
    uText: { value: textTexture },
    uPointer: { value: new THREE.Vector2(pointer.x, pointer.y) },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uRadius: { value: new THREE.Vector2(state.radiusX, state.radiusY) },
    uRadiusYBelow: { value: state.radiusYBelow },
    uFalloff: { value: state.lightFalloff },
  },
  depthTest: false,
  depthWrite: false,
});

const temporalMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uCurrent;
    uniform sampler2D uHistory;
    uniform float uAttackBlend;
    uniform float uReleaseBlend;

    void main() {
      float currentInk = texture2D(uCurrent, vUv).r;
      vec4 history = texture2D(uHistory, vUv);
      float blendAmount = currentInk > history.r ? uAttackBlend : uReleaseBlend;
      float activation = mix(history.r, currentInk, blendAmount);
      float textMask = texture2D(uCurrent, vUv).g;
      gl_FragColor = vec4(activation * step(0.001, textMask), textMask, 0.0, 1.0);
    }
  `,
  uniforms: {
    uCurrent: { value: sourceTarget.texture },
    uHistory: { value: historyTargetA.texture },
    uAttackBlend: { value: 1 },
    uReleaseBlend: { value: 1 },
  },
  depthTest: false,
  depthWrite: false,
});

const colorBlurMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uInput;
    uniform vec2 uDirection;
    uniform float uSigma;
    uniform float uStep;

    void main() {
      float sigmaSquared = max(uSigma * uSigma, 0.001);
      float totalWeight = 0.0;
      vec2 colorField = vec2(0.0);

      for (int index = -${COLOR_BLUR_TAPS}; index <= ${COLOR_BLUR_TAPS}; index++) {
        float offsetIndex = float(index);
        float sampleDistance = offsetIndex * uStep;
        float weight = exp(-0.5 * sampleDistance * sampleDistance / sigmaSquared);
        colorField += texture2D(uInput, vUv + uDirection * sampleDistance).rg * weight;
        totalWeight += weight;
      }

      colorField /= max(totalWeight, 0.001);
      gl_FragColor = vec4(colorField, 0.0, 1.0);
    }
  `,
  uniforms: {
    uInput: { value: sourceTarget.texture },
    uDirection: { value: new THREE.Vector2(1 / ART_WIDTH, 0) },
    uSigma: { value: state.colorBlurSigma },
    uStep: { value: state.colorBlurStep },
  },
  depthTest: false,
  depthWrite: false,
});

const nearestSeedMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uActivation;
    uniform float uSeedThreshold;

    void main() {
      vec2 field = texture2D(uActivation, vUv).rg;
      float valid = step(uSeedThreshold, field.r) * step(0.18, field.g);
      gl_FragColor = valid > 0.5
        ? vec4(vUv, field.r, 1.0)
        : vec4(0.0);
    }
  `,
  uniforms: {
    uActivation: { value: historyTargetA.texture },
    uSeedThreshold: { value: state.seedThreshold },
  },
  depthTest: false,
  depthWrite: false,
});

const jumpFloodMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uNearest;
    uniform vec2 uFieldSize;
    uniform float uJump;

    void main() {
      vec4 best = texture2D(uNearest, vUv);
      float bestDistance = best.a > 0.5
        ? dot((best.xy - vUv) * uFieldSize, (best.xy - vUv) * uFieldSize)
        : 1.0e20;

      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 sampleUv = vUv + vec2(float(x), float(y)) * uJump / uFieldSize;
          if (sampleUv.x >= 0.0 && sampleUv.x <= 1.0 && sampleUv.y >= 0.0 && sampleUv.y <= 1.0) {
            vec4 candidate = texture2D(uNearest, sampleUv);
            vec2 delta = (candidate.xy - vUv) * uFieldSize;
            float candidateDistance = dot(delta, delta);
            if (candidate.a > 0.5 && candidateDistance < bestDistance) {
              best = candidate;
              bestDistance = candidateDistance;
            }
          }
        }
      }

      gl_FragColor = best;
    }
  `,
  uniforms: {
    uNearest: { value: nearestTargetA.texture },
    uFieldSize: { value: new THREE.Vector2(FIELD_WIDTH, FIELD_HEIGHT) },
    uJump: { value: JFA_JUMPS[0] },
  },
  depthTest: false,
  depthWrite: false,
});

const finalMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uText;
    uniform sampler2D uNearest;
    uniform sampler2D uColorField;
    uniform vec2 uResolution;
    uniform vec2 uPosterOffset;
    uniform vec2 uPosterSize;
    uniform vec2 uArtSize;
    uniform float uBodyRadius;
    uniform float uRimWidth;
    uniform float uColorFloor;
    uniform float uColorRange;
    uniform float uHueBands;
    uniform float uTime;
    uniform float uColorCycle;

    vec3 hsvToRgb(vec3 hsv) {
      vec3 rgb = clamp(abs(mod(hsv.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      rgb = rgb * rgb * (3.0 - 2.0 * rgb);
      return hsv.z * mix(vec3(1.0), rgb, hsv.y);
    }

    float interleavedGradientNoise(vec2 pixel) {
      return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
    }

    float coverageAt(vec2 sampleUv) {
      if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) {
        return 0.0;
      }
      vec4 sampleNearest = texture2D(uNearest, sampleUv);
      if (sampleNearest.a < 0.5) return 0.0;
      float sampleDistance = length((sampleUv - sampleNearest.xy) * uArtSize);
      return 1.0 - smoothstep(uBodyRadius - 1.1, uBodyRadius + 1.1, sampleDistance);
    }

    void main() {
      vec2 fragment = vUv * uResolution;
      vec2 artUv = (fragment - uPosterOffset) / uPosterSize;
      vec3 background = vec3(0.9843, 0.9843, 0.9804);

      if (artUv.x < 0.0 || artUv.x > 1.0 || artUv.y < 0.0 || artUv.y > 1.0) {
        gl_FragColor = vec4(background, 1.0);
        return;
      }

      float textMask = texture2D(uText, artUv).a;
      vec4 nearest = texture2D(uNearest, artUv);
      float coverage = 0.0;
      float rimMix = 0.0;
      float colorEnergy = 0.0;
      float strokeDensity = 0.0;
      float distanceToStroke = uBodyRadius + 2.0;

      if (nearest.a > 0.5) {
        distanceToStroke = length((artUv - nearest.xy) * uArtSize);
        vec2 blurredField = texture2D(uColorField, artUv).rg;
        colorEnergy = blurredField.r / max(blurredField.g, 0.004);
        strokeDensity = blurredField.g;
        float antialiasWidth = max(1.55, fwidth(distanceToStroke) * 1.28);
        coverage = 1.0 - smoothstep(
          uBodyRadius - antialiasWidth,
          uBodyRadius + antialiasWidth,
          distanceToStroke
        );
        vec2 rimStep = vec2(uRimWidth) / uArtSize;
        float erodedCoverage = 1.0;
        erodedCoverage = min(erodedCoverage, coverageAt(artUv + vec2( rimStep.x, 0.0)));
        erodedCoverage = min(erodedCoverage, coverageAt(artUv + vec2(-rimStep.x, 0.0)));
        erodedCoverage = min(erodedCoverage, coverageAt(artUv + vec2(0.0,  rimStep.y)));
        erodedCoverage = min(erodedCoverage, coverageAt(artUv + vec2(0.0, -rimStep.y)));
        erodedCoverage = min(erodedCoverage, coverageAt(artUv + vec2( rimStep.x,  rimStep.y) * 0.7071));
        erodedCoverage = min(erodedCoverage, coverageAt(artUv + vec2(-rimStep.x,  rimStep.y) * 0.7071));
        erodedCoverage = min(erodedCoverage, coverageAt(artUv + vec2( rimStep.x, -rimStep.y) * 0.7071));
        erodedCoverage = min(erodedCoverage, coverageAt(artUv + vec2(-rimStep.x, -rimStep.y) * 0.7071));
        rimMix = 1.0 - smoothstep(0.08, 0.92, erodedCoverage);
      }

      float visibleText = textMask * 0.92 * (1.0 - coverage);
      vec3 base = mix(background, vec3(0.155, 0.153, 0.148), visibleText);

      float cycle = max(uColorCycle, 0.1);
      float palettePhase = fract(0.84 + uTime / cycle);
      float normalizedEnergy = clamp(
        (colorEnergy - uColorFloor) / max(uColorRange, 0.001),
        0.0,
        1.0
      );
      float strokeCarrier = smoothstep(0.025, 0.16, strokeDensity);
      float fineOffset = distanceToStroke / 3.8;
      float fineCarrier = exp(-0.5 * fineOffset * fineOffset);
      float combinedCarrier = mix(strokeCarrier, fineCarrier, 0.16);
      float transportedEnergy = normalizedEnergy * mix(0.22, 1.0, combinedCarrier);
      float bandProgress = smoothstep(0.02, 0.96, transportedEnergy);
      float hueOffset = mix(-0.25, uHueBands, bandProgress);
      float hue = fract(palettePhase + hueOffset);
      float middleOffset = (transportedEnergy - 0.34) / 0.20;
      float middleWash = exp(-(middleOffset * middleOffset));
      float saturation = mix(0.48, 0.80, smoothstep(0.35, 1.0, transportedEnergy));
      saturation *= 1.0 - middleWash * 0.55;
      vec3 goo = hsvToRgb(vec3(hue, saturation, 1.0));
      float hotStrength = smoothstep(0.78, 1.0, transportedEnergy);
      vec3 hotColor = hsvToRgb(vec3(fract(palettePhase + 0.025), 0.68, 1.0));
      goo = mix(goo, hotColor, hotStrength * 0.12);

      vec3 rimColor = hsvToRgb(vec3(fract(palettePhase + 0.10), 0.88, 0.62));
      vec3 strokeColor = mix(goo, rimColor, rimMix);
      vec3 result = mix(base, strokeColor, coverage);
      float dither = (interleavedGradientNoise(fragment) - 0.5) / 255.0;
      result += vec3(dither * coverage * 0.45);

      gl_FragColor = vec4(result, 1.0);
    }
  `,
  uniforms: {
    uText: { value: textTexture },
    uNearest: { value: nearestTargetA.texture },
    uColorField: { value: colorFieldTarget.texture },
    uResolution: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uPosterOffset: { value: new THREE.Vector2(0, 0) },
    uPosterSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uBodyRadius: { value: state.bodyRadius },
    uRimWidth: { value: state.rimWidth },
    uColorFloor: { value: state.colorFloor },
    uColorRange: { value: state.colorRange },
    uHueBands: { value: state.hueBands },
    uTime: { value: 0 },
    uColorCycle: { value: state.colorCycle },
  },
  depthTest: false,
  depthWrite: false,
});

const passScene = new THREE.Scene();
const passQuad = new THREE.Mesh(geometry, sourceMaterial);
passScene.add(passQuad);
let historyRead = historyTargetA;
let historyWrite = historyTargetB;
let nearestRead = nearestTargetA;
let nearestWrite = nearestTargetB;

function renderPass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
  passQuad.material = material;
  renderer.setRenderTarget(target);
  renderer.render(passScene, camera);
}

function clearTarget(target: THREE.WebGLRenderTarget): void {
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
}

clearTarget(historyTargetA);
clearTarget(historyTargetB);
clearTarget(nearestTargetA);
clearTarget(nearestTargetB);
renderer.setClearColor(0xfbfbfa, 1);
renderer.setRenderTarget(null);

function updateLayout(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);

  const cssScale = Math.min(width / ART_WIDTH, height / ART_HEIGHT);
  const cssWidth = ART_WIDTH * cssScale;
  const cssHeight = ART_HEIGHT * cssScale;
  artworkRect = {
    left: (width - cssWidth) / 2,
    top: (height - cssHeight) / 2,
    width: cssWidth,
    height: cssHeight,
  };

  const drawingSize = new THREE.Vector2();
  renderer.getDrawingBufferSize(drawingSize);
  const drawingScale = Math.min(drawingSize.x / ART_WIDTH, drawingSize.y / ART_HEIGHT);
  const posterWidth = ART_WIDTH * drawingScale;
  const posterHeight = ART_HEIGHT * drawingScale;
  finalMaterial.uniforms.uResolution.value.set(drawingSize.x, drawingSize.y);
  finalMaterial.uniforms.uPosterOffset.value.set(
    (drawingSize.x - posterWidth) / 2,
    (drawingSize.y - posterHeight) / 2,
  );
  finalMaterial.uniforms.uPosterSize.value.set(posterWidth, posterHeight);
}

function setPointerFromClient(clientX: number, clientY: number): void {
  const x = THREE.MathUtils.clamp((clientX - artworkRect.left) / artworkRect.width, 0, 1);
  const yFromTop = THREE.MathUtils.clamp((clientY - artworkRect.top) / artworkRect.height, 0, 1);
  pointerTarget.x = x;
  pointerTarget.y = 1 - yFromTop;
}

if (!QA_POINTER_LOCKED) {
  window.addEventListener('pointermove', (event) => {
    setPointerFromClient(event.clientX, event.clientY);
  }, { passive: true });

  window.addEventListener('pointerdown', (event) => {
    setPointerFromClient(event.clientX, event.clientY);
  }, { passive: true });
}

window.addEventListener('resize', updateLayout);
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
  reduceMotion = event.matches;
});

function bindGui(): void {
  const gui = new GUI({ title: 'Light field' });
  gui.add(state, 'radiusX', 70, 230, 1).onChange((value: number) => {
    sourceMaterial.uniforms.uRadius.value.x = value;
  });
  gui.add(state, 'radiusY', 70, 230, 1).onChange((value: number) => {
    sourceMaterial.uniforms.uRadius.value.y = value;
  });
  gui.add(state, 'radiusYBelow', 70, 250, 1).onChange((value: number) => {
    sourceMaterial.uniforms.uRadiusYBelow.value = value;
  });
  gui.add(state, 'lightFalloff', 0.15, 0.95, 0.01).onChange((value: number) => {
    sourceMaterial.uniforms.uFalloff.value = value;
  });
  gui.add(state, 'seedThreshold', 0.01, 0.30, 0.005).onChange((value: number) => {
    nearestSeedMaterial.uniforms.uSeedThreshold.value = value;
  });
  gui.add(state, 'bodyRadius', 4, 24, 0.1).onChange((value: number) => {
    finalMaterial.uniforms.uBodyRadius.value = value;
  });
  gui.add(state, 'rimWidth', 0.5, 6, 0.1).onChange((value: number) => {
    finalMaterial.uniforms.uRimWidth.value = value;
  });
  gui.add(state, 'colorBlurSigma', 0.5, 12, 0.1).onChange((value: number) => {
    colorBlurMaterial.uniforms.uSigma.value = value;
  });
  gui.add(state, 'colorBlurStep', 0.5, 2, 0.05).onChange((value: number) => {
    colorBlurMaterial.uniforms.uStep.value = value;
  });
  gui.add(state, 'colorFloor', 0, 0.3, 0.005).onChange((value: number) => {
    finalMaterial.uniforms.uColorFloor.value = value;
  });
  gui.add(state, 'colorRange', 0.1, 1, 0.01).onChange((value: number) => {
    finalMaterial.uniforms.uColorRange.value = value;
  });
  gui.add(state, 'hueBands', 0.1, 0.8, 0.01).onChange((value: number) => {
    finalMaterial.uniforms.uHueBands.value = value;
  });
  gui.add(state, 'colorCycle', 2, 20, 0.1).onChange((value: number) => {
    finalMaterial.uniforms.uColorCycle.value = value;
  });
  gui.add(state, 'pointerEase', 1, 16, 0.1);
  gui.add(state, 'pointerMaxSpeed', 80, 720, 10);
  gui.add(state, 'activationAttack', 0.01, 0.3, 0.005);
  gui.add(state, 'activationRelease', 0.08, 1.2, 0.01);
  gui.hide();

  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'g') gui.show(gui.domElement.style.display === 'none');
  });
}

bindGui();
updateLayout();

function animate(now: number): void {
  const delta = Math.min((now - previousTime) / 1000, 0.1);
  previousTime = now;
  const ease = 1 - Math.exp(-state.pointerEase * delta);
  const pointerDeltaX = pointerTarget.x - pointer.x;
  const pointerDeltaY = pointerTarget.y - pointer.y;
  const distanceInArtworkPixels = Math.hypot(
    pointerDeltaX * ART_WIDTH,
    pointerDeltaY * ART_HEIGHT,
  );
  if (distanceInArtworkPixels > 0.001) {
    const easedDistance = distanceInArtworkPixels * ease;
    const cappedDistance = Math.min(easedDistance, state.pointerMaxSpeed * delta);
    const pointerStep = cappedDistance / distanceInArtworkPixels;
    pointer.x += pointerDeltaX * pointerStep;
    pointer.y += pointerDeltaY * pointerStep;
  }

  sourceMaterial.uniforms.uPointer.value.set(pointer.x, pointer.y);

  renderPass(sourceMaterial, sourceTarget);
  temporalMaterial.uniforms.uCurrent.value = sourceTarget.texture;
  temporalMaterial.uniforms.uHistory.value = historyRead.texture;
  temporalMaterial.uniforms.uAttackBlend.value = 1 - Math.exp(-delta / state.activationAttack);
  temporalMaterial.uniforms.uReleaseBlend.value = 1 - Math.exp(-delta / state.activationRelease);
  renderPass(temporalMaterial, historyWrite);
  [historyRead, historyWrite] = [historyWrite, historyRead];

  colorBlurMaterial.uniforms.uInput.value = historyRead.texture;
  colorBlurMaterial.uniforms.uDirection.value.set(1 / FIELD_WIDTH, 0);
  renderPass(colorBlurMaterial, colorHorizontalTarget);
  colorBlurMaterial.uniforms.uInput.value = colorHorizontalTarget.texture;
  colorBlurMaterial.uniforms.uDirection.value.set(0, 1 / FIELD_HEIGHT);
  renderPass(colorBlurMaterial, colorFieldTarget);

  nearestSeedMaterial.uniforms.uActivation.value = historyRead.texture;
  renderPass(nearestSeedMaterial, nearestTargetA);
  nearestRead = nearestTargetA;
  nearestWrite = nearestTargetB;
  for (const jump of JFA_JUMPS) {
    jumpFloodMaterial.uniforms.uNearest.value = nearestRead.texture;
    jumpFloodMaterial.uniforms.uJump.value = jump;
    renderPass(jumpFloodMaterial, nearestWrite);
    [nearestRead, nearestWrite] = [nearestWrite, nearestRead];
  }

  const elapsed = reduceMotion || QA_MODE ? 0 : (now - startTime) / 1000;
  finalMaterial.uniforms.uTime.value = elapsed;
  finalMaterial.uniforms.uNearest.value = nearestRead.texture;
  finalMaterial.uniforms.uColorField.value = colorFieldTarget.texture;
  renderPass(finalMaterial, null);

  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
