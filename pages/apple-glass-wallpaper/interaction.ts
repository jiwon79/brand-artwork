import { deform, undeform, front, rotate, type MaterialState, type Point } from './deformation';
export type { Point } from './deformation';

export type MaterialSettings = { softness: number; pressDepth: number; recovery: number };

export function damp(value: number, velocity: number, target: number, omega: number, dt: number) {
  const delta = value-target, term = velocity+omega*delta, decay = Math.exp(-omega*dt);
  return { value: target+(delta+term*dt)*decay, velocity: (velocity-omega*term*dt)*decay };
}

// Analytic, slightly underdamped strain: one small rebound, without unstable
// frame-dependent integration or endless jelly oscillation.
export function elastic(value: number, velocity: number, target: number, omega: number, dt: number) {
  const zeta = .78, frequency = omega*Math.sqrt(1-zeta*zeta);
  const delta = value-target, decay = Math.exp(-zeta*omega*dt);
  const c = Math.cos(frequency*dt), s = Math.sin(frequency*dt);
  return { value: target+decay*(delta*c+(velocity+zeta*omega*delta)*s/frequency),
    velocity: decay*(velocity*c-(zeta*omega*velocity+omega*omega*delta)*s/frequency) };
}

export class PebbleMotion implements MaterialState {
  x = 0; y = 0; angle = 0;
  contact = { x: 0, y: 0 };
  pull = { x: 0, y: 0 };
  press = 0;
  mode: 'idle' | 'dragging' | 'returning' | 'keyboard' = 'idle';
  private velocity = { x: 0, y: 0 };
  private pullVelocity = { x: 0, y: 0 };
  private contactVelocity = { x: 0, y: 0 };
  private pressVelocity = 0;
  private angularVelocity = 0;
  private grip: Point = { x: 0, y: 0 };
  private origin: Point = { x: 0, y: 0 };
  private cursor: Point = { x: 0, y: 0 };
  private initialOffset: Point = { x: 0, y: 0 };
  private initialAngle = 0;
  private keyTarget: Point = { x: 0, y: 0 };
  private inputPressure = 1;

  private materialPoint(point: Point) {
    return undeform(rotate({ x: point.x-front.x-this.x, y: point.y-front.y-this.y },-this.angle),this);
  }

  hitTest(point: Point) {
    const p = this.materialPoint(point), y = p.y/front.height;
    const lower = Math.max(0,Math.min(1,(y+.10)/.40));
    const width = front.width*(1-.11*y-.0325*lower*lower*(3-2*lower));
    const x = (p.x-p.y*front.shear)/width;
    return Math.abs(x)**front.exponent+Math.abs(y)**front.exponent <= 1;
  }

  grab(point: Point, pressure = .5) {
    if (!this.hitTest(point) || this.mode === 'dragging') return false;
    this.grip = this.materialPoint(point);
    this.origin = this.cursor = { ...point };
    this.initialOffset = { x: this.x, y: this.y };
    this.initialAngle = this.angle;
    if (Math.hypot(this.pull.x,this.pull.y)+this.press < .05) this.contact = { ...this.grip };
    // Catching during recovery retains the shape; the force center migrates
    // smoothly to the new grip instead of teleporting the deformation.
    this.inputPressure = .7+.6*Math.max(0,Math.min(1,pressure));
    this.mode = 'dragging';
    return true;
  }

  move(point: Point, pressure = .5) {
    if (this.mode !== 'dragging') return;
    this.cursor = { ...point };
    this.inputPressure = .7+.6*Math.max(0,Math.min(1,pressure));
  }

  release(reduced: boolean) {
    if (this.mode !== 'dragging') return;
    this.mode = 'returning';
    // A fast pull retains internal momentum; a held pull has dissipated it.
    this.pullVelocity.x *= .35; this.pullVelocity.y *= .35;
    if (reduced) this.reset(true);
  }

  reset(immediate = false) {
    this.mode = 'returning';
    if (immediate) {
      this.x = this.y = this.angle = this.press = 0;
      this.pull = { x: 0, y: 0 };
      this.velocity = { x: 0, y: 0 };
      this.pullVelocity = { x: 0, y: 0 };
      this.contactVelocity = { x: 0, y: 0 };
      this.pressVelocity = this.angularVelocity = 0;
      this.mode = 'idle';
    }
  }

