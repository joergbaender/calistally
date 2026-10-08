/** Test helpers for the sync layer: a zip writer (the reader's counterpart) and small builders. */

export interface ZipInput {
  name: string;
  data: Uint8Array;
  method?: 'store' | 'deflate';
  /** Write zeroed sizes in the local header and a data descriptor after the data (general-purpose bit 3). */
  dataDescriptor?: boolean;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = (CRC_TABLE[(crc ^ b) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A valid zip of the given entries. */
export async function buildZip(inputs: ZipInput[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const input of inputs) {
    const method = input.method ?? 'deflate';
    const data = method === 'deflate' ? await deflateRaw(input.data) : input.data;
    const name = new TextEncoder().encode(input.name);
    const crc = crc32(input.data);
    const flags = input.dataDescriptor ? 0x0008 : 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method === 'deflate' ? 8 : 0, true);
    local.setUint32(14, input.dataDescriptor ? 0 : crc, true);
    local.setUint32(18, input.dataDescriptor ? 0 : data.length, true);
    local.setUint32(22, input.dataDescriptor ? 0 : input.data.length, true);
    local.setUint16(26, name.length, true);
    const localBytes = concat([new Uint8Array(local.buffer), name, data]);
    let descriptor = new Uint8Array(0);
    if (input.dataDescriptor) {
      const d = new DataView(new ArrayBuffer(16));
      d.setUint32(0, 0x08074b50, true);
      d.setUint32(4, crc, true);
      d.setUint32(8, data.length, true);
      d.setUint32(12, input.data.length, true);
      descriptor = new Uint8Array(d.buffer);
    }
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, flags, true);
    header.setUint16(10, method === 'deflate' ? 8 : 0, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, data.length, true);
    header.setUint32(24, input.data.length, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);
    central.push(concat([new Uint8Array(header.buffer), name]));
    parts.push(localBytes, descriptor);
    offset += localBytes.length + descriptor.length;
  }
  const centralBytes = concat(central);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, inputs.length, true);
  eocd.setUint16(10, inputs.length, true);
  eocd.setUint32(12, centralBytes.length, true);
  eocd.setUint32(16, offset, true);
  return concat([...parts, centralBytes, new Uint8Array(eocd.buffer)]);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export const text = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Manual timers for the engine's debounce and backoff; `advance` fires what is due, in order. */
export class FakeTimers {
  now = 0;
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; fn: () => void }>();

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.pending.set(id, { at: this.now + ms, fn });
    return id;
  }

  clearTimeout(id: unknown): void {
    this.pending.delete(id as number);
  }

  /** Delays of the timers still pending, soonest first. */
  due(): number[] {
    return [...this.pending.values()].map((p) => p.at - this.now).sort((a, b) => a - b);
  }

  /** Moves the clock forward, firing due timers one by one and awaiting `settle` after each. */
  async advance(ms: number, settle: () => Promise<void> = async () => undefined): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const next = [...this.pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (next === undefined || next[1].at > target) break;
      this.pending.delete(next[0]);
      this.now = next[1].at;
      next[1].fn();
      await settle();
    }
    this.now = target;
  }
}
