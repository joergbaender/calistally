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
  const db = await openDb();
  const channel = new BroadcastChangeChannel();
  const store = new Store(db, { onChange: (path) => { channel.post(path); scheduleRender(); } });
  const auth = new Auth(db, { appKey: DROPBOX_APP_KEY, redirectUri: redirectUri() }, { fetch: (input, init) => fetch(input, init) });
  const client = new DropboxHttpClient({
    fetch: (input, init) => fetch(input, init),
    tokens: { accessToken: () => auth.accessToken(), refresh: () => auth.refresh() },
  });
  const engine = new Engine({ store, client, leadership: new WebLocksLeadership(), channel, buildId: BUILD_ID });
  await engine.init();
  const sw = setupSwUpdate(scheduleRender);

  const model: ShellModel = {
    connected: false,
    homeScreenHint: isIos() && !isStandalone(),
    pasteMode: false,
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
  if (!model.connected) engine.disconnect();

  try {
    model.persisted = (await navigator.storage?.persisted?.()) ? true : await navigator.storage?.persist?.();
    await store.setMeta('persisted', model.persisted);
  } catch {
    model.persisted = undefined;
  }

  let renderQueued = false;
  function scheduleRender(): void {
    if (renderQueued) return;
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
      startPaste: () => { model.pasteMode = true; scheduleRender(); void auth.startLogin('paste').then((url) => window.open(url, '_blank', 'noopener')); },
      submitCode: (code) => { void finishPaste(code); },
      syncNow: () => { void engine.drain(); },
      chooseEmptyFolder: (choice) => { void engine.chooseEmptyFolder(choice); },
      updateApp: () => { void sw.apply(() => engine.idle()); },
      signOut: () => { void signOut(); },
    });
  }

  async function finishPaste(code: string): Promise<void> {
    try {
      await auth.completeLogin(code);
      model.loginError = undefined;
      model.pasteMode = false;
      model.connected = true;
      engine.reconnect();
      void engine.drain();
    } catch (e) {
      model.loginError = e instanceof AuthError ? e.message : 'login failed';
    }
    scheduleRender();
  }

  async function signOut(): Promise<void> {
    if (engine.status.queueLength > 0 && !window.confirm(`${engine.status.queueLength} change(s) have not reached Dropbox yet and will be lost. Sign out anyway?`)) return;
    engine.dispose();
    await Promise.race([engine.idle(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    await auth.signOut();
    await db.clearAll();
    window.location.reload();
  }

  let checkedForTooNew = false;
  engine.subscribe((status) => {
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
  scheduleRender();
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

void main();
