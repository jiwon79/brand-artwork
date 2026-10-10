import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Bounds } from './lettering';
import { strokeState, type PenPlayback } from './pen-playback';
import { createTubeFrames, createTubePaths, multiply, subtract, TUBE_SCALE, TUBE_SIDES, type TubeFrame, type TubePath, type TubePoint, type Vec3 } from './tube-geometry';
import { TubeBodyGeometry } from './tube-mesh';
import { createTubeColors, type TubeColorMode } from './tube-color';
import { TubeMaterial } from './tube-material';

interface TubeMesh {
  path: TubePath;
  frames: TubeFrame[];
  body: THREE.Mesh<TubeBodyGeometry, TubeMaterial>;
  start: THREE.Mesh;
  tip: THREE.Mesh;
  dot?: THREE.Mesh;
  startColor: TubeMaterial;
  tipColor: TubeMaterial;
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
  private readonly material = new TubeMaterial();
  private readonly rainbowMaterial = new TubeMaterial(true);
  private readonly capGeometry = new THREE.CircleGeometry(1, TUBE_SIDES);
  private readonly dotGeometry = new THREE.SphereGeometry(1, TUBE_SIDES, 32);
  private readonly group = new THREE.Group();
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
    this.renderer.setClearColor(0xeee7ff);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.scene.add(this.group);
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
    this.meshes = paths.map((path, index) => {
      const geometry = new TubeBodyGeometry(path, frames[index], colors[index]);
      const startColor = new TubeMaterial(), tipColor = new TubeMaterial();
      if (colors[index].length) startColor.color.copy(colors[index][0]);
      const body = new THREE.Mesh(geometry, this.material);
      body.frustumCulled = false;
      const start = new THREE.Mesh(this.capGeometry, this.material), tip = new THREE.Mesh(this.capGeometry, this.material);
      const dot = playback.strokes[index].dot ? new THREE.Mesh(this.dotGeometry, this.material) : undefined;
      if (dot) this.group.add(dot);
      this.group.add(body, start, tip);
      body.visible = start.visible = tip.visible = false;
      if (dot) dot.visible = false;
      return { path, frames: frames[index], body, start, tip, dot, startColor, tipColor, written: -1, pressure: -1, weight: -1 };
    });
    this.resetCamera();
  }

  private cap(cap: THREE.Mesh, point: TubePoint, tangent: Vec3, weight: number) {
    cap.position.set(...point.center);
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...tangent));
    cap.scale.setScalar(point.radius * weight);
  }

  render(time: number, weight: number, color: string, colorMode: TubeColorMode = 'rainbow') {
    const rainbow = colorMode === 'rainbow';
    this.material.color.set(color);
    for (const [index, mesh] of this.meshes.entries()) {
      const timed = this.playback.strokes[index], { written, pressure } = strokeState(timed, time);
      const { path } = mesh, visible = !timed.pen.retrace && written > 0 && pressure > 0 && !!path.points.length;
      mesh.body.visible = mesh.start.visible = mesh.tip.visible = visible && !mesh.dot;
      mesh.body.material = rainbow ? this.rainbowMaterial : this.material;
      mesh.start.material = rainbow ? mesh.startColor : this.material;
      mesh.tip.material = rainbow ? mesh.tipColor : this.material;
      if (mesh.dot) mesh.dot.material = mesh.start.material;
      if (mesh.written === written && mesh.weight === weight && mesh.pressure === pressure) continue;
      if (mesh.dot) {
        mesh.dot.visible = visible;
        if (visible) {
          const point = path.points[0], radius = point.radius * pressure * weight;
          mesh.dot.position.set(point.center[0], point.center[1], point.center[2] + radius * .6);
          mesh.dot.scale.setScalar(radius);
        }
      } else if (path.points.length > 1) {
        const { point, frame, color } = mesh.body.geometry.setProgress(visible ? written : 0, weight);
        mesh.tipColor.color.copy(color);
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
    this.camera.position.set(extent * .08, extent * .04, extent * 2);
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
    }
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect(); this.controls.dispose();
    this.disposeMeshes();
    this.capGeometry.dispose(); this.dotGeometry.dispose(); this.material.dispose(); this.rainbowMaterial.dispose();
    this.renderer.dispose();
  }
}
