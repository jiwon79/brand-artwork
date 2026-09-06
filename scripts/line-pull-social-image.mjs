export const socialImage = Object.freeze({
  width: 1200,
  height: 630,
  headingHeight: 144,
  title: 'Line Pull',
  series: '바이브코딩으로 예쁜 거 만들기 · 4일차',
});

// Compose only the header. The greeting and folded artwork below it stay intact.
export function drawSocialImage(context, source) {
  const { width, height, headingHeight, title, series } = socialImage;
  if (source.naturalWidth !== width || source.naturalHeight !== height) {
    throw new Error('The original capture must be a 1200 × 630 PNG.');
  }
  context.canvas.width = width;
  context.canvas.height = height;
  context.drawImage(source, 0, 0);
  const shade = context.createLinearGradient(0, 0, 0, headingHeight);
  shade.addColorStop(0, 'rgba(5, 5, 5, 0.94)');
  shade.addColorStop(0.68, 'rgba(5, 5, 5, 0.88)');
  shade.addColorStop(1, 'rgba(5, 5, 5, 0)');
  context.fillStyle = shade;
  context.fillRect(0, 0, width, headingHeight);
  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  context.fillStyle = '#f4f2ec';
  context.font = '800 52px "Pretendard"';
  context.fillText(title, 56, 82);
  context.textAlign = 'right';
  context.fillStyle = '#c5c2bc';
  context.font = '800 22px "Pretendard"';
  context.fillText(series, width - 56, 79);
}
