import * as THREE from 'three';

const PRESS_RISE = 9;
const PRESS_FALL = 7;
const DRAG_FALL = 5;
const TAP_GROUP_MS = 450;
const REBOUND_SECONDS = 0.72;

export class TouchReaction {
  readonly point = new THREE.Vector3();
  readonly normal = new THREE.Vector3(0, 0, 1);
  private touching = false;
  private heldSeconds = 0;
  private pressure = 0;
  private pulseSeconds = Infinity;
  private pulseStrength = 0;
  private blinkSeconds = Infinity;
  private surpriseSeconds = Infinity;
  private lastTap = -Infinity;
  private groupedTap = false;
  private followupTouch = false;
  private dragX = 0;
  private dragY = 0;

  get active() {
    return this.touching || this.pressure > 0.002 || this.pulseSeconds < 0.95
      || this.blinkSeconds < 0.55 || this.surpriseSeconds < 0.7
      || Math.abs(this.dragX) + Math.abs(this.dragY) > 0.002;
  }
  get deforming() { return this.pressure > 0.002 || this.pulseSeconds < 0.95; }

  get dragTilt() { return THREE.MathUtils.clamp(-this.dragX * 0.075, -0.1, 0.1); }
  get dragPitch() { return THREE.MathUtils.clamp(this.dragY * 0.045, -0.06, 0.06); }
  get squash() { return this.pressure; }
  get rebound() {
    return this.pulseSeconds < REBOUND_SECONDS
      ? this.pulseStrength * Math.sin(Math.PI * this.pulseSeconds / REBOUND_SECONDS) ** 2
      : 0;
  }
  get furLagX() { return -this.dragX * 4.5; }
  get furLagY() { return this.dragY * 3; }
  get surprised() {
    return this.surpriseSeconds < 0.7 ? Math.sin(Math.PI * this.surpriseSeconds / 0.7) : 0;
  }
  get eyeOpen() {
    const close = this.blinkSeconds < 0.34
      ? Math.sin(Math.PI * this.blinkSeconds / 0.34) ** 4 : 0;
    return Math.max(0.12, (1 - close) * (1 - this.pressure * 0.4)) * (1 + this.surprised * 0.5);
  }

  begin(point: THREE.Vector3, normal: THREE.Vector3, now = performance.now()) {
    this.point.copy(point);
    this.normal.copy(normal).normalize();
    this.touching = true;
    this.heldSeconds = 0;
    this.followupTouch = now - this.lastTap < TAP_GROUP_MS;
  }

  drag(dx: number, dy: number) {
    this.touching = false;
    this.followupTouch = false;
    this.dragX = THREE.MathUtils.clamp(dx / 28, -1, 1);
    this.dragY = THREE.MathUtils.clamp(dy / 28, -1, 1);
  }

  end(now: number, cancelled = false) {
    if (!this.touching) return;
    this.touching = false;
    if (cancelled) return;
    const repeated = now - this.lastTap < TAP_GROUP_MS;
    const longPress = this.heldSeconds >= 0.35;
    if (longPress) {
      this.pulseSeconds = 0;
      this.pulseStrength = 1.15;
      this.blinkSeconds = 0;
      this.lastTap = -Infinity;
      this.groupedTap = false;
    } else if (repeated) {
      if (!this.groupedTap) this.surpriseSeconds = 0;
      this.groupedTap = true;
      this.lastTap = now;
    } else {
      this.pulseSeconds = 0;
      this.pulseStrength = 1;
      this.blinkSeconds = 0;
      this.lastTap = now;
      this.groupedTap = false;
    }
  }

  advance(delta: number) {
    if (this.touching) this.heldSeconds += delta;
    const target = this.touching
      ? this.followupTouch
        ? Math.min(1, Math.max(0, (this.heldSeconds - 0.18) / 0.28))
        : Math.min(1, 0.25 + this.heldSeconds * 1.9)
      : 0;
    this.pressure += (target - this.pressure) * (1 - Math.exp(-delta * (this.touching ? PRESS_RISE : PRESS_FALL)));
    this.pulseSeconds += delta;
    this.blinkSeconds += delta;
    this.surpriseSeconds += delta;
    const dragDecay = Math.exp(-delta * DRAG_FALL);
    this.dragX *= dragDecay;
    this.dragY *= dragDecay;
  }

  displacement(x: number, y: number, z: number) {
    const distance = Math.hypot(x - this.point.x, y - this.point.y, z - this.point.z);
    const press = this.pressure * 25 * Math.exp(-((distance / 82) ** 2) * 1.8);
    const waveAge = this.pulseSeconds - distance / 450;
    const wave = waveAge > 0 && waveAge < REBOUND_SECONDS
      ? this.pulseStrength * 9 * Math.sin(Math.PI * waveAge / REBOUND_SECONDS) ** 2
        * Math.exp(-((distance / 175) ** 2)) : 0;
    return wave - press;
  }
}
