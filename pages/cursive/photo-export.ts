import { artworkFileName, exportViewBox } from './export-layout';
import type { Bounds } from './coordinates';

interface PhotoOptions {
  paper: string;
  ink: string;
  text: string;
  bounds: Bounds;
}

/** Freeze the current vector view before async image decoding. UI and the touch
 * cursor live outside this SVG, so neither appears in the downloaded image. */
export async function createArtworkPhoto(artwork: SVGSVGElement, options: PhotoOptions): Promise<File> {
  const snapshot = artwork.cloneNode(true) as SVGSVGElement;
  const width = 1440, height = 3200;
  snapshot.setAttribute('viewBox', exportViewBox(options.bounds, width, height));
  snapshot.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  snapshot.setAttribute('width', String(width)); snapshot.setAttribute('height', String(height));
  snapshot.removeAttribute('id'); snapshot.removeAttribute('class');
  snapshot.setAttribute('style', `color: ${options.ink}; overflow: hidden;`);
  const source = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(snapshot)], { type: 'image/svg+xml;charset=utf-8' }));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  try {
    const image = new Image();
    const decoded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('사진을 렌더링하지 못했습니다. 다시 시도해 주세요.'));
    });
    image.src = source; await decoded;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('사진을 저장할 수 없습니다.');
    context.fillStyle = options.paper; context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const photo = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob); else reject(new Error('사진을 저장하지 못했습니다. 다시 시도해 주세요.'));
    }, 'image/png'));
    return new File([photo], artworkFileName(options.text, 'png'), { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(source);
    canvas.width = canvas.height = 0;
  }
}
