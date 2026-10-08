import { describe, expect, it } from 'vitest';
import { buildZip, text } from './test-fixtures';
import { readZip } from './zip';

const decode = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('readZip', () => {
  it('reads stored and deflated entries and skips directories', async () => {
    const zip = await buildZip([
      { name: 'sessions/', data: new Uint8Array(0), method: 'store' },
      { name: 'sessions/2030/a.json', data: text('{"a":1}'), method: 'store' },
      { name: 'sessions/2030/b.json', data: text('{"b":2}'.repeat(50)), method: 'deflate' },
    ]);
    const entries = await readZip(zip.buffer as ArrayBuffer);
    expect(entries.map((e) => e.name)).toEqual(['sessions/2030/a.json', 'sessions/2030/b.json']);
    expect(decode(entries[0]?.bytes as Uint8Array)).toBe('{"a":1}');
    expect(decode(entries[1]?.bytes as Uint8Array)).toBe('{"b":2}'.repeat(50));
  });

  it('uses the central directory sizes when the local header carries a data descriptor', async () => {
    const zip = await buildZip([{ name: 'x.json', data: text('hello world'), method: 'deflate', dataDescriptor: true }]);
    const entries = await readZip(zip.buffer as ArrayBuffer);
    expect(decode(entries[0]?.bytes as Uint8Array)).toBe('hello world');
  });

  it('reads an empty archive', async () => {
    expect(await readZip((await buildZip([])).buffer as ArrayBuffer)).toEqual([]);
  });

  it('rejects a truncated archive and non-zip bytes', async () => {
    const zip = await buildZip([{ name: 'x.json', data: text('hello') }]);
    await expect(readZip(zip.buffer.slice(0, zip.length - 5) as ArrayBuffer)).rejects.toThrow(/zip/);
    await expect(readZip(text('not a zip at all, really').buffer as ArrayBuffer)).rejects.toThrow(/end of central directory/);
  });
});
