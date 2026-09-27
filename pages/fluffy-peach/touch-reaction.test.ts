import { test, expect } from 'vitest';
import * as THREE from 'three';
import { TouchReaction } from './touch-reaction';

test('a touch presses locally and releases into a fading rebound', () => {
  const reaction = new TouchReaction();
  reaction.begin(new THREE.Vector3(0, 0, 100), new THREE.Vector3(0, 0, 1));
  reaction.advance(0.2);
  expect(reaction.displacement(0, 0, 100)).toBeLessThan(-5);
  expect(Math.abs(reaction.displacement(200, 0, 100))).toBeLessThan(0.01);
  reaction.end(200);
  reaction.advance(1.2);
  expect(Math.abs(reaction.displacement(0, 0, 100))).toBeLessThan(0.01);
});

test('a second tap adds surprise while a drag cancels the press', () => {
  const reaction = new TouchReaction();
  const point = new THREE.Vector3(0, 0, 100);
  const normal = new THREE.Vector3(0, 0, 1);
  reaction.begin(point, normal);
  reaction.end(100);
  reaction.begin(point, normal);
  reaction.end(300);
  reaction.advance(0.1);
  expect(reaction.surprised).toBeGreaterThan(0);
  expect(reaction.eyeOpen).toBeLessThan(1);
  reaction.begin(point, normal);
  reaction.drag(28, 0);
  expect(reaction.dragTilt).toBeLessThan(0);
});
