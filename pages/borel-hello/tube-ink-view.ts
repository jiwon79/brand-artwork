import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Bounds } from './lettering';
import { strokeState, type PenPlayback } from './pen-playback';
import { createTubeFrames, createTubePaths, multiply, subtract, TUBE_SCALE, TUBE_SIDES, type TubeFrame, type TubePath, type TubePoint, type Vec3 } from './tube-geometry';
import { TubeBodyGeometry } from './tube-mesh';
import { createGlossyTubeMaterial, createMatteTubeMaterial, createTubeColors, type TubeFinish } from './tube-color';
import { createTubeStudioEnvironment } from './tube-lighting';

interface TubeMesh {
  path: TubePath;
  frames: TubeFrame[];
  body: THREE.Mesh<TubeBodyGeometry, THREE.MeshStandardMaterial>;
  start: THREE.Mesh;
  tip: THREE.Mesh;
  dot?: THREE.Mesh;
  startColor: THREE.MeshStandardMaterial;
  tipColor: THREE.MeshStandardMaterial;
  startGloss: THREE.MeshPhysicalMaterial;
  tipGloss: THREE.MeshPhysicalMaterial;
  written: number;
  pressure: number;
  weight: number;
}

/** Actual lit, circular tube meshes, progressively extended at the same arc
 * distance as the SVG ink. Flat moving caps close the unfinished cylinders. */
