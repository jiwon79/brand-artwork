type ShareNavigator = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints' | 'share' | 'canShare'> & {
  userActivation?: Pick<UserActivation, 'isActive'>;
};

export function prefersFileShare(host: Pick<ShareNavigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator): boolean {
  return /iPhone|iPad|iPod/.test(host.userAgent) || host.platform === 'MacIntel' && host.maxTouchPoints > 1;
}

/** Share the artwork file alone, without a URL or text attachment.
 * A slow encode can outlast Safari's transient activation. Keep the prepared
 * file and retry directly from a fresh tap rather than downloading it. */
export async function shareArtworkFile(file: File, host: ShareNavigator = navigator): Promise<'shared' | 'cancelled' | 'retry'> {
  const data = { files: [file] };
  if (!host.share || !host.canShare?.(data)) {
    throw new Error('이 브라우저는 이 파일의 공유를 지원하지 않습니다. 아이폰 Safari에서 열어 주세요.');
  }
  if (host.userActivation?.isActive === false) return 'retry';
  try {
    await host.share(data);
    return 'shared';
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'AbortError') return 'cancelled';
    if (name === 'NotAllowedError') return 'retry';
    throw error;
  }
}

export function downloadArtworkFile(file: File): void {
  const download = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = download; link.download = file.name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(download), 60_000);
}
