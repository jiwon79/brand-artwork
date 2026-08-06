import * as THREE from 'three';
import GUI from 'lil-gui';

const ART_WIDTH = 480;
const ART_HEIGHT = 600;
const BLUR_TAPS = 12;
const QA_MODE = new URLSearchParams(window.location.search).has('qa');

const canvas = document.getElementById('artwork') as HTMLCanvasElement;
const error = document.getElementById('error') as HTMLParagraphElement;

const state = {
  radiusX: 175,
  radiusY: 205,
  lightFalloff: 0.12,
  blurSigma: 8.5,
  blurStep: 1.40,
  threshold: 0.047,
  softness: 0.0075,
  densityRange: 0.105,
  hueBands: 0.30,
  colorCycle: 8.0,
  pointerEase: 13.5,
  fringe: 0.78,
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

const pointer: Pointer = { x: 0.37, y: 0.458 };
const pointerTarget: Pointer = { ...pointer };
let artworkRect = { left: 0, top: 0, width: ART_WIDTH, height: ART_HEIGHT };
let startTime = performance.now();
let previousTime = startTime;
let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const textCanvas = document.createElement('canvas');
textCanvas.width = ART_WIDTH;
textCanvas.height = ART_HEIGHT;
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

const renderTargetOptions: THREE.RenderTargetOptions = {
  depthBuffer: false,
  stencilBuffer: false,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
  colorSpace: THREE.NoColorSpace,
};

const sourceTarget = new THREE.WebGLRenderTarget(ART_WIDTH, ART_HEIGHT, renderTargetOptions);
const horizontalTarget = new THREE.WebGLRenderTarget(ART_WIDTH, ART_HEIGHT, renderTargetOptions);
const densityTarget = new THREE.WebGLRenderTarget(ART_WIDTH, ART_HEIGHT, renderTargetOptions);

const sourceMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uText;
    uniform vec2 uPointer;
    uniform vec2 uArtSize;
    uniform vec2 uRadius;
    uniform float uFalloff;

    void main() {
      float textMask = texture2D(uText, vUv).a;
      vec2 delta = (vUv - uPointer) * uArtSize;
      float verticalRatio = abs(delta.y) / max(uRadius.y, 0.001);
      float horizontalTaper = mix(1.0, 0.55, smoothstep(0.25, 0.85, verticalRatio));
      vec2 effectiveRadius = vec2(uRadius.x * horizontalTaper, uRadius.y);
      float normalizedDistance = length(delta / max(effectiveRadius, vec2(0.001)));
      float light = 1.0 - smoothstep(uFalloff, 1.0, normalizedDistance);
      light *= smoothstep(1.04, 0.84, normalizedDistance);
      float excitedInk = textMask * pow(max(light, 0.0), 1.22);
      gl_FragColor = vec4(vec3(excitedInk), 1.0);
    }
  `,
  uniforms: {
    uText: { value: textTexture },
    uPointer: { value: new THREE.Vector2(pointer.x, pointer.y) },
    uArtSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uRadius: { value: new THREE.Vector2(state.radiusX, state.radiusY) },
    uFalloff: { value: state.lightFalloff },
  },
  depthTest: false,
  depthWrite: false,
});

const blurMaterial = new THREE.ShaderMaterial({
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
      float density = 0.0;

      for (int index = -${BLUR_TAPS}; index <= ${BLUR_TAPS}; index++) {
        float offsetIndex = float(index);
        float sampleDistance = offsetIndex * uStep;
        float weight = exp(-0.5 * sampleDistance * sampleDistance / sigmaSquared);
        density += texture2D(uInput, vUv + uDirection * sampleDistance).r * weight;
        totalWeight += weight;
      }

      density /= max(totalWeight, 0.001);
      gl_FragColor = vec4(vec3(density), 1.0);
    }
  `,
  uniforms: {
    uInput: { value: sourceTarget.texture },
    uDirection: { value: new THREE.Vector2(1 / ART_WIDTH, 0) },
    uSigma: { value: state.blurSigma },
    uStep: { value: state.blurStep },
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
    uniform sampler2D uExcited;
    uniform sampler2D uDensity;
    uniform vec2 uResolution;
    uniform vec2 uPosterOffset;
    uniform vec2 uPosterSize;
    uniform float uThreshold;
    uniform float uSoftness;
    uniform float uDensityRange;
    uniform float uHueBands;
    uniform float uTime;
    uniform float uColorCycle;
    uniform float uFringe;

    vec3 hsvToRgb(vec3 hsv) {
      vec3 rgb = clamp(abs(mod(hsv.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      rgb = rgb * rgb * (3.0 - 2.0 * rgb);
      return hsv.z * mix(vec3(1.0), rgb, hsv.y);
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
      float excitedInk = texture2D(uExcited, artUv).r;
      float density = texture2D(uDensity, artUv).r;
      vec3 base = mix(background, vec3(0.155, 0.153, 0.148), textMask * 0.92);

      float alpha = smoothstep(uThreshold - uSoftness, uThreshold + uSoftness, density);
      float fringeAlpha = smoothstep(uThreshold * 0.54, uThreshold, density) * (1.0 - alpha);
      float normalizedDensity = clamp((density - uThreshold) / max(uDensityRange, 0.001), 0.0, 1.0);

      float cycle = max(uColorCycle, 0.1);
      float palettePhase = fract(0.84 + uTime / cycle);
      float bandProgress = smoothstep(0.08, 0.78, normalizedDensity);
      float hue = fract(palettePhase + bandProgress * uHueBands);
      float saturation = mix(0.38, 0.76, smoothstep(0.58, 1.0, normalizedDensity));
      vec3 goo = hsvToRgb(vec3(hue, saturation, 1.0));
      float hotStrength = smoothstep(0.92, 1.0, normalizedDensity);
      vec3 hotColor = hsvToRgb(vec3(fract(palettePhase + 0.025), 0.68, 1.0));
      goo = mix(goo, hotColor, hotStrength);

      float fringeHue = fract(palettePhase - 0.075);
      vec3 fringeColor = hsvToRgb(vec3(fringeHue, 0.76, 0.84));
      vec3 withFringe = mix(base, fringeColor, fringeAlpha * uFringe);
      float strokeAlpha = smoothstep(0.10, 0.48, excitedInk) * (1.0 - alpha);
      vec3 strokeColor = hsvToRgb(vec3(fract(palettePhase + 0.62), 0.82, 0.86));
      vec3 withStrokes = mix(withFringe, strokeColor, strokeAlpha * 0.88);
      vec3 result = mix(withStrokes, goo, alpha);

      gl_FragColor = vec4(result, 1.0);
    }
  `,
  uniforms: {
    uText: { value: textTexture },
    uExcited: { value: sourceTarget.texture },
    uDensity: { value: densityTarget.texture },
    uResolution: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uPosterOffset: { value: new THREE.Vector2(0, 0) },
    uPosterSize: { value: new THREE.Vector2(ART_WIDTH, ART_HEIGHT) },
    uThreshold: { value: state.threshold },
    uSoftness: { value: state.softness },
    uDensityRange: { value: state.densityRange },
    uHueBands: { value: state.hueBands },
    uTime: { value: 0 },
    uColorCycle: { value: state.colorCycle },
    uFringe: { value: state.fringe },
  },
  depthTest: false,
  depthWrite: false,
});

const passScene = new THREE.Scene();
const passQuad = new THREE.Mesh(geometry, sourceMaterial);
passScene.add(passQuad);

function renderPass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
  passQuad.material = material;
  renderer.setRenderTarget(target);
  renderer.render(passScene, camera);
}

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

function setPointerFromClient(clientX: number, clientY: number, snap = false): void {
  const x = THREE.MathUtils.clamp((clientX - artworkRect.left) / artworkRect.width, 0, 1);
  const yFromTop = THREE.MathUtils.clamp((clientY - artworkRect.top) / artworkRect.height, 0, 1);
  pointerTarget.x = x;
  pointerTarget.y = 1 - yFromTop;
  if (snap) {
    pointer.x = pointerTarget.x;
    pointer.y = pointerTarget.y;
  }
}

window.addEventListener('pointermove', (event) => {
  setPointerFromClient(event.clientX, event.clientY);
}, { passive: true });

window.addEventListener('pointerdown', (event) => {
  setPointerFromClient(event.clientX, event.clientY, true);
}, { passive: true });

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
  gui.add(state, 'lightFalloff', 0.15, 0.95, 0.01).onChange((value: number) => {
    sourceMaterial.uniforms.uFalloff.value = value;
  });
  gui.add(state, 'blurSigma', 2, 18, 0.1).onChange((value: number) => {
    blurMaterial.uniforms.uSigma.value = value;
  });
  gui.add(state, 'blurStep', 0.5, 2.4, 0.05).onChange((value: number) => {
    blurMaterial.uniforms.uStep.value = value;
  });
  gui.add(state, 'threshold', 0.005, 0.12, 0.001).onChange((value: number) => {
    finalMaterial.uniforms.uThreshold.value = value;
  });
  gui.add(state, 'softness', 0.001, 0.04, 0.001).onChange((value: number) => {
    finalMaterial.uniforms.uSoftness.value = value;
  });
  gui.add(state, 'densityRange', 0.02, 0.18, 0.002).onChange((value: number) => {
    finalMaterial.uniforms.uDensityRange.value = value;
  });
  gui.add(state, 'hueBands', 0.1, 0.8, 0.01).onChange((value: number) => {
    finalMaterial.uniforms.uHueBands.value = value;
  });
  gui.add(state, 'colorCycle', 2, 20, 0.1).onChange((value: number) => {
    finalMaterial.uniforms.uColorCycle.value = value;
  });
  gui.add(state, 'fringe', 0, 1, 0.01).onChange((value: number) => {
    finalMaterial.uniforms.uFringe.value = value;
  });
  gui.add(state, 'pointerEase', 1, 30, 0.5);
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
  pointer.x += (pointerTarget.x - pointer.x) * ease;
  pointer.y += (pointerTarget.y - pointer.y) * ease;

  sourceMaterial.uniforms.uPointer.value.set(pointer.x, pointer.y);

  renderPass(sourceMaterial, sourceTarget);
  blurMaterial.uniforms.uInput.value = sourceTarget.texture;
  blurMaterial.uniforms.uDirection.value.set(1 / ART_WIDTH, 0);
  renderPass(blurMaterial, horizontalTarget);
  blurMaterial.uniforms.uInput.value = horizontalTarget.texture;
  blurMaterial.uniforms.uDirection.value.set(0, 1 / ART_HEIGHT);
  renderPass(blurMaterial, densityTarget);

  const elapsed = reduceMotion || QA_MODE ? 0 : (now - startTime) / 1000;
  finalMaterial.uniforms.uTime.value = elapsed;
  renderPass(finalMaterial, null);

  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
