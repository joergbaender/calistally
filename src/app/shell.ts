import type { EmptyFolderChoice, SyncStatus } from '../sync/engine';

/** The diagnostic shell (spec 3 §12): one page, plain DOM, replaced by spec 4. */

export interface ShellModel {
  connected: boolean;
  loginError?: string | undefined;
  /** iOS outside an installed home-screen app: the login would land in Safari's storage. */
  homeScreenHint: boolean;
  pasteMode: boolean;
  /** The authorize URL of the paste login, shown as a link; undefined while it is being prepared. */
  pasteUrl: string | undefined;
  status: SyncStatus;
  counts: { sessions: number; exercises: number; bodyweight: number };
  persisted: boolean | undefined;
  updateAvailable: boolean;
  buildId: string;
}

export interface ShellActions {
  connect(): void;
  startPaste(): void;
  submitCode(code: string): void;
  syncNow(): void;
  chooseEmptyFolder(choice: EmptyFolderChoice): void;
  updateApp(): void;
  signOut(): void;
}

const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const when = (t: string | undefined): string => (t === undefined ? 'never' : new Date(t).toLocaleString());

export function shellHtml(m: ShellModel): string {
  return `
    <h1>CalisTally</h1>
    ${m.updateAvailable ? `<section class="notice"><p>A new version of the app is ready.</p><button data-action="update">Update app</button></section>` : ''}
    ${!m.updateAvailable && m.status.tooNewSeen ? `<section class="notice"><p>A newer version of the app wrote some files. They are shown read-only; update as soon as an update is offered.</p></section>` : ''}
    ${m.connected ? connectedView(m) : connectView(m)}
    <p class="muted">Build ${esc(m.buildId)} · storage ${m.persisted === undefined ? 'unknown' : m.persisted ? 'persistent' : 'not persistent'}</p>
  `;
}

const rendered = new WeakMap<HTMLElement, string>();

/** Writes the page only when it changed, and carries a half-typed code across the rewrite. */
export function renderShell(root: HTMLElement, m: ShellModel, actions: ShellActions): void {
  const html = shellHtml(m);
  if (rendered.get(root) !== html) {
    const old = root.querySelector<HTMLInputElement>('#code');
    const kept = old === null ? undefined : { value: old.value, focused: root.ownerDocument.activeElement === old, start: old.selectionStart, end: old.selectionEnd };
    root.innerHTML = html;
    rendered.set(root, html);
    const input = root.querySelector<HTMLInputElement>('#code');
    if (input !== null && kept !== undefined) {
      input.value = kept.value;
      if (kept.focused) {
        input.focus();
        input.setSelectionRange(kept.start, kept.end);
      }
    }
  }
  root.onclick = (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (target === null) return;
    const action = target.dataset['action'];
    if (action === 'connect') actions.connect();
    else if (action === 'paste') actions.startPaste();
    else if (action === 'submit-code') actions.submitCode((root.querySelector<HTMLInputElement>('#code')?.value ?? '').trim());
    else if (action === 'sync') actions.syncNow();
    else if (action === 'seed') actions.chooseEmptyFolder('seed');
    else if (action === 'copy') actions.chooseEmptyFolder('copy');
    else if (action === 'update') actions.updateApp();
    else if (action === 'sign-out') actions.signOut();
  };
}

function connectView(m: ShellModel): string {
  // Local data or a queue means this device was connected before (e.g. the login was revoked):
  // the owner connects again and keeps both (spec 3 §12).
  const hasLocal = m.status.queueLength > 0 || m.counts.sessions > 0 || m.counts.exercises > 0 || m.counts.bodyweight > 0;
  return `
    <section>
      <h2>Dropbox</h2>
      ${m.status.queueLength > 0 ? `<p>${m.status.queueLength} local change(s) are waiting for a connection.</p>` : '<p>Not connected.</p>'}
      ${hasLocal ? '<p>The data on this device is kept. Connect again to resume syncing.</p>' : ''}
      ${m.homeScreenHint ? `<p class="notice">On an iPhone, add this page to your Home Screen first (Share → Add to Home Screen) and open it from there. The login must happen inside the installed app.</p>` : ''}
      ${m.loginError ? `<p class="error">${esc(m.loginError)}</p>` : ''}
      ${!m.loginError && m.status.lastError ? `<p class="error">Last error: ${esc(m.status.lastError)}</p>` : ''}
      <button data-action="connect">${hasLocal ? 'Connect again' : 'Connect to Dropbox'}</button>
      <button class="secondary" data-action="paste">Paste a code instead</button>
      ${m.pasteMode ? pastePanel(m.pasteUrl) : ''}
    </section>`;
}

/** A real link, not window.open after an await: a tapped link is never popup-blocked (iOS Safari). */
function pastePanel(url: string | undefined): string {
  return `
      ${url === undefined ? '<p>Preparing the Dropbox link…</p>' : `<p>1. <a href="${esc(url)}" target="_blank" rel="noopener">Open Dropbox to get the code</a>, allow access, copy the code.</p>`}
      <p>2. Paste the code here:</p>
      <input id="code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" />
      <button data-action="submit-code">Finish login</button>`;
}

function connectedView(m: ShellModel): string {
  const s = m.status;
  if (s.emptyFolder && s.emptyFolderChoice !== 'copy') {
    return `
      <section>
        <h2>Empty Dropbox folder</h2>
        <p>The App folder holds no CalisTally files yet.</p>
        <button data-action="seed">Start with the seed catalog</button>
        <button class="secondary" data-action="copy">I'll copy files in, then sync</button>
      </section>`;
  }
  return `
    <section>
      <h2>Sync</h2>
      <dl>
        <dt>State</dt><dd>${esc(s.phase)}${s.online ? '' : ' · <span class="error">offline</span>'}${s.retryInMs !== undefined ? ` · retry in ${Math.round(s.retryInMs / 1000)} s` : ''}</dd>
        <dt>Last pull</dt><dd>${esc(when(s.lastPullAt))}</dd>
        <dt>Last push</dt><dd>${esc(when(s.lastPushAt))}</dd>
        <dt>Queued</dt><dd>${s.queueLength}${s.heldBackCount > 0 ? ` (${s.heldBackCount} held back)` : ''}</dd>
        ${s.lastError ? `<dt>Error</dt><dd class="error">${esc(s.lastError)}</dd>` : ''}
      </dl>
      <button data-action="sync" ${s.phase === 'idle' ? '' : 'disabled'}>Sync now</button>
      ${s.emptyFolder ? `<p class="muted">The folder is still empty. Copy the files into <code>Dropbox/Apps/CalisTally</code>, wait for the desktop client, then tap Sync now.</p>` : ''}
    </section>
    <section>
      <h2>Data</h2>
      <dl>
        <dt>Sessions</dt><dd>${m.counts.sessions}</dd>
        <dt>Exercises</dt><dd>${m.counts.exercises}</dd>
        <dt>Bodyweight entries</dt><dd>${m.counts.bodyweight}</dd>
      </dl>
    </section>
    <section>
      <h2>Issues</h2>
      ${s.issues.length === 0 ? '<p class="ok">None.</p>' : `<ul>${s.issues.map((i) => `<li><code>${esc(i.path)}</code> · ${esc(i.reason)}<br /><span class="muted">${esc(i.detail)}</span></li>`).join('')}</ul>`}
    </section>
    <section>
      <button class="secondary" data-action="sign-out">Sign out</button>
    </section>`;
}
