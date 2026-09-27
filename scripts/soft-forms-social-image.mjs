export const socialImage = Object.freeze({
  width: 1200,
  height: 630,
  koreanTitle: '솜결',
  englishTitle: 'Soft Forms',
});

export function drawSocialImage(context, source) {
  if (source.naturalWidth !== socialImage.width || source.naturalHeight !== socialImage.height) {
    throw new Error('The original capture must be a 1200 × 630 PNG.');
  }

  context.canvas.width = socialImage.width;
  context.canvas.height = socialImage.height;
  context.drawImage(source, 0, 0);
  context.fillStyle = '#f8f5ff';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.font = '700 52px "Pretendard Variable"';
  context.fillText(socialImage.koreanTitle, 56, 82);
  context.font = '500 28px "Pretendard Variable"';
  context.fillText(socialImage.englishTitle, 58, 124);
}
