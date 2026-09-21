export const socialImage = Object.freeze({
  width: 1200,
  height: 630,
  title: 'Rose Glass',
  artworkCrop: Object.freeze({ x: 441, y: 32, width: 318, height: 566 }),
  labelX: 32,
  labelY: 24,
  labelHeight: 82,
  labelPaddingX: 24,
  labelRadius: 16,
  labelBackground: 'rgba(255, 255, 255, 0.92)',
  titleColor: '#593d44',
});

// Rotate the portrait artwork clockwise, cover the landscape card, and add its public name.
export function drawSocialImage(context, source) {
  const {
    width,
    height,
    title,
    artworkCrop,
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
  const scale = Math.max(width / artworkCrop.height, height / artworkCrop.width);
  const rotatedWidth = artworkCrop.width * scale;
  const rotatedHeight = artworkCrop.height * scale;
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(Math.PI / 2);
  context.drawImage(
    source,
    artworkCrop.x,
    artworkCrop.y,
    artworkCrop.width,
    artworkCrop.height,
    -rotatedWidth / 2,
    -rotatedHeight / 2,
    rotatedWidth,
    rotatedHeight,
  );
  context.restore();
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
