import type { JSX } from 'preact';
import { badgeVm, tabOf, type Tab } from './app.vm';
import { DaysTab } from './components/days/DaysTab';
import { SessionPage } from './components/days/SessionPage';
import { LogTab } from './components/log/LogTab';
import { MoreTab } from './components/more/MoreTab';
import { ToastHost } from './components/shared';
import { SyncTab } from './components/sync/SyncTab';
import { useApp } from './context';
import type { Route } from './router';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'log', label: 'Log' },
  { id: 'days', label: 'Days' },
  { id: 'more', label: 'More' },
  { id: 'sync', label: 'Sync' },
];

function screenFor(route: Route): JSX.Element {
  switch (route.tab) {
    case 'log':
      return <LogTab />;
    case 'days':
      return route.sessionId === undefined ? <DaysTab /> : <SessionPage sessionId={route.sessionId} />;
    case 'more':
      return <MoreTab />;
    case 'sync':
      return <SyncTab />;
  }
}

/** Spec 4 §3: the route switch, the tab bar with the Sync badge (§7), and the toast host. */
export function App(): JSX.Element {
  const { data, router, ui } = useApp();
  const route = router.route.value;
  const active = tabOf(route);
  const badge = badgeVm({
    // store.issues() already lists held-back writes as 'held-back' issues; they are counted once, through heldBack.
    issues: data.issues.value.filter((i) => i.reason !== 'held-back').length,
    softIssues: data.softIssues.value.length,
    heldBack: data.heldBackCount.value,
    connected: ui.connected.value,
    updateAvailable: ui.updateAvailable.value,
  });
  return (
    <>
      <main class="app__main">{screenFor(route)}</main>
      <nav class="tabbar" aria-label="Tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            class={`tabbar__tab${active === t.id ? ' is-active' : ''}`}
            aria-label={t.label}
            aria-current={active === t.id ? 'page' : undefined}
            onClick={() => router.navigate({ tab: t.id })}
          >
            <span class="tabbar__label">{t.label}</span>
            {t.id === 'sync' && badge.count > 0 && <span class="tabbar__badge">{badge.count}</span>}
            {t.id === 'sync' && badge.dot && <span class="tabbar__dot" aria-hidden="true" />}
          </button>
        ))}
      </nav>
      <ToastHost />
    </>
  );
}
