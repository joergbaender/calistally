// @vitest-environment happy-dom
import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { useBusy } from './use-busy';

function grab() {
  let api: ReturnType<typeof useBusy> | undefined;
  function Probe() {
    api = useBusy();
    return null;
  }
  render(<Probe />);
  if (api === undefined) throw new Error('hook not rendered');
  return api;
}

describe('useBusy', () => {
  it('ignores a second run while the first is pending, and clears busy after it', async () => {
    const { busy, run } = grab();
    let release!: () => void;
    let calls = 0;
    const first = run(() => {
      calls += 1;
      return new Promise<void>((r) => { release = r; });
    });
    expect(busy.value).toBe(true);
    await run(async () => { calls += 1; });
    expect(calls).toBe(1);
    release();
    await first;
    expect(busy.value).toBe(false);
    await run(async () => { calls += 1; });
    expect(calls).toBe(2);
  });

  it('clears busy after a rejection', async () => {
    const { busy, run } = grab();
    await expect(run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(busy.value).toBe(false);
  });
});
