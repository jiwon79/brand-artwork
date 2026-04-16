declare class Hands {
  constructor(config: { locateFile: (file: string) => string });
  setOptions(options: Record<string, unknown>): void;
  onResults(callback: (results: HandResults) => void): void;
  send(input: { image: HTMLVideoElement }): Promise<void>;
}

declare const HAND_CONNECTIONS: Array<[number, number]>;

declare function drawConnectors(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  connections: Array<[number, number]>,
  style: Record<string, unknown>,
): void;

declare function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  style: Record<string, unknown>,
): void;

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface HandResults {
  multiHandLandmarks?: Landmark[][];
}

const isMobile = /Mobi|Android/i.test(navigator.userAgent);

export function initHandTracker(onResults: (results: HandResults) => void) {
  const hands = new Hands({
    locateFile: (file: string) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: isMobile ? 0 : 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
  });

  hands.onResults(onResults);

  return {
    hands,
    sendFrame: (image: HTMLVideoElement) => hands.send({ image }),
  };
}

export function drawHandLandmarks(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
) {
  if (typeof drawConnectors === 'undefined') return;

  drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
    color: 'rgba(200,200,200,0.40)',
    lineWidth: 1,
  });

  drawLandmarks(ctx, landmarks, {
    color: 'rgba(255,255,255,0.75)',
    fillColor: 'rgba(160,160,160,0.55)',
    radius: 1.5,
  });
}

export function drawPinchLine(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
) {
  const thumb = landmarks[4];
  const index = landmarks[8];
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.beginPath();
  ctx.moveTo(thumb.x * w, thumb.y * h);
  ctx.lineTo(index.x * w, index.y * h);
  ctx.strokeStyle = 'rgba(100,220,100,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
}
