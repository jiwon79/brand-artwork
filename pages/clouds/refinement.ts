/** Motion may use adaptive Gaussian LOD; the finished image always uses 1x. */
export class MotionRefinement {
  private key: string | undefined;
  private changedAt = -Infinity;
  active = false;
  constructor(readonly idleDelay = 180) {}
  update(now: number, viewKey: string, animated = false): boolean {
    if (this.key !== undefined && this.key !== viewKey) this.changedAt = now;
    this.key = viewKey;
    const active = animated || now - this.changedAt < this.idleDelay;
    const changed = active !== this.active;
    this.active = active; return changed;
  }
}
