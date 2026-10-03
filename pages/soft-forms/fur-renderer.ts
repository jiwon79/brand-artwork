import * as THREE from 'three';
import { controlDefinitions, type DeformationRig } from './deformation-rig';
import { bindSurface, skinBoundPoint, type SurfaceBinding } from './surface-binding';
import type { TouchReaction } from './touch-reaction';
import furRibbonFragment from './fur-ribbon.frag?raw';
import furRibbonVertex from './fur-ribbon.vert?raw';
import furShellFragment from './fur-shell.frag?raw';
import furShellVertex from './fur-shell.vert?raw';
import paletteShader from './palette.glsl?raw';

const SHELL_COUNT = 13;
const FIBER_COUNT = 23000;
export const FUR_RENDER_ORDER = SHELL_COUNT + 1;

/** Shells fill the coat's thickness; instanced ribbons describe individual strands. */
export class FurRenderer {
  readonly group = new THREE.Group();
  private readonly shells: { mesh: THREE.Mesh; positions: THREE.BufferAttribute; layer: number }[];
  private readonly fiberSeeds: Float32Array;
  private readonly fiberRoots: Float32Array;
  private readonly fiberTips: Float32Array;
  private readonly fiberRootAttribute: THREE.InstancedBufferAttribute;
  private readonly fiberTipAttribute: THREE.InstancedBufferAttribute;
  private binding: SurfaceBinding;

