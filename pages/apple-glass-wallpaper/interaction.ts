export type Point = { x: number; y: number };
export const front = { x: 298, y: 645, width: 252, height: 386, shear: .045, exponent: 2.45 };

export function rotate(point: Point, angle: number): Point {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: c*point.x-s*point.y, y: s*point.x+c*point.y };
}

// Exact critically damped motion: stable at different refresh rates and after
// a slow frame, without an overshoot that makes rigid glass feel rubbery.
export function damp(value: number, velocity: number, target: number, omega: number, dt: number) {
  const delta = value-target, term = velocity+omega*delta, decay = Math.exp(-omega*dt);
  return { value: target+(delta+term*dt)*decay, velocity: (velocity-omega*term*dt)*decay };
}

function resist(value: number, range: number) {
  const extra = Math.max(0,Math.abs(value)-range);
  return extra === 0 ? value : Math.sign(value)*(range+30*(1-Math.exp(-extra/30)));
}

export class PebbleMotion {
  x = 0; y = 0; angle = 0;
  vx = 0; vy = 0; angularVelocity = 0;
  mode: 'idle' | 'dragging' | 'coasting' | 'returning' | 'keyboard' = 'idle';
  private grip: Point = { x: 0, y: 0 };
  private origin: Point = { x: 0, y: 0 };
  private cursor: Point = { x: 0, y: 0 };
  private initialAngle = 0;
  private initialOffset: Point = { x: 0, y: 0 };
  private targetAngle = 0;
  private keyTarget: Point = { x: 0, y: 0 };
  private sampleTime = 0;
  private movedAt = 0;
  private coastRemaining = 0;

  hitTest(point: Point) {
    const p = rotate({ x: point.x-front.x-this.x, y: point.y-front.y-this.y },-this.angle);
    const y = p.y/front.height;
    const lower = Math.max(0,Math.min(1,(y+.10)/.40));
    const width = front.width*(1-.11*y-.0325*lower*lower*(3-2*lower));
    const x = (p.x-p.y*front.shear)/width;
    return Math.abs(x)**front.exponent+Math.abs(y)**front.exponent <= 1;
  }

  grab(point: Point, now: number) {
    if (!this.hitTest(point) || this.mode === 'dragging') return false;
    this.grip = rotate({ x: point.x-front.x-this.x, y: point.y-front.y-this.y },-this.angle);
    this.origin = this.cursor = { ...point };
    this.initialOffset = { x: this.x, y: this.y };
    this.initialAngle = this.targetAngle = this.angle;
    this.vx = this.vy = this.angularVelocity = 0;
    this.sampleTime = this.movedAt = now;
    this.mode = 'dragging';
    return true;
  }

  move(point: Point, now: number, range: number, rotation: number, reduced: boolean) {
    if (this.mode !== 'dragging') return;
    this.cursor = { ...point };
    const dx = point.x-this.origin.x, dy = point.y-this.origin.y;
    const torque = (this.grip.x*dy-this.grip.y*dx)/100_000;
    this.targetAngle = reduced ? this.initialAngle
      : this.initialAngle+Math.tanh(torque)*.045*rotation;
    const oldX = this.x, oldY = this.y;
    this.placeGrip(range);
    const dt = (now-this.sampleTime)/1000;
    if (dt > .001) {
      const blend = 1-Math.exp(-dt/.045);
      this.vx += (Math.max(-900,Math.min(900,(this.x-oldX)/dt))-this.vx)*blend;
      this.vy += (Math.max(-900,Math.min(900,(this.y-oldY)/dt))-this.vy)*blend;
      this.sampleTime = now;
      if (Math.hypot(this.x-oldX,this.y-oldY) > .01) this.movedAt = now;
    }
  }

