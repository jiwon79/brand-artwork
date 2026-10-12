import { expect, test } from 'vitest';
import * as THREE from 'three';
import { createDiceGeometry, DICE_SIZE, PIPS } from './geometry';

test('all 21 pips are recessed openings on six complete opposing faces', () => {
  const geometry = createDiceGeometry();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const shell = new THREE.Mesh(geometry.shell, material);
  const lights = new THREE.Mesh(geometry.lights, material);
  const faces: [number, THREE.Euler][] = [
    [1, new THREE.Euler()], [6, new THREE.Euler(0, Math.PI, 0)],
    [3, new THREE.Euler(0, Math.PI / 2, 0)], [4, new THREE.Euler(0, -Math.PI / 2, 0)],
    [2, new THREE.Euler(-Math.PI / 2, 0, 0)], [5, new THREE.Euler(Math.PI / 2, 0, 0)],
  ];
  const ray = new THREE.Raycaster();
  let checked = 0;
  for (const [value, rotation] of faces) {
    const direction = new THREE.Vector3(0, 0, -1).applyEuler(rotation);
    for (const [x, y] of PIPS[value - 1]) {
      ray.set(new THREE.Vector3(x * 0.195, y * 0.195, 2).applyEuler(rotation), direction);
      const lightHit = ray.intersectObject(lights)[0];
      const shellHit = ray.intersectObject(shell)[0];
      expect(lightHit.distance).toBeCloseTo(2 - DICE_SIZE / 2 + 0.021, 5);
      expect(shellHit === undefined || shellHit.distance > lightHit.distance).toBe(true);
      checked++;
    }
    ray.set(new THREE.Vector3(0.28, 0.1, 2).applyEuler(rotation), direction);
    expect(ray.intersectObject(shell)[0].distance).toBeCloseTo(2 - DICE_SIZE / 2, 5);
  }
  expect(checked).toBe(21);
  expect(new Set(geometry.lights.getAttribute('pipIndex').array).size).toBe(21);
  Object.values(geometry).forEach(part => part.dispose());
  material.dispose();
});
