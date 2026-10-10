import { useSignal } from '@preact/signals';
import { Fragment, type JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { useApp } from '../../context';
import { Button } from '../shared';
import { syncVm, type IssueCard, type SyncVm, type UpdateState } from './sync.vm';

/**
 * Spec 4 §7: the Sync tab, replacing the shell of spec 3 §12 one to one, plus the soft issues and the
 * Update states. Sections top to bottom: Connection, Empty folder, Update, Status, Issues, Data.
 * Issues and Data render in every connection state, so the tab-bar badge is always explained; Status
 * needs a connection.
 */
export function SyncTab(): JSX.Element {
  const { data, sync, ui } = useApp();
  const updateState = useSignal<UpdateState>('idle');

  const vm = syncVm({
    status: data.status.value,
    retryLeftMs: data.retryLeftMs.value,
    issues: data.issues.value,
    softIssues: data.softIssues.value,
    sessions: data.liveSessions.value,
    connected: ui.connected.value,
    loginError: ui.loginError.value,
    homeScreenHint: ui.homeScreenHint,
    pasteMode: ui.pasteMode.value,
    pasteUrl: ui.pasteUrl.value,
    persisted: ui.persisted.value,
    updateAvailable: ui.updateAvailable.value,
    updateState: updateState.value,
    buildId: ui.buildId,
    counts: {
      sessions: data.liveSessions.value.length,
      exercises: data.exercises.value.filter((e) => e.deletedAt === undefined).length,
      bodyweight: data.bodyweight.value?.file.entries.filter((e) => e.deletedAt === undefined).length ?? 0,
    },
  });

  /** Tap → updating; the engine stayed busy for 10 s → retrying, one more try; busy again → failed; a reload keeps "Updating…". */
  async function runUpdate(): Promise<void> {
    updateState.value = 'updating';
    try {
      if (await sync.updateApp() === 'reloading') return;
      updateState.value = 'retrying';
      updateState.value = await sync.updateApp() === 'reloading' ? 'updating' : 'failed';
    } catch {
      // The service worker refused (it may have vanished): never leave the button disabled for good.
      updateState.value = 'failed';
    }
  }

  return (
    <div class="sync">
      <h1 class="sync__title">CalisTally</h1>
      {vm.connection.kind === 'disconnected' ? <Disconnected vm={vm} connection={vm.connection} /> : <ConnectedLine />}
      {vm.emptyFolder && <EmptyFolder />}
      {vm.update.show && (
        <section class="sync-card sync-card--notice">
          <p>{vm.update.note}</p>
          <Button kind="primary" disabled={vm.update.disabled} onClick={() => { void runUpdate(); }}>{vm.update.label}</Button>
        </section>
      )}
      {vm.update.tooNew && (
        <section class="sync-card sync-card--notice">
          <p>A newer version of the app wrote some files. They are shown read-only; update as soon as an update is offered.</p>
        </section>
      )}
      {vm.showStatus && <Status vm={vm} />}
      <section class="sync-card">
        <h2 class="sync-card__title">Issues</h2>
        {vm.issues.length === 0 ? <p class="sync--ok">None.</p> : <ul class="sync-issues">{vm.issues.map((card) => <IssueCardView key={card.key} card={card} />)}</ul>}
      </section>
      <section class="sync-card">
        <h2 class="sync-card__title">Data</h2>
        <dl class="sync-rows">
          <dt>Sessions</dt><dd>{vm.counts.sessions}</dd>
          <dt>Exercises</dt><dd>{vm.counts.exercises}</dd>
          <dt>Bodyweight entries</dt><dd>{vm.counts.bodyweight}</dd>
        </dl>
        <p class="sync__footer">{vm.footer}</p>
        {vm.connection.kind === 'connected' && (
          <div class="sync-actions">
            <Button kind="danger" onClick={() => sync.signOut()}>Sign out</Button>
          </div>
        )}
      </section>
    </div>
  );
}

function Disconnected(p: { vm: SyncVm; connection: Extract<SyncVm['connection'], { kind: 'disconnected' }> }): JSX.Element {
  const { sync } = useApp();
  const c = p.connection;
  const queued = p.vm.statusRows.find((r) => r.label === 'Queued');
  const codeRef = useRef<HTMLInputElement>(null);
  return (
    <section class="sync-card">
      <h2 class="sync-card__title">Dropbox</h2>
      <p>Not connected.</p>
      {c.hasLocal && <p>Your data and queued changes are kept. Connect again to resume syncing.</p>}
      {c.hasLocal && queued !== undefined && queued.value !== '0' && <p>Changes waiting for a connection: {queued.value}</p>}
      {c.hint && (
        <p class="sync-card--notice">
          On an iPhone, add this page to your Home Screen first (Share → Add to Home Screen) and open it from there. The login must happen inside the installed app.
        </p>
      )}
      {c.error !== undefined && <p class="sync--error">{c.error}</p>}
      <div class="sync-actions">
        <Button kind="primary" onClick={() => sync.connect()}>{c.hasLocal ? 'Connect again' : 'Connect to Dropbox'}</Button>
        <Button onClick={() => sync.startPaste()}>Paste a code instead</Button>
      </div>
      {c.pasteMode && (
        <div class="sync-paste">
          {c.pasteUrl === undefined ? (
            <p>Preparing the Dropbox link…</p>
          ) : (
            // A real link, not window.open after an await: a tapped link is never popup-blocked (iOS Safari).
            <p>1. <a href={c.pasteUrl} target="_blank" rel="noopener">Open Dropbox to get the code</a>, allow access, copy the code.</p>
          )}
          <p class="sync__muted">Dropbox may ask you to log in inside this sheet</p>
          <p>2. Paste the code here:</p>
          <input id="code" ref={codeRef} class="sync-paste__code" type="text" autocomplete="off" autocapitalize="off" spellcheck={false} />
          <Button kind="primary" onClick={() => sync.submitCode((codeRef.current?.value ?? '').trim())}>Finish login</Button>
        </div>
      )}
    </section>
  );
}

/** Spec 4 §7 "Connected: one line". */
function ConnectedLine(): JSX.Element {
  return (
    <section class="sync-card">
      <h2 class="sync-card__title">Dropbox</h2>
      <p class="sync--ok">Connected to Dropbox.</p>
    </section>
  );
}

function EmptyFolder(): JSX.Element {
  const { sync } = useApp();
  return (
    <section class="sync-card">
      <h2 class="sync-card__title">Empty Dropbox folder</h2>
      <p>The App folder holds no CalisTally files yet.</p>
      <div class="sync-actions">
        <Button kind="primary" onClick={() => sync.chooseEmptyFolder('seed')}>Start with the seed catalog</Button>
        <Button onClick={() => sync.chooseEmptyFolder('copy')}>I'll copy files in, then sync</Button>
      </div>
    </section>
  );
}

function Status(p: { vm: SyncVm }): JSX.Element {
  const { sync } = useApp();
  const vm = p.vm;
  return (
    <section class="sync-card">
      <h2 class="sync-card__title">Status</h2>
      <dl class="sync-rows">
        {vm.statusRows.map((r) => (
          <Fragment key={r.label}>
            <dt>{r.label}</dt>
            <dd class={r.error === true ? 'sync--error' : undefined}>{r.value}</dd>
          </Fragment>
        ))}
      </dl>
      <div class="sync-actions">
        <Button kind="primary" disabled={vm.syncNowDisabled} onClick={() => sync.syncNow()}>Sync now</Button>
      </div>
      {vm.emptyFolderNote && (
        <p class="sync__muted">The folder is still empty. Copy the files into <code>Dropbox/Apps/CalisTally</code>, wait for the desktop client, then tap Sync now.</p>
      )}
    </section>
  );
}

function IssueCardView(p: { card: IssueCard }): JSX.Element {
  const c = p.card;
  return (
    <li class={`sync-issue${c.reason === 'soft' ? ' sync-issue--soft' : ''}`}>
      <div class="sync-issue__head">
        <span class="sync-issue__title">{c.title}</span>
        <code class="sync-issue__path">{c.path}</code>
      </div>
      {c.detail.length > 0 && <p class="sync-issue__detail">{c.detail}</p>}
      <p class="sync-issue__advice">{c.advice}</p>
      {c.sessionId !== undefined && <a class="sync-issue__link" href={`#/days/${encodeURIComponent(c.sessionId)}`}>Open the session</a>}
    </li>
  );
}
