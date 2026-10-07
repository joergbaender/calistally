import { describe, expect, it } from 'vitest';
import { UUID_PATTERN } from '../model/schema';
import { DNS_NAMESPACE, MIGRATION_NAMESPACE, URL_NAMESPACE, uuidV5 } from './ids';

describe('uuidV5', () => {
  it('matches the published RFC 4122 v5 vectors', () => {
    expect(uuidV5('hello.example.com', DNS_NAMESPACE)).toBe('fdda765f-fc57-5604-a269-52a7df8164ec');
    expect(uuidV5('www.example.com', DNS_NAMESPACE)).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(uuidV5('https://www.w3.org/', URL_NAMESPACE)).toBe('c106a26a-21bb-5538-8bf2-57095d1976c1');
  });

  it('uses the migration namespace by default and satisfies the schema pattern', () => {
    const id = uuidV5('session/Pull!6');
    expect(id).toBe(uuidV5('session/Pull!6', MIGRATION_NAMESPACE));
    expect(new RegExp(UUID_PATTERN).test(id)).toBe(true);
    expect(id[14]).toBe('5');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('is deterministic and name-sensitive', () => {
    expect(uuidV5('session/Pull!6')).toBe(uuidV5('session/Pull!6'));
    expect(uuidV5('session/Pull!6')).not.toBe(uuidV5('session/Pull!7'));
    expect(uuidV5('session/Pull!6')).not.toBe(uuidV5('session/Pull!6', DNS_NAMESPACE));
  });

  it('rejects a malformed namespace', () => {
    expect(() => uuidV5('x', 'not-a-uuid')).toThrow(/namespace/);
  });
});
