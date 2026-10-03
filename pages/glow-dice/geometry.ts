import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const DICE_SIZE = 0.78;
const HALF = DICE_SIZE / 2;
const BEVEL = 0.032;
const PIP_RADIUS = 0.068;
const PIP_DEPTH = 0.021;
const SPREAD = 0.195;

export const PIPS: readonly (readonly [number, number])[][] = [
  [[0, 0]],
  [[-1, 1], [1, -1]],
  [[-1, 1], [0, 0], [1, -1]],
  [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
];

/** Opposite faces sum to seven; every face has actual circular openings. */
const FACES = [
  { value: 1, rotation: new THREE.Euler(0, 0, 0) },
  { value: 6, rotation: new THREE.Euler(0, Math.PI, 0) },
  { value: 3, rotation: new THREE.Euler(0, Math.PI / 2, 0) },
  { value: 4, rotation: new THREE.Euler(0, -Math.PI / 2, 0) },
  { value: 2, rotation: new THREE.Euler(-Math.PI / 2, 0, 0) },
  { value: 5, rotation: new THREE.Euler(Math.PI / 2, 0, 0) },
];

function join(parts: THREE.BufferGeometry[]) {
  const result = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  result.computeBoundingSphere();
  return result;
}

function pipAttribute(geometry: THREE.BufferGeometry, index: number) {
  geometry.setAttribute('pipIndex', new THREE.Float32BufferAttribute(
    new Float32Array(geometry.getAttribute('position').count).fill(index), 1,
  ));
  return geometry;
}

export function createDiceGeometry() {
  const rounded = new RoundedBoxGeometry(DICE_SIZE, DICE_SIZE, DICE_SIZE, 3, BEVEL);
  const positions = rounded.getAttribute('position');
  const normals = rounded.getAttribute('normal');
  const bevelPositions: number[] = [];
  const bevelNormals: number[] = [];
  const bevelUvs: number[] = [];
  // Replace only the six flat squares. Keep the original connected bevels.
  for (let i = 0; i < positions.count; i += 3) {
    let flat = false;
    for (let axis = 0; axis < 3; axis++) {
      const n = normals.getComponent(i, axis);
      if (Math.abs(n) > 0.99999
        && Math.abs(normals.getComponent(i + 1, axis) - n) < 0.00001
        && Math.abs(normals.getComponent(i + 2, axis) - n) < 0.00001) flat = true;
    }
    if (flat) continue;
    for (let j = i; j < i + 3; j++) {
      bevelPositions.push(positions.getX(j), positions.getY(j), positions.getZ(j));
      bevelNormals.push(normals.getX(j), normals.getY(j), normals.getZ(j));
      bevelUvs.push(0, 0);
    }
  }
  rounded.dispose();
  const bevel = new THREE.BufferGeometry();
  bevel.setAttribute('position', new THREE.Float32BufferAttribute(bevelPositions, 3));
  bevel.setAttribute('normal', new THREE.Float32BufferAttribute(bevelNormals, 3));
  bevel.setAttribute('uv', new THREE.Float32BufferAttribute(bevelUvs, 2));
  const shellParts = [bevel];
  const socketParts: THREE.BufferGeometry[] = [];
  const lightParts: THREE.BufferGeometry[] = [];
  let pipIndex = 0;

  for (const face of FACES) {
    const a = HALF - BEVEL;
    const panel = new THREE.Shape();
    panel.moveTo(-a, -a);
    panel.lineTo(a, -a);
    panel.lineTo(a, a);
    panel.lineTo(-a, a);
    panel.closePath();
    const rotation = new THREE.Matrix4().makeRotationFromEuler(face.rotation);
    for (const [px, py] of PIPS[face.value - 1]) {
      const x = px * SPREAD;
      const y = py * SPREAD;
      const hole = new THREE.Path();
      hole.absarc(x, y, PIP_RADIUS, 0, Math.PI * 2, true);
      panel.holes.push(hole);

      // A curved lip leads down into a black socket, with a luminous inset floor.
      const profile = [
        new THREE.Vector2(PIP_RADIUS, HALF),
        new THREE.Vector2(PIP_RADIUS - 0.0015, HALF - 0.004),
        new THREE.Vector2(PIP_RADIUS - 0.004, HALF - 0.009),
        new THREE.Vector2(PIP_RADIUS - 0.006, HALF - PIP_DEPTH),
      ];
      const socket = new THREE.LatheGeometry(profile, 24);
      socket.rotateX(Math.PI / 2);
      socket.translate(x, y, 0);
      socket.applyMatrix4(rotation);
      socketParts.push(pipAttribute(socket.toNonIndexed(), pipIndex));
      socket.dispose();

      const light = new THREE.CircleGeometry(PIP_RADIUS - 0.006, 24);
      light.translate(x, y, HALF - PIP_DEPTH);
      light.applyMatrix4(rotation);
      lightParts.push(pipAttribute(light.toNonIndexed(), pipIndex));
      light.dispose();
      pipIndex++;
    }
    const surface = new THREE.ShapeGeometry(panel, 12);
    // The enamel is very slightly crowned. Smooth normals catch the broad
    // softbox across a face, while the bevel keeps its narrow edge highlight.
    const surfacePositions = surface.getAttribute('position');
    const surfaceNormals = surface.getAttribute('normal');
    const normal = new THREE.Vector3();
    for (let i = 0; i < surfacePositions.count; i++) {
      const x = surfacePositions.getX(i) / a;
      const y = surfacePositions.getY(i) / a;
      normal.set(x * (0.035 + 0.12 * x ** 4), y * (0.035 + 0.12 * y ** 4), 1).normalize();
      surfaceNormals.setXYZ(i, normal.x, normal.y, normal.z);
    }
    surface.translate(0, 0, HALF);
    surface.applyMatrix4(rotation);
    shellParts.push(surface.toNonIndexed());
    surface.dispose();
  }
  return { shell: join(shellParts), sockets: join(socketParts), lights: join(lightParts) };
}
