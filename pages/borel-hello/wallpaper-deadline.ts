/** Capability checks can succeed even when a browser's encoder never returns frames. */
export async function waitForWallpaperStep<T>(operation: Promise<T>, timeout = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('이 브라우저에서 영상 생성이 멈췄습니다. 새로고침 후 다시 시도해 주세요. 계속 멈추면 Mac이나 PC의 Chrome에서 만들고 아이폰으로 다운로드해 주세요.')), timeout);
    })]);
  } finally { clearTimeout(timer); }
}