export class TubeInkView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-3, 3, 2, -2, .01, 100);
  private readonly controls: OrbitControls;
  private readonly material = new THREE.MeshStandardMaterial({ color: '#e4dfd8', roughness: .32, metalness: .04 });
  private readonly rainbowMaterial = createMatteTubeMaterial(true);
  private readonly glossyEnvironment: THREE.WebGLRenderTarget;
  private readonly glossyMaterial: THREE.MeshPhysicalMaterial;
  private readonly capGeometry = new THREE.CircleGeometry(1, TUBE_SIDES);
  private readonly dotGeometry = new THREE.CylinderGeometry(1, 1, 1, TUBE_SIDES);
  private readonly group = new THREE.Group();
  private readonly key = new THREE.DirectionalLight(0xfff5e9, 3.2);
  private readonly backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ color: 0x000000, opacity: .25 }));
  private readonly resizeObserver: ResizeObserver;
  private playback: PenPlayback = { strokes: [], duration: 0 };
  private meshes: TubeMesh[] = [];
  private width = 6;
  private height = 3;
  private depth = 0;
  private visible = false;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x14151c);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.glossyEnvironment = createTubeStudioEnvironment(this.renderer);
    this.glossyMaterial = createGlossyTubeMaterial(this.glossyEnvironment.texture, true);
    this.scene.add(this.group, this.backdrop, new THREE.HemisphereLight(0xf0f3ff, 0x333341, 1.25));
    this.backdrop.position.z = -.18;
    this.backdrop.receiveShadow = true;
    this.key.position.set(-3, 5, 7);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -.00005;
    this.key.shadow.normalBias = .002;
    this.key.shadow.radius = 4;
    this.scene.add(this.key, this.key.target);
    const fill = new THREE.DirectionalLight(0xdce5ff, 1.05); fill.position.set(4, -2, 4); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.8); rim.position.set(1, 4, -.5); this.scene.add(rim);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = false;
    this.controls.minZoom = .5;
    this.controls.maxZoom = 3;
    this.controls.minPolarAngle = Math.PI / 6;
    this.controls.maxPolarAngle = Math.PI * 5 / 6;
    this.controls.minAzimuthAngle = -Math.PI / 3;
    this.controls.maxAzimuthAngle = Math.PI / 3;
    this.controls.rotateSpeed = .55;
    this.controls.addEventListener('change', this.draw);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
  }

  setPlayback(playback: PenPlayback, bounds: Bounds) {
    this.disposeMeshes();
    this.group.clear();
    this.playback = playback;
    const [left, top, right, bottom] = bounds;
    this.width = Math.max(1, (right - left) * TUBE_SCALE);
    this.height = Math.max(.8, (bottom - top) * TUBE_SCALE);
    const pens = playback.strokes.map(stroke => stroke.pen);
    const paths = createTubePaths(pens, [(left + right) / 2, (top + bottom) / 2]), colors = createTubeColors(pens);
    const frames = createTubeFrames(paths);
    let near = 0, far = 0;
    for (const path of paths) for (const point of path.points) {
      near = Math.min(near, point.center[2] - point.radius * 1.5);
      far = Math.max(far, point.center[2] + point.radius * 1.5);
    }
    this.depth = far - near;
    this.group.position.z = -(near + far) / 2;
    this.backdrop.position.z = near + this.group.position.z - .15;
    this.meshes = paths.map((path, index) => {
      const geometry = new TubeBodyGeometry(path, frames[index], colors[index]);
      const startColor = createMatteTubeMaterial(), tipColor = createMatteTubeMaterial();
      const startGloss = createGlossyTubeMaterial(this.glossyEnvironment.texture), tipGloss = createGlossyTubeMaterial(this.glossyEnvironment.texture);
      if (colors[index].length) startColor.color.copy(colors[index][0]);
      startGloss.color.copy(startColor.color);
      const body = new THREE.Mesh(geometry, this.material);
      body.frustumCulled = false; body.castShadow = true; body.receiveShadow = true;
      const start = new THREE.Mesh(this.capGeometry, this.material), tip = new THREE.Mesh(this.capGeometry, this.material);
      start.castShadow = tip.castShadow = true;
      start.receiveShadow = tip.receiveShadow = true;
      const dot = playback.strokes[index].dot ? new THREE.Mesh(this.dotGeometry, this.material) : undefined;
      if (dot) { dot.rotation.x = Math.PI / 2; dot.castShadow = true; dot.receiveShadow = true; this.group.add(dot); }
      this.group.add(body, start, tip);
      body.visible = start.visible = tip.visible = false;
      if (dot) dot.visible = false;
      return { path, frames: frames[index], body, start, tip, dot, startColor, tipColor, startGloss, tipGloss, written: -1, pressure: -1, weight: -1 };
    });
    const extent = Math.max(this.width, this.height, this.depth);
    this.backdrop.scale.set(this.width * 4, this.height * 4, 1);
    this.key.position.set(-extent * .6, extent, extent * 1.4);
    Object.assign(this.key.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: .1, far: Math.max(50, extent * 5) });
    this.key.shadow.camera.updateProjectionMatrix();
    this.resetCamera();
  }

  private cap(cap: THREE.Mesh, point: TubePoint, tangent: Vec3, weight: number) {
    cap.position.set(...point.center);
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...tangent));
    cap.scale.setScalar(point.radius * weight);
  }

  render(time: number, weight: number, color: string, finish: TubeFinish = 'solid') {
    const rainbow = finish !== 'solid', glossy = finish === 'glossy-rainbow';
    this.material.color.set(color);
    this.renderer.toneMappingExposure = rainbow ? .95 : 1.1;
    for (const [index, mesh] of this.meshes.entries()) {
      const timed = this.playback.strokes[index], { written, pressure } = strokeState(timed, time);
      const { path } = mesh, visible = !timed.pen.retrace && written > 0 && pressure > 0 && !!path.points.length;
      mesh.body.visible = mesh.start.visible = mesh.tip.visible = visible && !mesh.dot;
      mesh.body.material = glossy ? this.glossyMaterial : rainbow ? this.rainbowMaterial : this.material;
      mesh.start.material = glossy ? mesh.startGloss : rainbow ? mesh.startColor : this.material;
      mesh.tip.material = glossy ? mesh.tipGloss : rainbow ? mesh.tipColor : this.material;
      if (mesh.dot) mesh.dot.material = mesh.start.material;
      if (mesh.written === written && mesh.weight === weight && mesh.pressure === pressure) continue;
      if (mesh.dot) {
        mesh.dot.visible = visible;
        if (visible) {
          const point = path.points[0], radius = point.radius * pressure * weight;
          mesh.dot.position.set(point.center[0], point.center[1], point.center[2] + radius * .6);
          mesh.dot.scale.set(radius, radius * 1.2, radius);
        }
      } else if (path.points.length > 1) {
        const { point, frame, color } = mesh.body.geometry.setProgress(visible ? written : 0, weight);
        mesh.tipColor.color.copy(color);
        mesh.tipGloss.color.copy(color);
        if (visible) {
          this.cap(mesh.start, path.points[0], multiply(mesh.frames[0].tangent, -1), weight);
          this.cap(mesh.tip, point, frame.tangent, weight);
        }
      }
      mesh.written = written; mesh.pressure = pressure; mesh.weight = weight;
    }
    // Connected bodies share one transported frame. Once the next body starts,
    // their coincident cross-section is an interior join, not two exposed caps.
    for (let i = 1; i < this.meshes.length; i++) {
      const before = this.meshes[i - 1], after = this.meshes[i];
      if (before.body.visible && after.body.visible && before.written >= before.path.length &&
        Math.hypot(...subtract(before.path.points[before.path.points.length - 1].center, after.path.points[0].center)) < 1e-6) {
        before.tip.visible = after.start.visible = false;
      }
    }
    this.draw();
  }

  setVisible(visible: boolean) {
    this.visible = visible; this.controls.enabled = visible;
    if (visible) this.resize();
  }

  resetCamera() {
    const extent = Math.max(this.width, this.height, this.depth, 2);
    this.camera.position.set(extent * .22, extent * .18, extent * 2);
    this.camera.far = Math.max(100, extent * 8);
    this.controls.target.set(0, 0, 0);
    this.camera.zoom = 1;
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.resize();
  }

  private resize() {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height || !this.visible || this.disposed) return;
    const aspect = width / height, halfHeight = Math.max((this.height + this.depth * .2) / 2, (this.width + this.depth * .22) / (2 * aspect)) * 1.08;
    Object.assign(this.camera, { left: -halfHeight * aspect, right: halfHeight * aspect, top: halfHeight, bottom: -halfHeight });
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.draw();
  }

  private readonly draw = () => {
    if (this.visible && !this.disposed) this.renderer.render(this.scene, this.camera);
  };

  private disposeMeshes() {
    for (const mesh of this.meshes) {
      mesh.body.geometry.dispose(); mesh.startColor.dispose(); mesh.tipColor.dispose();
      mesh.startGloss.dispose(); mesh.tipGloss.dispose();
    }
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect(); this.controls.dispose();
    this.disposeMeshes();
    this.capGeometry.dispose(); this.dotGeometry.dispose(); this.material.dispose(); this.rainbowMaterial.dispose();
    this.glossyMaterial.dispose(); this.glossyEnvironment.dispose();
    this.backdrop.geometry.dispose(); this.backdrop.material.dispose(); this.renderer.dispose();
  }
}
