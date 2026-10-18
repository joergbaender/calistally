/** A zip reader for Dropbox's download_zip (spec 3 §7): central directory, stored and deflated
 *  entries, no zip64, no encryption. Deflate goes through DecompressionStream('deflate-raw'). */

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** Limits on what one archive may inflate to. A session file is a few KB; the whole history about 1 MB. */
export interface ZipLimits {
  entryBytes: number;
  totalBytes: number;
}

export const ZIP_LIMITS: ZipLimits = { entryBytes: 16 * 1024 * 1024, totalBytes: 256 * 1024 * 1024 };

/** Inflates at most `limit` bytes: undefined as soon as the output would exceed it, so a crafted
 *  entry cannot fill memory before its size is checked. */
export async function inflateRaw(bytes: Uint8Array, limit: number): Promise<Uint8Array | undefined> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

/** Every file entry (directories skipped), in central-directory order. An entry whose declared size
 *  breaks `limits` refuses the archive before that entry is inflated. */
export async function readZip(buffer: ArrayBuffer, limits: ZipLimits = ZIP_LIMITS): Promise<ZipEntry[]> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_SIG) throw new Error('zip: bad central directory entry');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new Error('zip: zip64 is not supported');
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    total += size;
    if (size > limits.entryBytes || total > limits.totalBytes) throw new Error(`zip: ${name} is larger than the limit`);
    if (view.getUint32(localOffset, true) !== LOCAL_SIG) throw new Error(`zip: bad local header for ${name}`);
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > bytes.length) throw new Error(`zip: truncated data for ${name}`);
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    let out: Uint8Array | undefined;
    if (method === 0) out = data.slice();
    else if (method === 8) out = await inflateRaw(data, size);
    else throw new Error(`zip: unsupported compression method ${method} for ${name}`);
    if (out === undefined) throw new Error(`zip: ${name} inflates beyond its declared size`);
    if (out.length !== size) throw new Error(`zip: size mismatch for ${name}`);
    entries.push({ name, bytes: out });
  }
  return entries;
}

function findEocd(view: DataView): number {
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new Error('zip: end of central directory not found');
}
