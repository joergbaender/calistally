import { effect, signal } from '@preact/signals';
import { render } from 'preact';
import { Auth, AuthError } from '../sync/auth';
import { BroadcastChangeChannel } from '../sync/channel';
import { openDb } from '../sync/db';
import { DropboxHttpClient } from '../sync/dropbox-client';
import { Engine } from '../sync/engine';
import { WebLocksLeadership } from '../sync/lock';
import { Store } from '../sync/store';
import { App } from '../ui/app';
import { clockModeFor } from '../ui/app.vm';
import { AppContext, type AppDeps, type SyncActions, type UiState } from '../ui/context';
import { Data, storeChanges } from '../ui/data';
import { Router, routeHash, startRoute } from '../ui/router';
import { BASE_URL, BUILD_ID, DROPBOX_APP_KEY, redirectUri } from './config';
import { setupSwUpdate } from './sw-update';
import { attachTriggers } from './triggers';

/** Wires the sync library to the browser (spec 3 §12, §13) and mounts the Preact app (spec 4 §3). */
async function main(): Promise<void> {
  const root = document.getElementById('app') as HTMLElement;
  // The engine and the data signals are created after the store; store events reach them through these late bindings
  // (BroadcastChannel never delivers to the posting tab, so this tab's own changes go to Data directly).
  let engineRef: Engine | undefined;
  const db = await openDb();
  const channel = new BroadcastChangeChannel();
  const changes = storeChanges(channel);
  const store = new Store(db, {
    onChange: changes.onChange,
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

  const ui: UiState = {
    connected: signal(false),
    loginError: signal<string | undefined>(undefined),
    homeScreenHint: isIos() && !isStandalone(),
    pasteMode: signal(false),
    pasteUrl: signal<string | undefined>(undefined),
    persisted: signal<boolean | undefined>(undefined),
    updateAvailable: signal(false),
    buildId: BUILD_ID,
  };
  const sw = setupSwUpdate(() => { ui.updateAvailable.value = sw.updateAvailable; });

  // The OAuth redirect lands on the base URL with code and state (spec 3 §3).
  const params = new URLSearchParams(window.location.search);
  const afterOAuth = params.has('code') || params.has('error');
  if (afterOAuth) {
    if (params.has('code')) {
      try {
        await auth.completeLogin(params.get('code') as string, params.get('state') ?? undefined);
      } catch (e) {
        ui.loginError.value = e instanceof AuthError ? e.message : 'login failed';
      }
    } else {
      ui.loginError.value = `Dropbox did not authorise the app (${params.get('error_description') ?? params.get('error')})`;
    }
    window.history.replaceState(null, '', BASE_URL);
  }
  ui.connected.value = await auth.isConnected();
  if (!ui.connected.value) {
    engine.disconnect();
    // iOS may reload the installed app while the owner copies the code: bring the panel back.
    const resumed = await auth.resumePaste();
    if (resumed !== undefined) {
      ui.pasteMode.value = true;
      ui.pasteUrl.value = resumed;
    }
  }

  try {
    const persisted = (await navigator.storage?.persisted?.()) ? true : await navigator.storage?.persist?.();
    ui.persisted.value = persisted;
    await store.setMeta('persisted', persisted);
  } catch {
    ui.persisted.value = undefined;
  }

  const data = new Data({ store, engine, channel });
  changes.bind(data);
  await data.load();

  // Spec 4 §3 "Routing": Sync after the OAuth redirect; else Log while a session is open (§4 Resume);
  // else the last route; else Sync without data and connection; else Log.
  const hasLocalData = data.sessions.value.length > 0 || data.catalog.value !== undefined || data.bodyweight.value !== undefined;
  const router = new Router(window);
  router.navigate(
    startRoute({
      afterOAuth,
      openSession: data.openSession.value !== undefined,
      lastRoute: await data.getMeta<string>('lastRoute'),
      hasLocalData,
      connected: ui.connected.value,
    }),
    { replace: true },
  );
  effect(() => {
    const route = router.route.value;
    void data.setMeta('lastRoute', routeHash(route));
    data.setClock(clockModeFor(route));
  });

  /** Prepares the paste login and shows its link; the owner taps the link (spec 3 §3 fallback). */
  async function startPaste(): Promise<void> {
    ui.pasteMode.value = true;
    ui.pasteUrl.value = undefined;
    try {
      ui.pasteUrl.value = await auth.startLogin('paste');
      ui.loginError.value = undefined;
    } catch {
      ui.loginError.value = 'could not prepare the login; try again';
    }
  }

  async function finishPaste(code: string): Promise<void> {
    try {
      await auth.completeLogin(code);
      ui.loginError.value = undefined;
      ui.pasteMode.value = false;
      ui.pasteUrl.value = undefined;
      ui.connected.value = true;
      engine.reconnect();
      void engine.drain();
    } catch (e) {
      ui.loginError.value = e instanceof AuthError ? e.message : 'login failed';
    }
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

  const sync: SyncActions = {
    connect: () => { void auth.startLogin('redirect').then((url) => window.location.assign(url)); },
    startPaste: () => { void startPaste(); },
    submitCode: (code) => { void finishPaste(code); },
    syncNow: () => { void engine.drain(); },
    chooseEmptyFolder: (choice) => { void engine.chooseEmptyFolder(choice); },
    updateApp: () => sw.apply(() => engine.idle()),
    signOut: () => { void signOut(); },
  };

  let checkedForTooNew = false;
  engine.subscribe((status) => {
    // Spec 3 §12: a revoked login stops the engine; the Sync tab then offers "Connect again",
    // with the local data and the queue kept.
    ui.connected.value = status.connected;
    // Spec 3 §8: a file newer than this app means a newer build exists; look for it at once.
    if (status.tooNewSeen && !checkedForTooNew) {
      checkedForTooNew = true;
      void sw.check();
    }
  });
  attachTriggers(engine, sw);
  if (ui.connected.value) {
    sw.check().catch(() => undefined);
    void engine.drain();
  }

  const deps: AppDeps = { data, router, sync, ui };
  render(<AppContext.Provider value={deps}><App /></AppContext.Provider>, root);
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

void main();
