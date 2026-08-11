import {
  ART_HEIGHT,
  ART_WIDTH,
  DRAG_ACTIVATION_DISTANCE,
  LIQUID_MAX_STEP,
  LIQUID_OFFSCREEN_MARGIN,
  LIQUID_PARTICLE_COUNT,
  LIQUID_SOURCE_PACKET_MASS,
  type ColorTextParameters,
} from './config';

export type Point = { x: number; y: number };

/**
 * GPU가 그릴 하나의 물 덩어리(packet)의 CPU 상태.
 * 위치는 0~1 UV, 속도와 거리는 artwork pixel 단위를 사용한다.
 */
export type LiquidParticle = {
  x: number;
  y: number;
  velocityX: number;
  velocityDown: number;
  age: number;
  mass: number;
  energy: number;
  growing: boolean;
  seed: number;
};

/** 처음 누른 액체가 갑자기 나타나지 않도록 시간에 따라 세기를 올린다. */
export function getParticleBirthEnergy(age: number, attack: number): number {
  const energy = 1 - Math.exp(-age / Math.max(attack, 0.001));
  return energy * energy;
}

/**
 * 손가락 source와 중력으로 떨어지는 packet들을 관리하는 작은 물리계다.
 *
 * 이 클래스는 렌더링을 모른다. 매 프레임 update()로 숫자만 바꾸고,
 * script.ts가 particles를 GPU uniform으로 복사해 metaball로 그린다.
 */
export class LiquidSolver {
  readonly particles: LiquidParticle[] = [];
  readonly emitter: Point;

  private readonly lastPointer: Point;
  private readonly accelerationX = new Float32Array(LIQUID_PARTICLE_COUNT);
  private readonly accelerationDown = new Float32Array(LIQUID_PARTICLE_COUNT);
  private massBudget = 0;
  private held = false;
  private hasDragged = false;
  private sourceAge = 0;
  private pointerTravel = 0;
  private particleSequence = 0;
  private source: LiquidParticle | null = null;
  private pointerId: number | null = null;

  constructor(
    private readonly parameters: ColorTextParameters,
    initialPointer: Point,
  ) {
    this.emitter = { ...initialPointer };
    this.lastPointer = { ...initialPointer };
  }

  get isHeld(): boolean {
    return this.held;
  }

  get activePointerId(): number | null {
    return this.pointerId;
  }

  get sourceParticle(): LiquidParticle | null {
    return this.source;
  }

  /** 새 pointer session을 시작하고 질량 0인 source 저장소를 만든다. */
  start(pointerId: number, pointer: Point): void {
    this.emitter.x = pointer.x;
    this.emitter.y = pointer.y;
    this.lastPointer.x = pointer.x;
    this.lastPointer.y = pointer.y;
    this.massBudget = 0;
    this.held = true;
    this.hasDragged = false;
    this.sourceAge = 0;
    this.pointerTravel = 0;
    this.pointerId = pointerId;
    this.source = this.emit(this.emitter.x, this.emitter.y, false, 0, 0);
  }

  /** pointer 이동 거리를 누적해 첫 touch의 attack을 언제 끝낼지 결정한다. */
  trackPointer(pointer: Point): void {
    this.pointerTravel += Math.hypot(
      (pointer.x - this.lastPointer.x) * ART_WIDTH,
      (pointer.y - this.lastPointer.y) * ART_HEIGHT,
    );
    this.lastPointer.x = pointer.x;
    this.lastPointer.y = pointer.y;
    if (this.pointerTravel >= DRAG_ACTIVATION_DISTANCE) this.hasDragged = true;
  }

  /** 공급만 끊는다. 이미 떨어진 packet은 수명 fade 없이 계속 낙하한다. */
  stop(pointerId: number): void {
    if (pointerId !== this.pointerId) return;
    const sourceWasDragged = this.hasDragged
      || this.pointerTravel >= DRAG_ACTIVATION_DISTANCE;
    const sourceEnergy = sourceWasDragged
      ? 1
      : getParticleBirthEnergy(this.sourceAge, this.parameters.dripAttack);

    if (this.source) {
      if (this.source.mass <= 0.000001) {
        const emptySourceIndex = this.particles.indexOf(this.source);
        if (emptySourceIndex >= 0) this.particles.splice(emptySourceIndex, 1);
      } else {
        this.placeSource(this.emitter.x, this.emitter.y, sourceEnergy);
      }
    }

    this.source = null;
    this.held = false;
    this.massBudget = 0;
    this.pointerId = null;
  }

