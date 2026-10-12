import { randomUUID } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';

const metadata = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PFVideoComplementMetadataVersionKey</key><string>1</string>
</dict></plist>
`;

/** Keep the already paired media intact; Quick Look needs the PVT package wrapper. */
export function livePhotoPackage(still: Uint8Array, movie: Uint8Array, requestedName = 'borel-name') {
  const name = requestedName.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'borel-name';
  const folder = `${name}.pvt`;
  return {
    filename: `${folder}.zip`,
    archive: zipSync({
      [`${folder}/${name}.HEIC`]: [still, { level: 0 }],
      [`${folder}/${name}.MOV`]: [movie, { level: 0 }],
      [`${folder}/metadata.plist`]: [strToU8(metadata), { level: 0 }],
    }),
  };
}

export const livePhotoDownloadRoute = '/api/borel-live-photo/download/';
const lifetime = 10 * 60_000;

/** Short-lived HTTP downloads let Safari open the package from its Downloads list. */
export class LivePhotoDownloads {
  private files = new Map<string, { filename: string; archive: Uint8Array; expiresAt: number; timer: NodeJS.Timeout }>();

  add(file: ReturnType<typeof livePhotoPackage>) {
    // Bound retained media on the local converter, even across multiple clients.
    while (this.files.size >= 4) this.remove(this.files.keys().next().value!);
    const downloadURL = `${livePhotoDownloadRoute}${randomUUID()}/${file.filename}`;
    const expiresAt = Date.now() + lifetime;
    const timer = setTimeout(() => this.remove(downloadURL), lifetime);
    timer.unref();
    this.files.set(downloadURL, { ...file, expiresAt, timer });
    return { downloadURL, filename: file.filename, expiresAt };
  }

  get(path: string) {
    const file = this.files.get(path);
    if (file && Date.now() < file.expiresAt) return file;
    this.remove(path);
    return undefined;
  }

  private remove(path: string) {
    const file = this.files.get(path);
    if (file) clearTimeout(file.timer);
    this.files.delete(path);
  }

  clear() { for (const path of this.files.keys()) this.remove(path); }
}
