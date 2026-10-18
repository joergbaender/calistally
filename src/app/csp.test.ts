import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Spec 3 §3: the meta tag is the only CSP the app gets (Pages sets no headers), so it stays tight. */
function csp(): Map<string, string[]> {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const content = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1];
  if (content === undefined) throw new Error('index.html has no Content-Security-Policy meta tag');
  return new Map(content.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0] !== '').map(([name, ...values]) => [name as string, values]));
}

describe('Content-Security-Policy', () => {
  it('allows no inline or eval code anywhere', () => {
    for (const [name, values] of csp()) {
      expect(values, name).not.toContain("'unsafe-inline'");
      expect(values, name).not.toContain("'unsafe-eval'");
    }
  });

  it('loads scripts and styles from the app only and no plugins', () => {
    const policy = csp();
    expect(policy.get('script-src')).toEqual(["'self'"]);
    expect(policy.get('style-src')).toEqual(["'self'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
  });

  it('connects to the app and the two Dropbox API hosts only', () => {
    expect(csp().get('connect-src')).toEqual(["'self'", 'https://api.dropboxapi.com', 'https://content.dropboxapi.com']);
  });
});
