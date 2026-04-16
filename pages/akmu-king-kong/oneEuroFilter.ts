/**
 * One Euro Filter — 적응형 저주파 필터
 *
 * 속도가 느리면 α를 낮춰 떨림 제거,
 * 속도가 빠르면 α를 높여 즉각 반응.
 *
 * 파라미터:
 *   minCutoff — 정지 시 필터 강도. 낮을수록 떨림 더 제거 (기본 1.0)
 *   beta      — 속도 민감도. 높을수록 빠른 동작 잘 따라감 (기본 0.007)
 *   dCutoff   — 속도 추정용 필터 주파수 (기본 1.0)
 */
export class OneEuroFilter {
  private firstTime = true;
  private prevRaw = 0;
  private prevFiltered = 0;
  private prevVelocity = 0;
  private prevTs = 0;

  constructor(
    private minCutoff = 1.0,
    private beta = 0.007,
    private dCutoff = 1.0,
  ) {}

  private computeAlpha(dt: number, cutoff: number): number {
    const r = 2 * Math.PI * cutoff * dt;
    return r / (r + 1);
  }

  filter(value: number, timestamp: number): number {
    if (this.firstTime) {
      this.firstTime = false;
      this.prevRaw = value;
      this.prevFiltered = value;
      this.prevTs = timestamp;
      return value;
    }

    const dt = Math.max(timestamp - this.prevTs, 1e-6);

    // 1) 속도 추정 (EMA)
    const rawVelocity = (value - this.prevRaw) / dt;
    const aVel = this.computeAlpha(dt, this.dCutoff);
    const velocity = aVel * rawVelocity + (1 - aVel) * this.prevVelocity;

    // 2) 속도에 따라 cutoff 동적 조정
    const cutoff = this.minCutoff + this.beta * Math.abs(velocity);

    // 3) 위치 필터 (EMA)
    const aPos = this.computeAlpha(dt, cutoff);
    const filtered = aPos * value + (1 - aPos) * this.prevFiltered;

    this.prevRaw = value;
    this.prevFiltered = filtered;
    this.prevVelocity = velocity;
    this.prevTs = timestamp;

    return filtered;
  }

  setMinCutoff(value: number) {
    this.minCutoff = value;
  }

  reset() {
    this.firstTime = true;
  }
}