  constructor(
    bodyGeometry: THREE.BufferGeometry, private readonly bodyDirections: Float32Array,
    bodyUniforms: Record<string, THREE.IUniform>, rig: DeformationRig, baseline: ArrayLike<number>,
  ) {
    const bodyPosition = bodyGeometry.getAttribute('position') as THREE.BufferAttribute;
    const bodyNormal = bodyGeometry.getAttribute('normal') as THREE.BufferAttribute;
    // Thin translucent shells fill the volume between the body and visible fiber tips.
    const shells = Array.from({ length: SHELL_COUNT }, (_, index) => {
      const layer = index / (SHELL_COUNT - 1);
      const geometry = bodyGeometry.clone();
      geometry.setAttribute('basePosition', bodyPosition);
      geometry.setAttribute('normal', bodyNormal);
      const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
      positions.setUsage(THREE.DynamicDrawUsage);
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 300);
      const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
        vertexShader: `precision highp float;
${paletteShader}
${furShellVertex}`,
        fragmentShader: furShellFragment,
        uniforms: { ...bodyUniforms, uLayer: { value: layer } },
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
      }));
      mesh.renderOrder = index + 1;
      this.group.add(mesh);
      return { mesh, positions, layer };
    });

    // Camera-facing tapered ribbons stay legible at the silhouette while rotating.
    const fiberSeeds = new Float32Array(FIBER_COUNT * 5);
    const fiberRoots = new Float32Array(FIBER_COUNT * 3);
    const fiberTips = new Float32Array(FIBER_COUNT * 3);
    const fiberDirections = new Float32Array(FIBER_COUNT * 3);
    const fiberWidths = new Float32Array(FIBER_COUNT);
    const fiberBends = new Float32Array(FIBER_COUNT);
    let randomState = 723981;
    function random() {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    }
    for (let i = 0; i < FIBER_COUNT; i++) {
      const z = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const side = Math.sqrt(1 - z * z);
      const x = Math.cos(angle) * side;
      const y = Math.sin(angle) * side;
      const guardHair = random() < 0.17;
      const length = (guardHair ? 16 + Math.pow(random(), 1.1) * 15 : 7 + Math.pow(random(), 0.7) * 17)
        * (1 + THREE.MathUtils.smoothstep(y, -0.1, 0.55) * 0.26) * 1.09;
      const lean = (random() - 0.5) * 0.82;
      fiberSeeds.set([x, y, z, length, lean], i * 5);
      fiberDirections.set([x, y, z], i * 3);
      fiberWidths[i] = 0.49 + random() * 0.28;
      fiberBends[i] = (random() - 0.5) * 4.5 * Math.min(1, length / 25);
    }
    const fiberGeometry = new THREE.InstancedBufferGeometry();
    const fiberStations = [0, 0.22, 0.48, 0.73, 1];
    const fiberVertices = fiberStations.flatMap((along) => [-1, along, 0, 1, along, 0]);
    const fiberIndices = fiberStations.slice(1).flatMap((_, station) => {
      const start = station * 2;
      return [start, start + 1, start + 2, start + 2, start + 1, start + 3];
    });
    fiberGeometry.setIndex(fiberIndices);
    fiberGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fiberVertices, 3));
    const fiberRootAttribute = new THREE.InstancedBufferAttribute(fiberRoots, 3).setUsage(THREE.DynamicDrawUsage);
    const fiberTipAttribute = new THREE.InstancedBufferAttribute(fiberTips, 3).setUsage(THREE.DynamicDrawUsage);
    fiberGeometry.setAttribute('instanceRoot', fiberRootAttribute);
    fiberGeometry.setAttribute('instanceTip', fiberTipAttribute);
    fiberGeometry.setAttribute('instanceDirection', new THREE.InstancedBufferAttribute(fiberDirections, 3));
    fiberGeometry.setAttribute('instanceWidth', new THREE.InstancedBufferAttribute(fiberWidths, 1));
    fiberGeometry.setAttribute('instanceBend', new THREE.InstancedBufferAttribute(fiberBends, 1));
    fiberGeometry.instanceCount = FIBER_COUNT;
    fiberGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 300);
    const fur = new THREE.Mesh(fiberGeometry, new THREE.ShaderMaterial({
      vertexShader: `precision highp float;
${paletteShader}
${furRibbonVertex}`,
      fragmentShader: furRibbonFragment,
      uniforms: bodyUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    fur.renderOrder = FUR_RENDER_ORDER;
    this.group.add(fur);
    this.shells = shells;
    this.fiberSeeds = fiberSeeds;
    this.fiberRoots = fiberRoots;
    this.fiberTips = fiberTips;
    this.fiberRootAttribute = fiberRootAttribute;
    this.fiberTipAttribute = fiberTipAttribute;
    this.binding = bindSurface(rig, this.fiberSeeds, baseline, 5, 1.5);
  }

  bind(rig: DeformationRig, baseline: ArrayLike<number>) {
    this.binding = bindSurface(rig, this.fiberSeeds, baseline, 5, 1.5);
  }

  update(rig: DeformationRig, cheekStrength: number, reaction: TouchReaction, bodyPositions: Float32Array) {
    for (const shell of this.shells) {
      const offset = 0.5 + 29 * Math.pow(shell.layer, 1.3);
      const positions = shell.positions.array as Float32Array;
      for (let i = 0; i < this.bodyDirections.length; i++) {
        positions[i] = bodyPositions[i] + this.bodyDirections[i] * offset;
      }
      shell.positions.needsUpdate = true;
    }
    const fiberSeeds = this.fiberSeeds, fiberRoots = this.fiberRoots, fiberTips = this.fiberTips;
    for (let i = 0; i < FIBER_COUNT; i++) {
      const seed = i * 5;
      const vertex = i * 3;
      const x = fiberSeeds[seed], y = fiberSeeds[seed + 1], z = fiberSeeds[seed + 2];
      const length = fiberSeeds[seed + 3], lean = fiberSeeds[seed + 4];
      skinBoundPoint(rig, this.binding, i, cheekStrength, fiberRoots, vertex);
      const restX = this.binding.restPositions[vertex], restY = this.binding.restPositions[vertex + 1];
      const restZ = this.binding.restPositions[vertex + 2] + cheekStrength * this.binding.cheekWeights[i];
      rig.skinPoint(restX + x * length + y * lean * length,
        restY + y * length - x * lean * length, restZ + z * length,
        this.binding.controlWeights, fiberTips, vertex, i * controlDefinitions.length);
      if (reaction.deforming) {
        const push = reaction.displacement(fiberRoots[vertex], fiberRoots[vertex + 1], fiberRoots[vertex + 2]);
        fiberRoots[vertex] += reaction.normal.x * push;
        fiberRoots[vertex + 1] += reaction.normal.y * push;
        fiberRoots[vertex + 2] += reaction.normal.z * push;
        const tipPush = push * 0.72;
        fiberTips[vertex] += reaction.normal.x * tipPush;
        fiberTips[vertex + 1] += reaction.normal.y * tipPush;
        fiberTips[vertex + 2] += reaction.normal.z * tipPush;
      }
      if (reaction.active) {
        fiberTips[vertex] += reaction.furLagX * Math.max(0, z);
        fiberTips[vertex + 1] += reaction.furLagY * Math.max(0, z);
      }
    }
    this.fiberRootAttribute.needsUpdate = true;
    this.fiberTipAttribute.needsUpdate = true;
  }
}
