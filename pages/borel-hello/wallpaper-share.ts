export interface FileShareTarget {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
}

export function canShareWallpaper(target: FileShareTarget, file: File) {
  try { return Boolean(target.share && target.canShare?.({ files: [file] })); }
  catch { return false; }
}

/** Call synchronously from a click: fetching or encoding here would lose activation. */
export async function shareWallpaper(target: FileShareTarget, file: File): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShareWallpaper(target, file)) return 'unsupported';
  try {
    await target.share!({ files: [file] });
    // This acknowledges the share sheet only, not a Photos-library save.
    return 'shared';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    throw error;
  }
}
