import { applyDeformation, invertDeformation, glassBodyShapes, glassBodyWidthAt, rotate, maxGrips, deformationSubsteps, glassBodyIds, type DeformationField, type DeformationState, type GlassBodyId, type Point } from './deformation';
export type { Point } from './deformation';
export type MaterialSettings = { softness: number; indentationDepth: number; recovery: number; stretchLimit: number };

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
  pointerId: number | null; materialAnchor: Point; pointerOrigin: Point; pointerPosition: Point;
  displacement: Point; velocity: Point; indentation: number; indentationVelocity: number;
  pointerPressure: number;
};

export class GlassBodyMotion implements DeformationState {
  constructor(readonly bodyId: GlassBodyId = glassBodyIds.foreground) {}
  x = 0; y = 0; angle = 0;
  private grips: Grip[] = [];
  private cachedDeformationFields: DeformationField[] | null = null;
  private velocity = { x: 0, y: 0 };
  private angularVelocity = 0;
  private keyTarget: Point | null = null;
  get activeCount() { return this.grips.filter(grip => grip.pointerId !== null).length; }
  get mode() {
    return this.activeCount ? 'dragging' : this.keyTarget ? 'keyboard'
      : this.grips.length || Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.angle) > .001 ? 'returning' : 'idle';
  }
  get deformationFields(): DeformationField[] {
    if (this.cachedDeformationFields) return this.cachedDeformationFields;
    const deformationFields: DeformationField[] = [];
    for (const grip of this.grips) {
      let center = applyDeformation(grip.materialAnchor,{ deformationFields });
      const displacement = {
        x: grip.displacement.x/deformationSubsteps,
        y: grip.displacement.y/deformationSubsteps,
      };
      for (let i=0;i<deformationSubsteps;i++) {
        deformationFields.push({ center, displacement, indentation: grip.indentation/deformationSubsteps });
        // The anchor is at the center of its own field: weight = 1 and
        // pressure displacement = 0. No need to replay the preceding maps.
        center = { x: center.x+displacement.x, y: center.y+displacement.y };
      }
    }
    return this.cachedDeformationFields = deformationFields;
  }
  private local(point: Point) {
    const shape = glassBodyShapes[this.bodyId];
    return rotate({ x: point.x-shape.x-this.x, y: point.y-shape.y-this.y },-this.angle);
  }
  private canonicalPoint(point: Point) { return invertDeformation(this.local(point),this); }
  hitTest(point: Point) {
    const shape = glassBodyShapes[this.bodyId], p = this.canonicalPoint(point), y = p.y/shape.height;
    const width = glassBodyWidthAt(this.bodyId,y);
    return width > 0 && Math.abs((p.x-p.y*shape.shear)/width)**shape.exponent+Math.abs(y)**shape.exponent <= 1;
  }
  grab(id: number, point: Point, pressure = .5) {
    if (this.grips.length >= maxGrips || this.grips.some(g => g.pointerId === id) || !this.hitTest(point)) return false;
    this.grips.push({ pointerId: id, materialAnchor: this.canonicalPoint(point), pointerOrigin: { ...point }, pointerPosition: { ...point },
      displacement: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, indentation: 0, indentationVelocity: 0,
      pointerPressure: .7+.6*Math.max(0,Math.min(1,pressure)) });
    this.keyTarget = null;
    this.cachedDeformationFields = null;
    return true;
  }
  move(id: number, point: Point, pressure = .5) {
    const grip = this.grips.find(g => g.pointerId === id);
    if (!grip) return;
    grip.pointerPosition = { ...point };
    grip.pointerPressure = .7+.6*Math.max(0,Math.min(1,pressure));
  }
  release(id: number, reduced: boolean) {
    const grip = this.grips.find(g => g.pointerId === id);
    if (!grip) return;
    grip.pointerId = null;
    grip.velocity.x *= .35; grip.velocity.y *= .35;
    if (reduced) { grip.displacement = { x: 0, y: 0 }; grip.indentation = 0; grip.velocity = { x: 0, y: 0 }; grip.indentationVelocity = 0; }
    if (reduced) this.cachedDeformationFields = null;
  }
  reset(immediate = false) {
    this.cachedDeformationFields = null;
    this.keyTarget = null;
    for (const grip of this.grips) grip.pointerId = null;
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
    const held = this.grips.filter(g => g.pointerId !== null);
    const average = held.reduce((p,g) => ({ x: p.x+g.pointerPosition.x-g.pointerOrigin.x, y: p.y+g.pointerPosition.y-g.pointerOrigin.y }),{ x: 0, y: 0 });
    const count = Math.max(1,held.length);
    const target = held.length ? { x: Math.tanh(average.x/count/range)*range*.12,
      y: Math.tanh(average.y/count/range)*range*.12 } : this.keyTarget ?? { x: 0, y: 0 };
    const torque = held.reduce((sum,g) => sum+(g.materialAnchor.x*(g.pointerPosition.y-g.pointerOrigin.y)-g.materialAnchor.y*(g.pointerPosition.x-g.pointerOrigin.x))/100000,0)/count;
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
      const held = grip.pointerId !== null;
      let targetDisplacement = { x: 0, y: 0 };
      if (held && material.softness > 0) {
        const point = applyDeformation(grip.materialAnchor,this), cursor = this.local(grip.pointerPosition);
        targetDisplacement = { x: grip.displacement.x+(cursor.x-point.x)*material.softness,
          y: grip.displacement.y+(cursor.y-point.y)*material.softness };
        const length = Math.hypot(targetDisplacement.x,targetDisplacement.y);
        const limit = material.stretchLimit*material.softness;
        const gain = Math.min(1,limit/Math.max(length,.001));
        targetDisplacement.x *= gain; targetDisplacement.y *= gain;
      }
      for (const axis of ['x','y'] as const) {
        const next = elastic(grip.displacement[axis],grip.velocity[axis],targetDisplacement[axis],held ? 22 : recovery,dt);
        grip.displacement[axis] = reduced ? targetDisplacement[axis] : next.value;
        grip.velocity[axis] = reduced ? 0 : next.velocity;
      }
      const targetIndentation = held ? Math.min(2,material.softness*material.indentationDepth*grip.pointerPressure)/Math.sqrt(count) : 0;
      const indentation = damp(grip.indentation,grip.indentationVelocity,targetIndentation,held ? 18 : recovery,dt);
      grip.indentation = reduced ? targetIndentation : indentation.value;
      grip.indentationVelocity = reduced ? 0 : indentation.velocity;
      this.cachedDeformationFields = null;
      active ||= held || Math.hypot(grip.displacement.x,grip.displacement.y,grip.velocity.x,grip.velocity.y,grip.indentation*100,grip.indentationVelocity*100) > .01;
    }
    this.grips = this.grips.filter(g => g.pointerId !== null
      || Math.hypot(g.displacement.x,g.displacement.y,g.velocity.x,g.velocity.y,g.indentation*100,g.indentationVelocity*100) > .01);
    this.cachedDeformationFields = null;
    return active;
  }
}
