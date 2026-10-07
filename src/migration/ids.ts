import { createHash } from 'node:crypto';

/** Arbitrary but fixed: every migrated id is derived from it (spec 2 §8). Never change it. */
export const MIGRATION_NAMESPACE = 'c7a1f3d2-8e4b-4c6a-9f0d-2b5e7a9c1d3f';
/** RFC 4122 Appendix C namespaces, for the test vectors. */
export const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
export const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/** RFC 4122 version 5: SHA-1 over namespace bytes + utf8(name), with version and variant bits set. */
export function uuidV5(name: string, namespace: string = MIGRATION_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (ns.length !== 16) throw new Error(`bad namespace uuid ${namespace}`);
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
