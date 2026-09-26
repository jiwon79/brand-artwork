/// <reference types="vite/client" />
import * as THREE from 'three';
import fragmentShader from './shader.frag?raw';
import { motionFrames } from './motion-data';

const canvas = document.querySelector<HTMLCanvasElement>('#artwork');
if (!canvas) throw new Error('Artwork canvas is missing');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const uniforms = {
  uResolution: { value: new THREE.Vector2(720, 720) },
  uFrame: { value: 0 },
  uTime: { value: 0 },
  uBody: { value: new THREE.Vector2(360, 360) },
  uMotionAtlas: { value: new THREE.Texture() },
  uAppearanceAtlas: { value: new THREE.Texture() },
};

const material = new THREE.ShaderMaterial({
  uniforms,
  depthTest: false,
  depthWrite: false,
  vertexShader: `
    void main() {
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader,
});

const scene = new THREE.Scene();
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
const camera = new THREE.Camera();

const params = new URLSearchParams(location.search);
const queryTime = Number(params.get('t'));
const frozenTime = params.has('t') && Number.isFinite(queryTime) ? Math.max(0, queryTime) : null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const startTime = performance.now();

function resize() {
  const width = Math.max(1, innerWidth);
  const height = Math.max(1, innerHeight);
  renderer.setSize(width, height, false);
  uniforms.uResolution.value.set(canvas!.width, canvas!.height);
  if (frozenTime !== null || reduceMotion) render(performance.now());
}

function render(now: number) {
  const seconds = frozenTime ?? (reduceMotion ? 2.25 : (now - startTime) / 1000);
  const frame = ((seconds * 24) % motionFrames.length + motionFrames.length) % motionFrames.length;
  const a = Math.floor(frame);
  const b = (a + 1) % motionFrames.length;
  const t = frame - a;
  const sample = (column: number) => THREE.MathUtils.lerp(motionFrames[a][column], motionFrames[b][column], t);
  uniforms.uFrame.value = frame;
  uniforms.uTime.value = seconds;
  uniforms.uBody.value.set(sample(0), sample(1));
  renderer.render(scene, camera);
  if (frozenTime === null && !reduceMotion) requestAnimationFrame(render);
}

const loader = new THREE.TextureLoader();
Promise.all([
  loader.loadAsync('./assets/motion-atlas.png'),
  loader.loadAsync('./assets/appearance-atlas.webp'),
]).then(([motion, appearance]) => {
  for (const texture of [motion, appearance]) {
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
  }
  uniforms.uMotionAtlas.value = motion;
  uniforms.uAppearanceAtlas.value = appearance;
  resize();
  requestAnimationFrame(render);
});
addEventListener('resize', resize);
