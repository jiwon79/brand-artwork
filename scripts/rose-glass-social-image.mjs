export const socialImage = Object.freeze({
  width: 1200,
  height: 630,
  title: '장밋빛 유리',
  labelX: 32,
  labelY: 24,
  labelHeight: 82,
  labelPaddingX: 24,
  labelRadius: 16,
  labelBackground: 'rgba(255, 255, 255, 0.92)',
  titleColor: '#593d44',
});

// Preserve the live artwork capture and add only the public artwork name.
export function drawSocialImage(context, source) {
  const {
    width,
    height,
    title,
    labelX,
    labelY,
    labelHeight,
    labelPaddingX,
    labelRadius,
    labelBackground,
    titleColor,
  } = socialImage;
  if (source.naturalWidth !== width || source.naturalHeight !== height) {
    throw new Error('The original capture must be a 1200 × 630 PNG.');
  }
  context.canvas.width = width;
  context.canvas.height = height;
  context.drawImage(source, 0, 0);
  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  context.font = '700 52px "Pretendard Variable"';
  const labelWidth = Math.ceil(context.measureText(title).width) + labelPaddingX * 2;
  context.fillStyle = labelBackground;
  context.beginPath();
  context.roundRect(labelX, labelY, labelWidth, labelHeight, labelRadius);
  context.fill();
  context.fillStyle = titleColor;
  context.fillText(title, 56, 82);
}
