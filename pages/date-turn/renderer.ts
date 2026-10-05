/// <reference types="vite/client" />
import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { FIELD_SPAN, createGlyphTexture } from './glyph-texture';
import { inkInsets, motionPose, TRANSITION_DURATION } from './motion';
import volumeFragment from './volume.frag?raw';
import outlineFragment from './outline.frag?raw';

export const DEFAULTS = {
  first: '14', second: '09', third: '26', font: 'Arial Black', size: 1, sensitivity: 0.8, speed: 1,
  transition: TRANSITION_DURATION, sway: 32, tilt: 13, dragResponse: 0.065,
  playing: true, numberColor: '#0000ff', lineColor: '#0000ff', sideColor: '#ffffff',
  background: '#fdfdfd', lineWidth: 2, padding: 0.12, bounce: 0.62,
  inspectMode: 0, inspectPart: 0, inspectGlyphs: true, inspectHousing: true,
  inspectGrid: true, inspectHidden: true, inspectZoom: 1.6,
};
export type Settings = typeof DEFAULTS;

export function createRenderer(canvas: HTMLCanvasElement, settings: Settings) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const glyphs = [settings.first, settings.second, settings.third].map(text => createGlyphTexture(text, settings.font));
  const source = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const outlined = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const vertexShader = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const uniforms = {
    face0: { value: glyphs[0] }, face1: { value: glyphs[1] }, face2: { value: glyphs[2] },
    inverseRotation: { value: new THREE.Matrix3() }, viewSize: { value: new THREE.Vector2() },
    objectScale: { value: settings.size }, bounce: { value: 0 }, apothem: { value: 0.67 },
    padding: { value: settings.padding }, fieldSpan: { value: FIELD_SPAN },
    inkInset: { value: new THREE.Vector3() },
    numberColor: { value: new THREE.Color(settings.numberColor) }, sideColor: { value: new THREE.Color(settings.sideColor) },
    inspectMode: { value: 0 }, inspectPart: { value: 0 },
    inspectPixelWidth: { value: 0.005 },
    inspectLayers: { value: new THREE.Vector4() }, inspectBackground: { value: new THREE.Color(settings.background) },
  };
  const volume = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader: volumeFragment, depthTest: false, depthWrite: false });
  const outline = new THREE.ShaderMaterial({
    vertexShader, fragmentShader: outlineFragment, depthTest: false, depthWrite: false,
    uniforms: {
      image: { value: source.texture }, pixelSize: { value: new THREE.Vector2() },
      lineWidth: { value: settings.lineWidth }, lineColor: { value: new THREE.Color(settings.lineColor) },
      backgroundColor: { value: new THREE.Color(settings.background) },
    },
  });
  const antialias = new THREE.ShaderMaterial({
    ...FXAAShader, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), depthTest: false, depthWrite: false,
    fragmentShader: FXAAShader.fragmentShader.replace(/\n\t\t}\s*$/, '\n#include <colorspace_fragment>\n}\n'),
  });
  antialias.uniforms.tDiffuse.value = outlined.texture;
  const geometry = new THREE.PlaneGeometry(2, 2);
  const plane = new THREE.Mesh(geometry, volume);
  const scene = new THREE.Scene();
  scene.add(plane);
  const camera = new THREE.Camera();
  const rotation = new THREE.Matrix4();
  const euler = new THREE.Euler();
  let pixelRatio = 1;
  let inspectionOffset = 0;
  let inspectionFit = 1;

  function draw(time: number, pitch: number, yaw: number) {
    const inspecting = settings.inspectMode > 0;
    const pose = motionPose(time, settings.transition, inspecting ? 0 : settings.sway, inspecting ? 0 : settings.tilt);
    pose.pitch += pitch;
    pose.yaw += yaw;
    euler.set(pose.pitch, pose.yaw, pose.roll, 'ZYX');
    rotation.makeRotationFromEuler(euler).invert();
    uniforms.inverseRotation.value.setFromMatrix4(rotation);
    uniforms.bounce.value = inspecting ? -inspectionOffset : settings.bounce * pose.height;
    const insets = inkInsets(time);
    uniforms.inkInset.value.set(
      insets[0] * glyphs[0].userData.inkScale,
      insets[1] * glyphs[1].userData.inkScale,
      insets[2] * glyphs[2].userData.inkScale,
    );
    uniforms.objectScale.value = settings.size * (inspecting ? settings.inspectZoom * inspectionFit : 1);
    uniforms.inspectPixelWidth.value = uniforms.viewSize.value.y / source.height * pixelRatio * 0.85 / uniforms.objectScale.value;
    uniforms.inspectMode.value = settings.inspectMode;
    uniforms.inspectPart.value = settings.inspectPart;
    uniforms.inspectLayers.value.set(Number(settings.inspectGlyphs), Number(settings.inspectHousing), Number(settings.inspectGrid), Number(settings.inspectHidden));
    uniforms.inspectBackground.value.set(settings.background);
    uniforms.padding.value = settings.padding;
    uniforms.numberColor.value.set(settings.numberColor);
    uniforms.sideColor.value.set(settings.sideColor);
    outline.uniforms.lineColor.value.set(settings.lineColor);
    outline.uniforms.backgroundColor.value.set(settings.background);
    outline.uniforms.lineWidth.value = inspecting ? 0 : settings.lineWidth * pixelRatio;
    plane.material = volume;
    renderer.setRenderTarget(source);
    renderer.render(scene, camera);
    plane.material = outline;
    renderer.setRenderTarget(outlined);
    renderer.render(scene, camera);
    plane.material = antialias;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    return pose;
  }

  function resize(width: number, height: number) {
    pixelRatio = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    const viewWidth = Math.max(5.2, width / height * 9.244);
    uniforms.viewSize.value.set(viewWidth, viewWidth * height / width);
    inspectionOffset = width <= 640 ? uniforms.viewSize.value.y * 0.14 : 0;
    inspectionFit = Math.min(1, viewWidth / 7);
    const renderWidth = Math.round(width * pixelRatio);
    const renderHeight = Math.round(height * pixelRatio);
    source.setSize(renderWidth, renderHeight);
    outlined.setSize(renderWidth, renderHeight);
    outline.uniforms.pixelSize.value.set(1 / renderWidth, 1 / renderHeight);
    antialias.uniforms.resolution.value.set(1 / renderWidth, 1 / renderHeight);
  }

  return {
    draw, resize,
    updateNumber(index: number, text: string) {
      glyphs[index].dispose();
      glyphs[index] = createGlyphTexture(text, settings.font);
      [uniforms.face0, uniforms.face1, uniforms.face2][index].value = glyphs[index];
    },
    dispose() {
      glyphs.forEach(texture => texture.dispose());
      source.dispose(); outlined.dispose(); geometry.dispose();
      volume.dispose(); outline.dispose(); antialias.dispose(); renderer.dispose();
    },
  };
}
