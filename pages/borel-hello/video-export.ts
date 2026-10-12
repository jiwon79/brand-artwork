import type { Bounds } from './lettering';
import { GradientInkView } from './gradient-ink-view';
import { penGeometry } from './pen-geometry';
import { strokeState, type PenPlayback } from './pen-playback';

export const videoTypes = ['video/mp4;codecs=avc1.42E033', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
export function chooseVideoType(supported: (type: string) => boolean): string {
  const type = videoTypes.find(supported);
  if (!type) throw new Error('이 브라우저는 영상 저장을 지원하지 않습니다. 최신 Safari 또는 Chrome에서 열어 주세요.');
  return type;
}
export function videoTime(elapsed: number, duration: number, speed: number): number {
  return Math.min(duration, Math.max(0, elapsed) * speed);
}
interface VideoOptions {
  playback: PenPlayback; bounds: Bounds; text: string; ink: string; paper: string;
  weight: number; gradient: boolean; speed: number;
  onProgress: (fraction: number) => void;
}

/** Independent vector renderer: exporting never seeks the live player or rope.
 * Capture real-time canvas frames, then hold the completed word for one second. */
export async function createArtworkVideo(options: VideoOptions): Promise<File> {
  if (typeof MediaRecorder === 'undefined') throw new Error('이 브라우저는 영상 저장을 지원하지 않습니다.');
  const mimeType = chooseVideoType(type => MediaRecorder.isTypeSupported(type));
  const width = 1080, height = 2400, fps = 30;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context || !canvas.captureStream) throw new Error('이 브라우저는 영상 렌더링을 지원하지 않습니다.');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const [left, top, right, bottom] = options.bounds;
  const scale = Math.min(width * .8 / Math.max(1, right - left), height * .44 / Math.max(1, bottom - top));
  svg.setAttribute('viewBox', `${(left + right - width / scale) / 2} ${(top + bottom - height / scale) / 2} ${width / scale} ${height / scale}`);
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  svg.style.color = options.ink;
  const gradient = new GradientInkView('borel-video');
  const paths = options.playback.strokes.map(() => {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('fill', options.ink); return path;
  });
  if (options.gradient) {
    gradient.setPens(options.playback.strokes.map(stroke => stroke.pen));
    svg.append(gradient.definitions, gradient.layer);
  } else svg.append(...paths);
  const draw = async (time: number) => {
    options.playback.strokes.forEach((stroke, i) => {
      const { written, pressure } = strokeState(stroke, time);
      if (options.gradient) gradient.renderStroke(i, written, pressure, options.weight);
      else paths[i].setAttribute('d', written > 0 ? penGeometry(stroke.pen, written, pressure, options.weight) : '');
    });
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      const decoded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve(); image.onerror = () => reject(new Error('영상 프레임을 그리지 못했습니다.'));
      });
      image.src = url; await decoded;
      context.fillStyle = options.paper; context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
    } finally { URL.revokeObjectURL(url); }
  };
  // Automatic capture also works on Safari without requestFrame().
  const stream = canvas.captureStream(fps);
  let recorder: MediaRecorder | undefined;
  let failure: Error | undefined;
  try {
    await draw(0);
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 16_000_000 });
    const chunks: Blob[] = [];
    const stopped = new Promise<void>(resolve => {
      recorder!.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder!.onstop = () => resolve();
      recorder!.onerror = () => { failure = new Error('영상을 인코딩하지 못했습니다. 다시 시도해 주세요.'); };
    });
    recorder.start();
    const duration = options.playback.duration / options.speed + 1;
    const started = performance.now();
    let elapsed = 0;
    do {
      if (document.hidden) throw new Error('영상 저장 중에는 이 탭을 열어 두세요. 다시 시도해 주세요.');
      if (failure) throw failure;
      const frameStart = performance.now();
      elapsed = (frameStart - started) / 1000;
      await draw(videoTime(elapsed, options.playback.duration, options.speed));
      options.onProgress(Math.min(1, elapsed / duration));
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 1000 / fps - (performance.now() - frameStart))));
    } while (elapsed < duration);
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    if (failure) throw failure;
    const blob = new Blob(chunks, { type: recorder.mimeType });
    if (!blob.size) throw new Error('빈 영상이 생성됐습니다. 다시 시도해 주세요.');
    const extension = recorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
    const name = options.text.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'handwriting';
    return new File([blob], `borel-${name}.${extension}`, { type: recorder.mimeType });
  } finally {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream.getTracks().forEach(track => track.stop());
    canvas.width = canvas.height = 0;
  }
}
