export const socialImage = Object.freeze({
  width: 1200,
  height: 630,
  title: 'Cursor Cat',
});

// Preserve the capture and place the title in the empty upper-left corner.
export function drawSocialImage(context, source) {
  const { width, height, title } = socialImage;
  if (source.naturalWidth !== width || source.naturalHeight !== height) {
    throw new Error('The original capture must be a 1200 × 630 PNG.');
  }
  context.canvas.width = width;
  context.canvas.height = height;
  context.drawImage(source, 0, 0);
  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  context.fillStyle = '#161616';
  context.font = '800 52px "Pretendard"';
  context.fillText(title, 56, 82);
}
