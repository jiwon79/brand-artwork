import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeVideo } from 'mediabunny';
import { GradientInkView } from './gradient-ink-view';
import { penGeometry } from './pen-geometry';
import { strokeState, type PenPlayback } from './pen-playback';
import type { Bounds } from './lettering';
import type { TubeColorMode } from './tube-color';
import { WALLPAPER, wallpaperPlacement, wallpaperFrameProgress } from './wallpaper-timing';
import { waitForWallpaperStep } from './wallpaper-deadline';

export interface WallpaperOptions {
  playback: PenPlayback; bounds: Bounds; weight: number; ink: string; paper: string;
  gradient: boolean; tube: boolean; tubeColor: string; tubeColorMode: TubeColorMode;
}

function svgFrameRenderer(options: WallpaperOptions) {
  const ns = 'http://www.w3.org/2000/svg';
  const element = (tag: string, attrs: Record<string, string> = {}) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const root = element('svg', { xmlns: ns });
  // Bounds are min/max, while SVG viewBox takes width/height.
  root.setAttribute('viewBox', `${options.bounds[0]} ${options.bounds[1]} ${options.bounds[2] - options.bounds[0]} ${options.bounds[3] - options.bounds[1]}`);
  root.setAttribute('color', options.ink);
  const defs = element('defs'), shape = element('g', { id: 'wallpaper-shape' });
  const paths = options.playback.strokes.map(() => element('path', { fill: 'currentColor' }));
  shape.append(...paths);
  const [left, top, right, bottom] = options.bounds;
  const mask = element('mask', { id: 'wallpaper-mask', maskUnits: 'userSpaceOnUse', 'mask-type': 'alpha', x: String(left), y: String(top), width: String(right - left), height: String(bottom - top) });
  mask.append(element('use', { href: '#wallpaper-shape' }));
  defs.append(shape, mask); root.append(defs);
  const gradient = options.gradient ? new GradientInkView('wallpaper') : undefined;
  if (gradient) {
    gradient.setPens(options.playback.strokes.map(stroke => stroke.pen), options.bounds);
    root.append(gradient.definitions, gradient.layer);
    gradient.layer.setAttribute('mask', 'url(#wallpaper-mask)');
  } else root.append(element('use', { href: '#wallpaper-shape' }));
  const place = wallpaperPlacement(options.bounds);
  // Rasterize vectors at twice the output resolution before downsampling.
  // This also supplies the full-resolution, uncompressed still photo.
  root.setAttribute('width', String(Math.ceil(place.width * WALLPAPER.supersample))); root.setAttribute('height', String(Math.ceil(place.height * WALLPAPER.supersample)));
  return async (context: CanvasRenderingContext2D, time: number) => {
    for (const [index, stroke] of options.playback.strokes.entries()) {
      const { written, pressure } = strokeState(stroke, time);
      paths[index].setAttribute('d', written > 0 || stroke.dot && pressure > 0 ? penGeometry(stroke.pen, written, pressure, options.weight) : '');
      gradient?.renderStroke(index, written, pressure, options.weight);
    }
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }));
    try {
      const image = new Image(); image.src = url; await image.decode();
      context.drawImage(image, place.x, place.y, place.width, place.height);
    } finally { URL.revokeObjectURL(url); }
  };
}

/** Offline, frame-indexed encoding. Export never advances the on-screen player. */
export async function exportWallpaper(options: WallpaperOptions, onProgress: (fraction: number) => void) {
  if (!options.playback.strokes.length) throw new Error('먼저 이름을 입력해 주세요.');
  if (!await waitForWallpaperStep(canEncodeVideo('avc', { width: WALLPAPER.width, height: WALLPAPER.height }))) throw new Error('영상 저장을 지원하는 최신 Chrome 또는 Safari에서 열어 주세요.');
  const canvas = document.createElement('canvas'); canvas.width = WALLPAPER.width; canvas.height = WALLPAPER.height;
  const context = canvas.getContext('2d')!;
  const target = new BufferTarget(), output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate: WALLPAPER.bitrate }), keyFrameInterval: .5 });
  output.addVideoTrack(source, { frameRate: WALLPAPER.fps });
  let tube: import('./tube-ink-view').TubeInkView | undefined;
  let tubeCanvas: HTMLCanvasElement | undefined;
  let draw = svgFrameRenderer(options);
  let cover: Blob | undefined;
  try {
    if (options.tube) {
      const { TubeInkView } = await import('./tube-ink-view');
      tubeCanvas = document.createElement('canvas');
      const place = wallpaperPlacement(options.bounds);
      Object.assign(tubeCanvas.style, { position: 'fixed', left: '-10000px', width: `${Math.ceil(place.width)}px`, height: `${Math.ceil(place.height)}px` });
      document.body.append(tubeCanvas);
      tube = new TubeInkView(tubeCanvas, WALLPAPER.supersample); tube.setPlayback(options.playback, options.bounds); tube.setVisible(true);
      draw = async (ctx, time) => {
        tube!.render(time, options.weight, options.tubeColor, options.tubeColorMode);
        ctx.drawImage(tubeCanvas!, place.x, place.y, place.width, place.height);
      };
    }
    await waitForWallpaperStep(output.start());
    const count = WALLPAPER.duration * WALLPAPER.fps;
    for (let index = 0; index < count; index++) {
      const seconds = index / WALLPAPER.fps;
      context.fillStyle = options.tube ? '#eee7ff' : options.paper;
      context.fillRect(0, 0, canvas.width, canvas.height);
      await waitForWallpaperStep(draw(context, wallpaperFrameProgress(index) * options.playback.duration));
      if (index === Math.round(WALLPAPER.poster * WALLPAPER.fps)) {
        const still = document.createElement('canvas');
        still.width = canvas.width * WALLPAPER.supersample; still.height = canvas.height * WALLPAPER.supersample;
        const stillContext = still.getContext('2d')!;
        stillContext.scale(WALLPAPER.supersample, WALLPAPER.supersample);
        stillContext.fillStyle = context.fillStyle; stillContext.fillRect(0, 0, canvas.width, canvas.height);
        await waitForWallpaperStep(draw(stillContext, options.playback.duration));
        cover = await waitForWallpaperStep(new Promise<Blob>((resolve, reject) => still.toBlob(blob => blob ? resolve(blob) : reject(new Error('완성 이미지를 만들지 못했습니다.')), 'image/png')));
      }
      await waitForWallpaperStep(source.add(seconds, 1 / WALLPAPER.fps));
      onProgress((index + 1) / count);
    }
    source.close(); await waitForWallpaperStep(output.finalize());
    if (!target.buffer || !cover) throw new Error('영상 생성에 실패했습니다.');
    return { video: new Blob([target.buffer], { type: 'video/mp4' }), cover };
  } catch (error) {
    // Do not keep the editor locked while a stalled browser encoder is being closed.
    void output.cancel().catch(() => {}); throw error;
  } finally { tube?.dispose(); tubeCanvas?.remove(); }
}
