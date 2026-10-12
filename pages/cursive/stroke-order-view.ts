import { activeOrderStep, createStrokeOrder, orderTip, type OrderStep } from './stroke-order';
import type { PenPlayback } from './pen-playback';

const NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}
export const stepName = { ink: '그리기', dot: '점 찍기', retrace: '되짚기', lift: '펜을 뗀 이동' };

/** An overlay of the same sampled Bézier centerline used by the ink renderer. */
export class StrokeOrderView {
  readonly layer = svg('g', { 'pointer-events': 'none', 'aria-hidden': 'true' });
  steps: OrderStep[] = [];
  private groups: { group: SVGGElement; label: SVGGElement; line: SVGPathElement }[] = [];
  private tip = svg('circle', { r: '22', fill: '#fff', stroke: '#172d42', 'stroke-width': '9' });
  private active = -2;

  setPlayback(playback: PenPlayback) {
    this.steps = createStrokeOrder(playback);
    this.layer.replaceChildren(); this.groups = []; this.active = -2;
    for (const step of this.steps) {
      const group = svg('g', { fill: step.color, stroke: step.color });
      const line = svg('path', { d: step.d, fill: 'none', 'stroke-width': '10', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      if (step.kind === 'lift') line.setAttribute('stroke-dasharray', '20 18');
      const arrow = svg('path', { d: 'M-18 -12L0 0L-18 12', fill: 'none', 'stroke-width': '9', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', transform: `translate(${step.arrow.x} ${step.arrow.y}) rotate(${step.arrow.angle * 180 / Math.PI})` });
      if (step.kind === 'dot') group.append(svg('circle', { cx: String(step.arrow.x), cy: String(step.arrow.y), r: '14', stroke: 'none' }));
      else group.append(arrow);
      group.prepend(line);
      const label = svg('g', {});
      label.append(svg('path', { d: `M${step.arrow.x} ${step.arrow.y}L${step.label.x} ${step.label.y}`, fill: 'none', 'stroke-width': '2', opacity: '.45' }));
      label.append(svg('circle', { cx: String(step.label.x), cy: String(step.label.y), r: '38', fill: '#fff', 'stroke-width': '3' }));
      const number = svg('text', { x: String(step.label.x), y: String(step.label.y + 18), 'text-anchor': 'middle', 'font-size': '50', 'font-family': 'system-ui, sans-serif', 'font-weight': '600', stroke: 'none' });
      number.textContent = String(step.index + 1); label.append(number); group.append(label);
      this.layer.append(group); this.groups.push({ group, label, line });
    }
    this.layer.append(this.tip);
  }

  render(playback: PenPlayback, time: number) {
    const active = activeOrderStep(this.steps, time);
    if (active !== this.active) {
      // Restore chronological stacking before raising the new active interval,
      // so the same frame looks identical when scrubbing in either direction.
      if (this.active >= 0) this.layer.insertBefore(this.groups[this.active].group, this.groups[this.active + 1]?.group ?? this.tip);
      for (const [index, { group, label, line }] of this.groups.entries()) {
        group.setAttribute('opacity', index === active ? '1' : index < active ? '.75' : '.32');
        line.setAttribute('stroke-width', index === active ? '17' : '10');
        label.style.display = this.steps.length <= 60 || Math.abs(index - active) <= 2 ? '' : 'none';
      }
      // Keep the active direction and its number readable at intersections.
      if (active >= 0) this.layer.append(this.groups[active].group, this.tip);
      this.active = active;
    }
    this.tip.style.display = active < 0 ? 'none' : '';
    if (active >= 0) {
      const step = this.steps[active], tip = orderTip(playback, step, time);
      this.tip.setAttribute('cx', String(tip.x)); this.tip.setAttribute('cy', String(tip.y));
      this.tip.setAttribute('stroke', step.color);
      this.tip.setAttribute('stroke-dasharray', step.kind === 'lift' ? '8 8' : 'none');
    }
    return active;
  }
}
