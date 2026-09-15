export const socialImage = Object.freeze({
  width: 1200,
  height: 630,
  title: 'Smile Flower',
  labelX: 32,
  labelY: 24,
  labelHeight: 82,
  labelPaddingX: 24,
  labelRadius: 16,
  labelBackground: 'rgba(255, 255, 255, 0.92)',
});

// Preserve the artwork capture and place the title in the standard upper-left position.
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
  context.fillStyle = '#161616';
  context.fillText(title, 56, 82);
}
