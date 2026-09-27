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

test('rapid taps do not retrigger the body while a drag cancels the press', () => {
  const reaction = new TouchReaction();
  const point = new THREE.Vector3(0, 0, 100);
  const normal = new THREE.Vector3(0, 0, 1);
  reaction.begin(point, normal, 0);
  reaction.end(100);
  reaction.advance(0.12);
  const firstRebound = reaction.rebound;
  reaction.begin(point, normal, 260);
  reaction.advance(0.1);
  expect(reaction.squash).toBeLessThan(0.001);
  const continuingRebound = reaction.rebound;
  reaction.end(360);
  expect(reaction.rebound).toBeCloseTo(continuingRebound);
  reaction.begin(point, normal, 400);
  reaction.end(430);
  expect(reaction.rebound).toBeCloseTo(continuingRebound);
  expect(reaction.rebound).not.toBeCloseTo(firstRebound);
  reaction.begin(point, normal, 500);
  reaction.drag(28, 0);
  expect(reaction.dragTilt).toBeLessThan(0);
});

test('a held touch settles into a visible squash and releases without repeated oscillation', () => {
  const reaction = new TouchReaction();
  const point = new THREE.Vector3(0, 0, 100);
  const normal = new THREE.Vector3(0, 0, 1);
  reaction.begin(point, normal, 0);
  for (let i = 0; i < 11; i++) reaction.advance(0.05);
  expect(reaction.squash).toBeGreaterThan(0.9);
  expect(reaction.eyeOpen).toBeLessThan(0.7);
  reaction.end(550);
  for (let i = 0; i < 20; i++) {
    reaction.advance(0.05);
    expect(reaction.rebound).toBeGreaterThanOrEqual(0);
  }
  expect(reaction.squash).toBeLessThan(0.01);
});
