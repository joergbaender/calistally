import { Auth, AuthError } from '../sync/auth';
import { BroadcastChangeChannel } from '../sync/channel';
import { openDb } from '../sync/db';
import { DropboxHttpClient } from '../sync/dropbox-client';
import { Engine } from '../sync/engine';
import { WebLocksLeadership } from '../sync/lock';
import { Store } from '../sync/store';
import { BASE_URL, BUILD_ID, DROPBOX_APP_KEY, redirectUri } from './config';
import { renderShell, type ShellModel } from './shell';
import { setupSwUpdate } from './sw-update';
import { attachTriggers } from './triggers';

/** Wires the sync library to the browser (spec 3 §12, §13). */
async function main(): Promise<void> {
  const root = document.getElementById('app') as HTMLElement;
  // Declared before anything that can call scheduleRender (store events, the SW prompt); renders
  // start once the model exists, and the last line of main() renders the state as it is then.
  let renderQueued = false;
  let renderReady = false;
  // The engine is created after the store; a local write nudges it through this late binding
  // (BroadcastChannel never delivers to the posting tab).
  let engineRef: Engine | undefined;
  const db = await openDb();
  const channel = new BroadcastChangeChannel();
  const store = new Store(db, {
    onChange: (path) => { channel.post(path); scheduleRender(); },
    onWrite: () => { engineRef?.requestPush(); },
  });
  const auth = new Auth(db, { appKey: DROPBOX_APP_KEY, redirectUri: redirectUri() }, { fetch: (input, init) => fetch(input, init) });
  const client = new DropboxHttpClient({
    fetch: (input, init) => fetch(input, init),
    tokens: { accessToken: () => auth.accessToken(), refresh: () => auth.refresh() },
  });
  const engine = new Engine({ store, client, leadership: new WebLocksLeadership(), channel, buildId: BUILD_ID });
  engineRef = engine;
  await engine.init();
  const sw = setupSwUpdate(scheduleRender);

  const model: ShellModel = {
    connected: false,
    homeScreenHint: isIos() && !isStandalone(),
    pasteMode: false,
    pasteUrl: undefined,
    status: engine.status,
    counts: { sessions: 0, exercises: 0, bodyweight: 0 },
    persisted: undefined,
    updateAvailable: false,
    buildId: BUILD_ID,
  };

  // The OAuth redirect lands on the base URL with code and state (spec 3 §3).
  const params = new URLSearchParams(window.location.search);
  if (params.has('code') || params.has('error')) {
    if (params.has('code')) {
      try {
        await auth.completeLogin(params.get('code') as string, params.get('state') ?? undefined);
      } catch (e) {
        model.loginError = e instanceof AuthError ? e.message : 'login failed';
      }
    } else {
      model.loginError = `Dropbox did not authorise the app (${params.get('error_description') ?? params.get('error')})`;
    }
    window.history.replaceState(null, '', BASE_URL);
  }
  model.connected = await auth.isConnected();
  if (!model.connected) {
    engine.disconnect();
    // iOS may reload the installed app while the owner copies the code: bring the panel back.
    const resumed = await auth.resumePaste();
    if (resumed !== undefined) {
      model.pasteMode = true;
      model.pasteUrl = resumed;
    }
  }

  try {
    model.persisted = (await navigator.storage?.persisted?.()) ? true : await navigator.storage?.persist?.();
    await store.setMeta('persisted', model.persisted);
  } catch {
    model.persisted = undefined;
  }

  function scheduleRender(): void {
    if (!renderReady || renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => { renderQueued = false; void render(); });
  }

  async function render(): Promise<void> {
    model.status = engine.status;
    model.updateAvailable = sw.updateAvailable;
    const [sessions, catalog, bodyweight] = await Promise.all([store.sessions(), store.catalog(), store.bodyweight()]);
    model.counts = {
      sessions: sessions.filter((s) => s.file.session.deletedAt === undefined).length,
      exercises: catalog?.exercises.filter((e) => e.deletedAt === undefined).length ?? 0,
      bodyweight: bodyweight?.entries.filter((e) => e.deletedAt === undefined).length ?? 0,
    };
    renderShell(root, model, {
      connect: () => { void auth.startLogin('redirect').then((url) => window.location.assign(url)); },
      startPaste: () => { void startPaste(); },
      submitCode: (code) => { void finishPaste(code); },
      syncNow: () => { void engine.drain(); },
      chooseEmptyFolder: (choice) => { void engine.chooseEmptyFolder(choice); },
      updateApp: () => { void sw.apply(() => engine.idle()); },
      signOut: () => { void signOut(); },
    });
  }

  /** Prepares the paste login and shows its link; the owner taps the link (spec 3 §3 fallback). */
  async function startPaste(): Promise<void> {
    model.pasteMode = true;
    model.pasteUrl = undefined;
    scheduleRender();
    try {
      model.pasteUrl = await auth.startLogin('paste');
      model.loginError = undefined;
    } catch {
      model.loginError = 'could not prepare the login; try again';
    }
    scheduleRender();
  }

  async function finishPaste(code: string): Promise<void> {
    try {
      await auth.completeLogin(code);
      model.loginError = undefined;
      model.pasteMode = false;
      model.pasteUrl = undefined;
      model.connected = true;
      engine.reconnect();
      void engine.drain();
    } catch (e) {
      model.loginError = e instanceof AuthError ? e.message : 'login failed';
    }
    scheduleRender();
  }

  async function signOut(): Promise<void> {
    // Read the queue itself: engine.status.queueLength lags (and never updates in a non-leader tab).
    const pending = (await store.queue()).length;
    if (pending > 0 && !window.confirm(`${pending} change(s) have not reached Dropbox yet and will be lost. Sign out anyway?`)) return;
    engine.dispose();
    await Promise.race([engine.idle(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    await auth.signOut();
    await db.clearAll();
    window.location.reload();
  }

  let checkedForTooNew = false;
  engine.subscribe((status) => {
    // Spec 3 §12: a revoked login stops the engine; the shell then offers "Connect again",
    // with the local data and the queue kept.
    model.connected = status.connected;
    // Spec 3 §8: a file newer than this app means a newer build exists; look for it at once.
    if (status.tooNewSeen && !checkedForTooNew) {
      checkedForTooNew = true;
      void sw.check();
    }
    scheduleRender();
  });
  attachTriggers(engine, sw);
  if (model.connected) {
    sw.check().catch(() => undefined);
    void engine.drain();
  }
  renderReady = true;
  scheduleRender();
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

void main();
