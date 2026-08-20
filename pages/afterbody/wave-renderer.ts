import { DESIGN_WIDTH, settings } from './config';
import { clamp, smoothstep } from './math';
import { AfterbodyRuntime } from './runtime';
import { waveRadiusForProgress } from './wave-timing';

/** Draws the release wave as a separate pass so its timing matches particle scheduling. */
export class WaveRenderer {
  constructor(
    private readonly runtime: AfterbodyRuntime,
    private readonly ctx: CanvasRenderingContext2D,
  ) {}

  render(now: number): void {
    const { runtime, ctx } = this;
    if (runtime.phase !== 'dissolving' || !runtime.isNameDropWave()) return;
    const releaseAge = runtime.motionElapsed(now) - runtime.contactReleaseTime();
    const centerX = runtime.view.offsetX + runtime.contactOrigin.x * runtime.view.fit;
    const centerY = runtime.view.offsetY + runtime.contactOrigin.y * runtime.view.fit;
    if (runtime.isPreviousContactRelease()) {
      this.renderPrevious(centerX, centerY, releaseAge);
      return;
    }

    const duration = Math.max(0.001, settings.contactWaveDuration);
    const progress = clamp(releaseAge / duration, 0, 1);
    const waveFade = Math.exp(-Math.max(0, releaseAge - duration * 0.46) / (duration * 0.5));
    const rimFade = Math.exp(-Math.max(0, releaseAge - duration * 0.38) / (duration * 0.38));
    const radius = Math.max(
      1,
      waveRadiusForProgress(progress, runtime.contactWaveExtent()) * runtime.view.fit,
    );
    const bandWidth = Math.max(
      1,
      settings.contactWaveBandWidth * (0.82 + progress * 0.36) * runtime.view.fit,
    );
    const alpha = smoothstep(releaseAge / 0.14)
      * waveFade * settings.contactWaveBrightness;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = `blur(${Math.max(1.2, 2.6 * runtime.view.fit)}px)`;
    this.drawBand(centerX, centerY, radius - bandWidth * 0.7, bandWidth * 1.34, alpha * 0.36);
    this.drawBand(centerX, centerY, radius, bandWidth, alpha * 0.62);
    ctx.filter = `blur(${Math.max(1, 1.55 * runtime.view.fit)}px)`;
    this.drawCrest(centerX, centerY, radius, bandWidth, alpha * rimFade * 0.86);
    ctx.restore();
  }

  private renderPrevious(centerX: number, centerY: number, releaseAge: number): void {
    const { runtime, ctx } = this;
    const duration = Math.max(0.001, settings.contactWaveDuration);
    const progress = clamp(releaseAge / duration, 0, 1);
    const fade = smoothstep((releaseAge - duration * 0.82) / (duration * 0.32));
    const radius = Math.max(1, progress * DESIGN_WIDTH * 0.72 * runtime.view.fit);
    const width = Math.max(1, settings.contactWaveBandWidth * runtime.view.fit);
    const alpha = smoothstep(releaseAge / 0.1) * (1 - fade) * 0.24;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    this.drawPreviousBand(centerX, centerY, radius - width * 1.15, width * 0.72, alpha * 0.34);
    this.drawPreviousBand(centerX, centerY, radius, width, alpha);
    ctx.restore();
  }

  private drawPreviousBand(
    centerX: number,
    centerY: number,
    radius: number,
    width: number,
    opacity: number,
  ): void {
    if (radius <= 0 || opacity <= 0) return;
    const outerRadius = radius + width * 0.42;
    const gradient = this.ctx.createRadialGradient(
      centerX,
      centerY,
      Math.max(0, radius - width),
      centerX,
      centerY,
      outerRadius,
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.32, 'rgba(98, 171, 216, 0.18)');
    gradient.addColorStop(0.68, 'rgba(194, 231, 246, 0.52)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    this.fillGradient(centerX, centerY, outerRadius, gradient, opacity);
  }

  private drawBand(
    centerX: number,
    centerY: number,
    radius: number,
    width: number,
    opacity: number,
  ): void {
    if (radius <= 0 || opacity <= 0) return;
    const outerRadius = radius + width * 0.38;
    const gradient = this.ctx.createRadialGradient(
      centerX,
      centerY,
      Math.max(0, radius - width * 1.45),
      centerX,
      centerY,
      outerRadius,
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.22, 'rgba(85, 126, 148, 0.055)');
    gradient.addColorStop(0.5, 'rgba(158, 193, 208, 0.18)');
    gradient.addColorStop(0.74, 'rgba(119, 165, 187, 0.1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    this.fillGradient(centerX, centerY, outerRadius, gradient, opacity);
  }

  private drawCrest(
    centerX: number,
    centerY: number,
    radius: number,
    width: number,
    opacity: number,
  ): void {
    if (radius <= 0 || opacity <= 0) return;
    const outerRadius = radius + width * 0.22;
    const gradient = this.ctx.createRadialGradient(
      centerX,
      centerY,
      Math.max(0, radius - width * 0.86),
      centerX,
      centerY,
      outerRadius,
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.42, 'rgba(178, 211, 224, 0.09)');
    gradient.addColorStop(0.67, 'rgba(229, 242, 247, 0.24)');
    gradient.addColorStop(0.8, 'rgba(240, 248, 251, 0.32)');
    gradient.addColorStop(0.9, 'rgba(204, 227, 236, 0.15)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    this.fillGradient(centerX, centerY, outerRadius, gradient, opacity);
  }

  private fillGradient(
    centerX: number,
    centerY: number,
    radius: number,
    gradient: CanvasGradient,
    opacity: number,
  ): void {
    this.ctx.globalAlpha = opacity;
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  }
}
