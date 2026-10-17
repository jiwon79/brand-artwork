import { FRAME_DISK_LIMIT, FRAME_REVISION, frameBytes, validCompletedFrame, type CompletedFrame } from './completed-frame';

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('studio-clouds-hdr', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('frames'); request.result.createObjectStore('metadata');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => { database = undefined; reject(request.error); };
  });
}
async function read(key: string) {
  const db = await openDatabase();
  return new Promise<CompletedFrame | undefined>((resolve, reject) => {
    const request = db.transaction('frames').objectStore('frames').get(key);
    request.onsuccess = () => resolve(validCompletedFrame(request.result) ? request.result : undefined);
    request.onerror = () => reject(request.error);
  });
}
async function write(key: string, frame: CompletedFrame) {
  if (!validCompletedFrame(frame)) return false;
  const db = await openDatabase(), bytes = frameBytes(frame);
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(['frames', 'metadata'], 'readwrite');
    const frames = tx.objectStore('frames'), metadata = tx.objectStore('metadata');
    // Iterate tiny metadata records, never deserialize other HDR payloads.
    const request = metadata.openCursor(), entries: { key: IDBValidKey; bytes: number; at: number }[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        if (!String(cursor.key).includes(FRAME_REVISION)) { frames.delete(cursor.key); cursor.delete(); }
        else if (cursor.key !== key) entries.push({ key: cursor.key, ...cursor.value });
        cursor.continue(); return;
      }
      entries.sort((a, b) => a.at - b.at);
      let total = entries.reduce((sum, entry) => sum + entry.bytes, bytes);
      for (const entry of entries) {
        if (total <= FRAME_DISK_LIMIT) break;
        frames.delete(entry.key); metadata.delete(entry.key); total -= entry.bytes;
      }
      frames.put(frame, key); metadata.put({ bytes, at: Date.now() }, key);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
self.onmessage = async ({ data }: MessageEvent<{ id: number; type: 'get' | 'put'; key: string; frame?: CompletedFrame }>) => {
  const { id, type, key, frame } = data;
  try {
    if (type === 'put' && frame) self.postMessage({ id, type, key, stored: await write(key, frame) });
    else {
      const result = await read(key);
      const buffers = result ? [...new Set(result.planes.map(plane => plane.buffer as ArrayBuffer))] : [];
      self.postMessage({ id, type, key, frame: result }, { transfer: buffers });
    }
  } catch { self.postMessage({ id, type, key, stored: false }); }
};
