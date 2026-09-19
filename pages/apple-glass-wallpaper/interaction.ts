import { deform, undeform, front, rotate, maxContacts, substeps, type ContactField, type MaterialState, type Point } from './deformation';
export type { Point } from './deformation';
export type MaterialSettings = { softness: number; pressDepth: number; recovery: number; stretchLimit: number };

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

type Grip = {
  id: number | null; anchor: Point; origin: Point; cursor: Point;
  pull: Point; velocity: Point; press: number; pressVelocity: number; pressure: number;
};

export class PebbleMotion implements MaterialState {
  x = 0; y = 0; angle = 0;
  private grips: Grip[] = [];
  private velocity = { x: 0, y: 0 };
  private angularVelocity = 0;
  private keyTarget: Point | null = null;
  get activeCount() { return this.grips.filter(grip => grip.id !== null).length; }
  get mode() {
    return this.activeCount ? 'dragging' : this.keyTarget ? 'keyboard'
      : this.grips.length || Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.angle) > .001 ? 'returning' : 'idle';
  }
  get fields(): ContactField[] {
    const fields: ContactField[] = [];
    for (const grip of this.grips) {
      for (let i=0;i<substeps;i++) {
        fields.push({ contact: deform(grip.anchor,{ fields }),
          pull: { x: grip.pull.x/substeps, y: grip.pull.y/substeps }, press: grip.press/substeps });
      }
    }
    return fields;
  }
  private local(point: Point) {
    return rotate({ x: point.x-front.x-this.x, y: point.y-front.y-this.y },-this.angle);
  }
  private materialPoint(point: Point) { return undeform(this.local(point),this); }
  hitTest(point: Point) {
    const p = this.materialPoint(point), y = p.y/front.height;
    const lower = Math.max(0,Math.min(1,(y+.10)/.40));
    const width = front.width*(1-.11*y-.0325*lower*lower*(3-2*lower));
    return Math.abs((p.x-p.y*front.shear)/width)**front.exponent+Math.abs(y)**front.exponent <= 1;
  }
  grab(id: number, point: Point, pressure = .5) {
    if (this.grips.length >= maxContacts || this.grips.some(g => g.id === id) || !this.hitTest(point)) return false;
    this.grips.push({ id, anchor: this.materialPoint(point), origin: { ...point }, cursor: { ...point },
      pull: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, press: 0, pressVelocity: 0,
      pressure: .7+.6*Math.max(0,Math.min(1,pressure)) });
    this.keyTarget = null;
    return true;
  }
  move(id: number, point: Point, pressure = .5) {
    const grip = this.grips.find(g => g.id === id);
    if (!grip) return;
    grip.cursor = { ...point };
    grip.pressure = .7+.6*Math.max(0,Math.min(1,pressure));
  }
  release(id: number, reduced: boolean) {
    const grip = this.grips.find(g => g.id === id);
    if (!grip) return;
    grip.id = null;
    grip.velocity.x *= .35; grip.velocity.y *= .35;
    if (reduced) { grip.pull = { x: 0, y: 0 }; grip.press = 0; grip.velocity = { x: 0, y: 0 }; grip.pressVelocity = 0; }
  }
  reset(immediate = false) {
    this.keyTarget = null;
    for (const grip of this.grips) grip.id = null;
    if (immediate) {
      this.grips = [];
      this.x = this.y = this.angle = this.angularVelocity = 0;
      this.velocity = { x: 0, y: 0 };
    }
  }
  nudge(dx: number, dy: number, range: number) {
    if (this.activeCount) return;
    this.keyTarget ??= { x: this.x, y: this.y };
    this.keyTarget.x = Math.max(-range,Math.min(range,this.keyTarget.x+dx));
    this.keyTarget.y = Math.max(-range,Math.min(range,this.keyTarget.y+dy));
  }
  step(dt: number, range: number, rotation: number, material: MaterialSettings, reduced: boolean) {
    const held = this.grips.filter(g => g.id !== null);
    const average = held.reduce((p,g) => ({ x: p.x+g.cursor.x-g.origin.x, y: p.y+g.cursor.y-g.origin.y }),{ x: 0, y: 0 });
    const count = Math.max(1,held.length);
    const target = held.length ? { x: Math.tanh(average.x/count/range)*range*.12,
      y: Math.tanh(average.y/count/range)*range*.12 } : this.keyTarget ?? { x: 0, y: 0 };
    const torque = held.reduce((sum,g) => sum+(g.anchor.x*(g.cursor.y-g.origin.y)-g.anchor.y*(g.cursor.x-g.origin.x))/100000,0)/count;
    const targetAngle = reduced ? 0 : Math.tanh(torque)*.02*rotation;
    const recovery = 8*material.recovery;
    let active = false;
    for (const axis of ['x','y'] as const) {
      const next = damp(this[axis],this.velocity[axis],target[axis],held.length ? 16 : recovery,dt);
      this[axis] = reduced ? target[axis] : next.value;
      this.velocity[axis] = reduced ? 0 : next.velocity;
      if (Math.abs(this[axis]-target[axis])+Math.abs(this.velocity[axis]) < .002) {
        this[axis] = target[axis]; this.velocity[axis] = 0;
      } else active = true;
    }
    const angle = damp(this.angle,this.angularVelocity,targetAngle,held.length ? 16 : recovery,dt);
    this.angle = reduced ? targetAngle : angle.value;
    this.angularVelocity = reduced ? 0 : angle.velocity;
    if (Math.abs(this.angle-targetAngle)+Math.abs(this.angularVelocity) < .00002) {
      this.angle = targetAngle; this.angularVelocity = 0;
    } else active = true;
    // Each constraint sees the composed material, including every other grip.
    // Residual feedback keeps held anchors near their fingers as neighbors move.
    for (const grip of this.grips) {
      const held = grip.id !== null;
      let targetPull = { x: 0, y: 0 };
      if (held && material.softness > 0) {
        const point = deform(grip.anchor,this), cursor = this.local(grip.cursor);
        targetPull = { x: grip.pull.x+(cursor.x-point.x)*material.softness,
          y: grip.pull.y+(cursor.y-point.y)*material.softness };
        const length = Math.hypot(targetPull.x,targetPull.y);
        const limit = material.stretchLimit*material.softness;
        const gain = Math.min(1,limit/Math.max(length,.001));
        targetPull.x *= gain; targetPull.y *= gain;
      }
      for (const axis of ['x','y'] as const) {
        const next = elastic(grip.pull[axis],grip.velocity[axis],targetPull[axis],held ? 22 : recovery,dt);
        grip.pull[axis] = reduced ? targetPull[axis] : next.value;
        grip.velocity[axis] = reduced ? 0 : next.velocity;
      }
      const targetPress = held ? Math.min(2,material.softness*material.pressDepth*grip.pressure)/Math.sqrt(count) : 0;
      const press = damp(grip.press,grip.pressVelocity,targetPress,held ? 18 : recovery,dt);
      grip.press = reduced ? targetPress : press.value;
      grip.pressVelocity = reduced ? 0 : press.velocity;
      active ||= held || Math.hypot(grip.pull.x,grip.pull.y,grip.velocity.x,grip.velocity.y,grip.press*100,grip.pressVelocity*100) > .01;
    }
    this.grips = this.grips.filter(g => g.id !== null
      || Math.hypot(g.pull.x,g.pull.y,g.velocity.x,g.velocity.y,g.press*100,g.pressVelocity*100) > .01);
    return active;
  }
}