  /**
   * 한 프레임의 CPU 물 상태를 갱신한다.
   * 기존 packet을 먼저 낙하시킨 뒤, 손가락이 눌려 있으면 source에 새 질량을 공급한다.
   */
  update(delta: number, pointerTarget: Point): void {
    this.simulate(delta);
    if (!this.held) return;

    this.sourceAge += delta;
    const emitterBlend = 1 - Math.exp(-this.parameters.dripFollowEase * delta);
    this.emitter.x += (pointerTarget.x - this.emitter.x) * emitterBlend;
    this.emitter.y += (pointerTarget.y - this.emitter.y) * emitterBlend;
    const emissionInterval = Math.max(this.parameters.dripEmissionInterval, 0.01);
    const sourceEnergy = this.hasDragged
      ? 1
      : getParticleBirthEnergy(this.sourceAge, this.parameters.dripAttack);
    this.supplyMass(delta / emissionInterval, sourceEnergy);
  }

  private compactClosestParticles(): void {
    if (this.particles.length < 2) return;

    let firstIndex = -1;
    let secondIndex = -1;
    let closestDistanceSquared = Number.POSITIVE_INFINITY;
    for (let first = 0; first < this.particles.length - 1; first += 1) {
      if (this.particles[first] === this.source) continue;
      for (let second = first + 1; second < this.particles.length; second += 1) {
        if (this.particles[second] === this.source) continue;
        const deltaX = (this.particles[first].x - this.particles[second].x) * ART_WIDTH;
        const deltaY = (this.particles[first].y - this.particles[second].y) * ART_HEIGHT;
        const distanceSquared = deltaX * deltaX + deltaY * deltaY;
        if (distanceSquared < closestDistanceSquared) {
          closestDistanceSquared = distanceSquared;
          firstIndex = first;
          secondIndex = second;
        }
      }
    }
    if (firstIndex < 0 || secondIndex < 0) return;

    const first = this.particles[firstIndex];
    const second = this.particles[secondIndex];
    const totalMass = first.mass + second.mass;
    const firstShare = first.mass / Math.max(totalMass, 0.0001);
    const secondShare = second.mass / Math.max(totalMass, 0.0001);
    const firstVisibleEnergy = first.energy * (
      first.growing
        ? getParticleBirthEnergy(first.age, this.parameters.dripAttack)
        : 1
    );
    const secondVisibleEnergy = second.energy * (
      second.growing
        ? getParticleBirthEnergy(second.age, this.parameters.dripAttack)
        : 1
    );

    this.particles[firstIndex] = {
      x: first.x * firstShare + second.x * secondShare,
      y: first.y * firstShare + second.y * secondShare,
      velocityX: first.velocityX * firstShare + second.velocityX * secondShare,
      velocityDown: first.velocityDown * firstShare + second.velocityDown * secondShare,
      age: first.age * firstShare + second.age * secondShare,
      // mass는 field 반경이다. 합치면 표면이 갑자기 sqrt(2)배 커지므로
      // 두 덩어리 중 더 큰 외피만 유지한다.
      mass: Math.max(first.mass, second.mass),
      energy: (
        firstVisibleEnergy * first.mass + secondVisibleEnergy * second.mass
      ) / Math.max(totalMass, 0.0001),
      growing: false,
      seed: first.seed * firstShare + second.seed * secondShare,
    };
    this.particles.splice(secondIndex, 1);
  }

  private emit(
    x: number,
    y: number,
    growing = false,
    energy = 1,
    mass = 1,
  ): LiquidParticle {
    if (this.particles.length >= LIQUID_PARTICLE_COUNT) {
      this.compactClosestParticles();
    }
    const seed = (this.particleSequence * 0.61803398875) % 1;
    this.particleSequence += 1;
    const particle: LiquidParticle = {
      x,
      y,
      // pointer의 움직임은 source 위치만 바꾸며 물리 운동량으로 전달하지 않는다.
      velocityX: 0,
      velocityDown: this.parameters.dripInitialSpeed,
      age: 0,
      mass,
      energy,
      growing,
      seed,
    };
    this.particles.push(particle);
    return particle;
  }

  private ensureSource(energy: number): LiquidParticle {
    if (!this.source) {
      this.source = this.emit(this.emitter.x, this.emitter.y, false, energy, 0);
    }
    return this.source;
  }

  private placeSource(x: number, y: number, energy: number): void {
    const particle = this.ensureSource(energy);
    particle.x = x;
    particle.y = y;
    particle.velocityX = 0;
    particle.velocityDown = this.parameters.dripInitialSpeed;
    particle.energy = energy;
  }

