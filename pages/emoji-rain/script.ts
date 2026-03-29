const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const PAD = 20;

// 4:5 비율 박스 계산
const vw = window.innerWidth  - PAD * 2;
const vh = window.innerHeight - PAD * 2;

let W: number, H: number;
if (vw / vh > 4 / 5) { H = vh; W = Math.floor(H * 4 / 5); }
else                  { W = vw; H = Math.floor(W * 5 / 4); }

const OX = Math.floor((window.innerWidth  - W) / 2);
const OY = Math.floor((window.innerHeight - H) / 2);

canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;

// ─── 이모지 목록 ──────────────────────────────────────────────────────────────
const NEW_EMOJIS = ['🫪','🦣','🩰','🫯','🌊','📦','🐋','🎺'];

const FACE_EMOJIS = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇',
  '🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚',
  '😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸',
  '😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖',
  '😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯',
];

// ─── 그리기 ───────────────────────────────────────────────────────────────────
function draw() {
  // 배경
  ctx.fillStyle = '#E8DDD0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 흰색 4:5 박스
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(OX, OY, W, H, 16);
  ctx.fill();

  // 새 이모지 (크게, 2열 그리드)
  const newSize = Math.floor(W * 0.18);
  const newCols = 4;
  const newRows = Math.ceil(NEW_EMOJIS.length / newCols);
  const cellW = W / newCols;
  const cellH = newSize * 1.4;
  const newStartY = OY + H * 0.08;

  ctx.font = `${newSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  NEW_EMOJIS.forEach((e, i) => {
    const col = i % newCols;
    const row = Math.floor(i / newCols);
    const x = OX + cellW * col + cellW / 2;
    const y = newStartY + row * cellH + cellH / 2;
    ctx.fillText(e, x, y);
  });

  // 구분선
  const dividerY = newStartY + newRows * cellH + H * 0.03;
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(OX + W * 0.05, dividerY);
  ctx.lineTo(OX + W * 0.95, dividerY);
  ctx.stroke();

  // 얼굴 이모지 (작게, 5열 그리드)
  const faceSize = Math.floor(W * 0.09);
  const faceCols = 10;
  const faceCellW = W / faceCols;
  const faceCellH = faceSize * 1.35;
  const faceStartY = dividerY + H * 0.03;

  ctx.font = `${faceSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;

  FACE_EMOJIS.forEach((e, i) => {
    const col = i % faceCols;
    const row = Math.floor(i / faceCols);
    const x = OX + faceCellW * col + faceCellW / 2;
    const y = faceStartY + row * faceCellH + faceCellH / 2;
    ctx.fillText(e, x, y);
  });
}

draw();
