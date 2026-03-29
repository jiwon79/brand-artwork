const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;

ctx.fillStyle = '#FFF8F0';
ctx.fillRect(0, 0, canvas.width, canvas.height);

ctx.font = '80px sans-serif';
ctx.textBaseline = 'middle';
ctx.textAlign = 'center';
ctx.fillText('😀', canvas.width / 2, canvas.height / 2);
