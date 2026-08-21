import { settings } from './config';
import { DragDissolve } from './drag-dissolve';
import { FigureRenderer } from './figure-renderer';
import { renderStageState } from './render-stages';
import { BodyEchoRuntime } from './runtime';
import { WaveRenderer } from './wave-renderer';

/** Orchestrates offscreen passes and composites the final canvas. */
export class ArtworkRenderer {
  private readonly figures: FigureRenderer;
  private readonly wave: WaveRenderer;

  constructor(
    private readonly runtime: BodyEchoRuntime,
    private readonly drag: DragDissolve,
    private readonly screenCtx: CanvasRenderingContext2D,
    private readonly artworkCanvas: HTMLCanvasElement,
    private readonly artworkCtx: CanvasRenderingContext2D,
  ) {
    this.figures = new FigureRenderer(runtime, drag, artworkCtx);
    this.wave = new WaveRenderer(runtime, artworkCtx);
  }

  render(now: number): void {
    this.clearArtworkLayer();
    if (this.runtime.phase !== 'blank') {
      if (renderStageState.current >= 3 && !this.runtime.isPreviousContactRelease()) {
        this.wave.render(now);
      }
      this.figures.render(now);
      this.drag.renderConnector();
      if (renderStageState.current >= 2) this.wave.renderContact(now);
      if (renderStageState.current >= 3 && this.runtime.isPreviousContactRelease()) {
        this.wave.render(now);
      }
    }
    this.compositeToScreen();
  }

  private clearArtworkLayer(): void {
    const { artworkCtx: ctx, runtime } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, runtime.view.width, runtime.view.height);
  }

  private compositeToScreen(): void {
    const { screenCtx: ctx, runtime } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, runtime.view.width, runtime.view.height);
    if (settings.glow > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = settings.glow;
      ctx.filter = `blur(${Math.max(0.55, 1.5 * runtime.view.fit)}px)`;
      ctx.drawImage(this.artworkCanvas, 0, 0);
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.artworkCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    this.renderScanlines();
  }

  private renderScanlines(): void {
    if (settings.scanlines <= 0) return;
    this.screenCtx.fillStyle = `rgba(0, 0, 0, ${settings.scanlines})`;
    for (let y = 1; y < this.runtime.view.height; y += 3) {
      this.screenCtx.fillRect(0, y, this.runtime.view.width, 1);
    }
  }
}