  private supplyMass(suppliedMass: number, energy: number): void {
    this.massBudget += Math.max(suppliedMass, 0);
    let particle = this.ensureSource(energy);
    this.placeSource(this.emitter.x, this.emitter.y, energy);

    if (particle.mass < LIQUID_SOURCE_PACKET_MASS) {
      const capacity = Math.max(LIQUID_SOURCE_PACKET_MASS - particle.mass, 0);
      const transferredMass = Math.min(this.massBudget, capacity);
      particle.mass += transferredMass;
      this.massBudget -= transferredMass;
      if (particle.mass >= LIQUID_SOURCE_PACKET_MASS - 0.000001) {
        particle.mass = LIQUID_SOURCE_PACKET_MASS;
      }
    }

    // source가 가득 차고 다음 한 덩어리 분량까지 모였을 때만 교대한다.
    // 그래서 drag 경로에 작은 조각을 찍지 않고 큰 덩어리가 자연스럽게 이동한다.
    while (
      particle.mass >= LIQUID_SOURCE_PACKET_MASS - 0.000001
      && this.massBudget >= LIQUID_SOURCE_PACKET_MASS
    ) {
      this.massBudget -= LIQUID_SOURCE_PACKET_MASS;
      this.source = null;
      particle = this.emit(
        this.emitter.x,
        this.emitter.y,
        false,
        energy,
        LIQUID_SOURCE_PACKET_MASS,
      );
      this.source = particle;
      this.placeSource(this.emitter.x, this.emitter.y, energy);
    }
  }

  private simulate(delta: number): void {
    const stepCount = Math.max(1, Math.ceil(delta / LIQUID_MAX_STEP));
    const step = delta / stepCount;

    for (let substep = 0; substep < stepCount; substep += 1) {
      if (this.held && this.source) {
        this.source.x = this.emitter.x;
        this.source.y = this.emitter.y;
      }
      this.accelerationX.fill(0, 0, this.particles.length);
      this.accelerationDown.fill(0, 0, this.particles.length);
      const cohesionRange = Math.max(this.parameters.dripCohesionRange, 1);

      for (let firstIndex = 0; firstIndex < this.particles.length - 1; firstIndex += 1) {
        const first = this.particles[firstIndex];
        for (
          let secondIndex = firstIndex + 1;
          secondIndex < this.particles.length;
          secondIndex += 1
        ) {
          const second = this.particles[secondIndex];
          // 붙어 있는 source는 저장소이므로 cohesion 계산에서 제외한다.
          if (this.held && (first === this.source || second === this.source)) continue;
          const deltaX = (second.x - first.x) * ART_WIDTH;
          const deltaDown = (first.y - second.y) * ART_HEIGHT;
          const distance = Math.hypot(deltaX, deltaDown);
          if (distance <= 0.001 || distance >= cohesionRange) continue;

          const influence = 1 - distance / cohesionRange;
          const restDistance = 18 * Math.sqrt((first.mass + second.mass) * 0.5);
          // 겹침은 metaball이 해결한다. cohesion은 멀어지는 덩어리만 당긴다.
          const stretch = Math.max(distance - restDistance, 0);
          const force = this.parameters.dripCohesion * stretch * influence * influence;
          const directionX = deltaX / distance;
          const directionDown = deltaDown / distance;
          this.accelerationX[firstIndex] += force * directionX / Math.max(first.mass, 0.05);
          this.accelerationDown[firstIndex] += force * directionDown / Math.max(first.mass, 0.05);
          this.accelerationX[secondIndex] -= force * directionX / Math.max(second.mass, 0.05);
          this.accelerationDown[secondIndex] -= force * directionDown / Math.max(second.mass, 0.05);
        }
      }

      const horizontalDamping = Math.exp(-this.parameters.dripViscosity * 1.35 * step);
      const verticalDamping = Math.exp(-this.parameters.dripViscosity * 0.22 * step);
      for (let index = 0; index < this.particles.length; index += 1) {
        const particle = this.particles[index];
        if (this.held && particle === this.source) {
          // source의 flow age는 손가락에서 분리된 뒤에 시작한다.
          particle.age = 0;
          continue;
        }
        const turbulence = Math.sin(
          particle.seed * Math.PI * 2 + particle.age * 1.1,
        ) * this.parameters.dripTurbulence * 2.2;
        particle.velocityX += (this.accelerationX[index] + turbulence) * step;
        particle.velocityDown += (
          this.parameters.dripGravity + this.accelerationDown[index]
        ) * step;
        particle.velocityX *= horizontalDamping;
        particle.velocityDown *= verticalDamping;
        particle.x += particle.velocityX * step / ART_WIDTH;
        particle.y -= particle.velocityDown * step / ART_HEIGHT;
        particle.age += step;
      }
    }

    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      const removalMargin = LIQUID_OFFSCREEN_MARGIN * Math.sqrt(particle.mass);
      if (particle.y * ART_HEIGHT < -removalMargin) this.particles.splice(index, 1);
    }
  }
}
