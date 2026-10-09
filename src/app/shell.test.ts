import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '../sync/engine';
import { renderShell, shellHtml, type ShellActions, type ShellModel } from './shell';

const STATUS: SyncStatus = { phase: 'idle', online: true, connected: false, queueLength: 0, heldBackCount: 0, issues: [], tooNewSeen: false, emptyFolder: false };
const URL_WITH_QUERY = 'https://www.dropbox.com/oauth2/authorize?client_id=k&response_type=code';

function model(over: Partial<ShellModel> = {}): ShellModel {
  return {
    connected: false, homeScreenHint: false, pasteMode: false, pasteUrl: undefined, status: STATUS,
    counts: { sessions: 0, exercises: 0, bodyweight: 0 }, persisted: true, updateAvailable: false, buildId: 'b1', ...over,
  };
}

const ACTIONS: ShellActions = {
  connect() {}, startPaste() {}, submitCode() {}, syncNow() {}, chooseEmptyFolder() {}, updateApp() {}, signOut() {},
};

/** The few DOM members renderShell uses: innerHTML, querySelector('#code'), the focused element. */
class FakeInput {
  value = '';
  selectionStart: number | null = 0;
  selectionEnd: number | null = 0;
  constructor(private readonly doc: { activeElement: unknown }) {}
  focus(): void { this.doc.activeElement = this; }
  setSelectionRange(start: number | null, end: number | null): void { this.selectionStart = start; this.selectionEnd = end; }
}

function fakeRoot() {
  const doc: { activeElement: unknown } = { activeElement: null };
  let html = '';
  let writes = 0;
  let input: FakeInput | null = null;
  const root = {
    ownerDocument: doc,
    onclick: null,
    get innerHTML() { return html; },
    set innerHTML(value: string) {
      html = value;
      writes += 1;
      if (doc.activeElement === input) doc.activeElement = null; // the old input left the DOM
      input = value.includes('id="code"') ? new FakeInput(doc) : null;
    },
    querySelector: (selector: string) => (selector === '#code' ? input : null),
  };
  return { root: root as unknown as HTMLElement, doc, writes: () => writes, input: () => input };
}

describe('shellHtml, paste the code', () => {
  it('shows the Dropbox link as a real link next to the code field', () => {
    const html = shellHtml(model({ pasteMode: true, pasteUrl: URL_WITH_QUERY }));
    expect(html).toContain('<a href="https://www.dropbox.com/oauth2/authorize?client_id=k&amp;response_type=code" target="_blank" rel="noopener">');
    expect(html).toContain('id="code"');
    expect(html).toContain('data-action="submit-code"');
  });

  it('shows the code field but no link while the login is being prepared', () => {
    const html = shellHtml(model({ pasteMode: true }));
    expect(html).not.toContain('<a href');
    expect(html).toContain('id="code"');
  });

  it('shows neither outside paste mode', () => {
    const html = shellHtml(model());
    expect(html).not.toContain('<a href');
    expect(html).not.toContain('id="code"');
  });
});

describe('renderShell', () => {
  it('leaves the DOM alone when nothing visible changed', () => {
    const f = fakeRoot();
    renderShell(f.root, model({ pasteMode: true, pasteUrl: URL_WITH_QUERY }), ACTIONS);
    renderShell(f.root, model({ pasteMode: true, pasteUrl: URL_WITH_QUERY }), ACTIONS);
    expect(f.writes()).toBe(1);
  });

  it('keeps the typed code, its focus and selection across a re-render', () => {
    const f = fakeRoot();
    renderShell(f.root, model({ pasteMode: true, pasteUrl: URL_WITH_QUERY }), ACTIONS);
    const typed = f.input() as FakeInput;
    typed.value = 'abc123';
    typed.focus();
    typed.setSelectionRange(2, 4);
    renderShell(f.root, model({ pasteMode: true, pasteUrl: URL_WITH_QUERY, loginError: 'login failed' }), ACTIONS);
    const now = f.input() as FakeInput;
    expect(f.writes()).toBe(2);
    expect(now).not.toBe(typed);
    expect(now.value).toBe('abc123');
    expect(f.doc.activeElement).toBe(now);
    expect([now.selectionStart, now.selectionEnd]).toEqual([2, 4]);
  });

  it('does not take the focus for a code field that did not have it', () => {
    const f = fakeRoot();
    renderShell(f.root, model({ pasteMode: true }), ACTIONS);
    (f.input() as FakeInput).value = 'abc';
    renderShell(f.root, model({ pasteMode: true, pasteUrl: URL_WITH_QUERY }), ACTIONS);
    expect((f.input() as FakeInput).value).toBe('abc');
    expect(f.doc.activeElement).toBeNull();
  });
});