  private placeGrip(range: number) {
    const grip = rotate(this.grip,this.angle);
    // Calibrate resistance to the picked pose: catching a returning pebble
    // outside the free range must not introduce a discontinuity.
    this.x = resist(this.cursor.x-front.x-grip.x,range)
      +this.initialOffset.x-resist(this.initialOffset.x,range);
    this.y = resist(this.cursor.y-front.y-grip.y,range*1.15)
      +this.initialOffset.y-resist(this.initialOffset.y,range*1.15);
  }

  release(now: number, inertia: number, reduced: boolean) {
    if (this.mode !== 'dragging') return;
    // Holding still before release must not replay an old flick.
    const freshness = Math.exp(-Math.max(0,now-this.movedAt-24)/65);
    this.vx *= inertia*freshness;
    this.vy *= inertia*freshness;
    this.angularVelocity = 0;
    this.coastRemaining = .12;
    this.mode = Math.hypot(this.vx,this.vy) > 6 ? 'coasting' : 'returning';
    if (reduced) this.reset(true);
  }

  reset(immediate = false) {
    this.vx = this.vy = this.angularVelocity = 0;
    this.targetAngle = 0;
    this.mode = 'returning';
    if (immediate) { this.x = this.y = this.angle = 0; this.mode = 'idle'; }
  }

  nudge(dx: number, dy: number, range: number) {
    if (this.mode === 'dragging') return;
    if (this.mode !== 'keyboard') this.keyTarget = { x: this.x, y: this.y };
    this.keyTarget.x = Math.max(-range,Math.min(range,this.keyTarget.x+dx));
    this.keyTarget.y = Math.max(-range*1.15,Math.min(range*1.15,this.keyTarget.y+dy));
    this.mode = 'keyboard';
  }

  step(dt: number, range: number, reduced: boolean): boolean {
    if (this.mode === 'idle') return false;
    if (this.mode === 'dragging') {
      const rotation = damp(this.angle,this.angularVelocity,this.targetAngle,16,dt);
      this.angle = reduced ? this.initialAngle : rotation.value;
      this.angularVelocity = reduced ? 0 : rotation.velocity;
      this.placeGrip(range);
      return Math.abs(this.angle-this.targetAngle)+Math.abs(this.angularVelocity) > .0001;
    }
    if (reduced) {
      this.x = this.mode === 'keyboard' ? this.keyTarget.x : 0;
      this.y = this.mode === 'keyboard' ? this.keyTarget.y : 0;
      this.angle = this.vx = this.vy = this.angularVelocity = 0;
      if (this.mode !== 'keyboard') this.mode = 'idle';
      return false;
    }
    if (this.mode === 'coasting') {
      const coastDt = Math.min(dt,this.coastRemaining), decay = Math.exp(-12*coastDt);
      this.x += this.vx*(1-decay)/12;
      this.y += this.vy*(1-decay)/12;
      this.vx *= decay; this.vy *= decay;
      this.coastRemaining -= coastDt;
      if (this.coastRemaining > .00001) return true;
      this.mode = 'returning';
      dt -= coastDt;
    }
    const target = this.mode === 'keyboard' ? this.keyTarget : { x: 0, y: 0 };
    const omega = this.mode === 'keyboard' ? 12 : 5.5;
    const nextX = damp(this.x,this.vx,target.x,omega,dt);
    const nextY = damp(this.y,this.vy,target.y,omega,dt);
    const nextAngle = damp(this.angle,this.angularVelocity,0,7,dt);
    this.x = nextX.value; this.vx = nextX.velocity;
    this.y = nextY.value; this.vy = nextY.velocity;
    this.angle = nextAngle.value; this.angularVelocity = nextAngle.velocity;
    const active = Math.abs(this.x-target.x)+Math.abs(this.y-target.y)+Math.abs(this.vx)
      +Math.abs(this.vy)+100*(Math.abs(this.angle)+Math.abs(this.angularVelocity)) > .02;
    if (!active) {
      this.x = target.x; this.y = target.y;
      this.angle = this.vx = this.vy = this.angularVelocity = 0;
      if (this.mode !== 'keyboard') this.mode = 'idle';
    }
    return active;
  }
}
