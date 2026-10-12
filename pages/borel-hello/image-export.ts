import type { Bounds } from './lettering';

interface PhotoOptions {
  paper: string;
  ink: string;
  text: string;
  bounds: Bounds;
}

/** Freeze the current vector view before async image decoding. UI and the touch
 * cursor live outside this SVG, so neither appears in the downloaded image. */
export async function downloadArtworkPhoto(artwork: SVGSVGElement, options: PhotoOptions): Promise<void> {
  const snapshot = artwork.cloneNode(true) as SVGSVGElement;
  const width = 1440, height = 3200;
  const [left, top, right, bottom] = options.bounds;
  // Fit the whole word/rope into a centered wallpaper composition, independent
  // of the browser viewport. Leave room above and below for lock-screen UI.
  const scale = Math.min(width * .8 / Math.max(1, right - left), height * .44 / Math.max(1, bottom - top));
  const viewWidth = width / scale, viewHeight = height / scale;
  snapshot.setAttribute('viewBox', `${(left + right - viewWidth) / 2} ${(top + bottom - viewHeight) / 2} ${viewWidth} ${viewHeight}`);
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
    const download = URL.createObjectURL(photo);
    const link = document.createElement('a');
    link.href = download;
    link.download = `borel-${options.text.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'handwriting'}.png`;
    document.body.append(link); link.click(); link.remove();
    // Give Safari time to consume the object URL after the click handler ends.
    setTimeout(() => URL.revokeObjectURL(download), 60_000);
  } finally {
    URL.revokeObjectURL(source);
    canvas.width = canvas.height = 0;
  }
}