  nudge(dx: number, dy: number, range: number) {
    if (this.mode === 'dragging') return;
    if (this.mode !== 'keyboard') this.keyTarget = { x: this.x, y: this.y };
    this.keyTarget.x = Math.max(-range,Math.min(range,this.keyTarget.x+dx));
    this.keyTarget.y = Math.max(-range*1.15,Math.min(range*1.15,this.keyTarget.y+dy));
    this.mode = 'keyboard';
  }

  step(dt: number, range: number, rotation: number, material: MaterialSettings, reduced: boolean) {
    if (this.mode === 'idle') return false;
    const held = this.mode === 'dragging';
    const dx = this.cursor.x-this.origin.x, dy = this.cursor.y-this.origin.y;
    // Most input becomes local strain. Small body displacement conveys weight
    // while retaining the stacked reference composition.
    const target = held ? {
      x: this.initialOffset.x+Math.tanh(dx/range)*range*.16,
      y: this.initialOffset.y+Math.tanh(dy/range)*range*.16,
    } : this.mode === 'keyboard' ? this.keyTarget : { x: 0, y: 0 };
    const torque = (this.grip.x*dy-this.grip.y*dx)/100_000;
    const targetAngle = held ? this.initialAngle+(reduced ? 0 : Math.tanh(torque)*.02*rotation) : 0;
    const recovery = 8*material.recovery;
    let active = false;
    for (const axis of ['x','y'] as const) {
      const position = damp(this[axis],this.velocity[axis],target[axis],held ? 16 : recovery,dt);
      this[axis] = reduced ? target[axis] : position.value;
      this.velocity[axis] = reduced ? 0 : position.velocity;
      if (held) {
        const contact = damp(this.contact[axis],this.contactVelocity[axis],this.grip[axis],20,dt);
        this.contact[axis] = reduced ? this.grip[axis] : contact.value;
        this.contactVelocity[axis] = reduced ? 0 : contact.velocity;
        active ||= Math.abs(this.contact[axis]-this.grip[axis])+Math.abs(this.contactVelocity[axis]) > .01;
      }
    }
    const angle = damp(this.angle,this.angularVelocity,targetAngle,held ? 16 : recovery,dt);
    this.angle = reduced ? targetAngle : angle.value;
    this.angularVelocity = reduced ? 0 : angle.velocity;
    const pressureTarget = held ? Math.min(2,material.softness*material.pressDepth*this.inputPressure) : 0;
    const pressure = damp(this.press,this.pressVelocity,pressureTarget,held ? 18 : recovery,dt);
    this.press = reduced ? pressureTarget : pressure.value;
    this.pressVelocity = reduced ? 0 : pressure.velocity;

    let pullTarget = { x: 0, y: 0 };
    if (held) {
      const cursor = rotate({ x: this.cursor.x-front.x-this.x, y: this.cursor.y-front.y-this.y },-this.angle);
      const withoutPull = deform(this.grip,{ contact: this.contact, pull: { x: 0, y: 0 }, press: this.press });
      const desired = { x: cursor.x-withoutPull.x, y: cursor.y-withoutPull.y };
      const length = Math.hypot(desired.x,desired.y);
      // Bounded strain keeps the Jacobian positive at all GUI settings,
      // including a pointer dragged far outside the canvas.
      const limit = 130*material.softness;
      const gain = length > .001 ? limit*Math.tanh(length/130)/length : material.softness;
      pullTarget = { x: desired.x*gain, y: desired.y*gain };
    }
    for (const axis of ['x','y'] as const) {
      const strain = elastic(this.pull[axis],this.pullVelocity[axis],pullTarget[axis],held ? 19 : recovery,dt);
      this.pull[axis] = reduced ? pullTarget[axis] : strain.value;
      this.pullVelocity[axis] = reduced ? 0 : strain.velocity;
      active ||= Math.abs(this[axis]-target[axis])+Math.abs(this.velocity[axis])
        +Math.abs(this.pull[axis]-pullTarget[axis])+Math.abs(this.pullVelocity[axis]) > .02;
    }
    active ||= 100*(Math.abs(this.angle-targetAngle)+Math.abs(this.angularVelocity)
      +Math.abs(this.press-pressureTarget)+Math.abs(this.pressVelocity)) > .02;
    if (!active) {
      this.x = target.x; this.y = target.y; this.angle = targetAngle;
      this.press = pressureTarget; this.pull = pullTarget;
      this.velocity = { x: 0, y: 0 }; this.pullVelocity = { x: 0, y: 0 };
      this.angularVelocity = this.pressVelocity = 0;
      if (!held && this.mode !== 'keyboard') this.mode = 'idle';
    }
    return active;
  }
}
