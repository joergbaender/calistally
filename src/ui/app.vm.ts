import type { Route } from './router';

export type Tab = 'log' | 'days' | 'more' | 'sync';

/** Spec 4 §7 badge: the number of issues (hard and soft) plus held-back writes; a dot alone when not connected or an update waits. */
export function badgeVm(input: { issues: number; softIssues: number; heldBack: number; connected: boolean; updateAvailable: boolean }): { count: number; dot: boolean } {
  const count = input.issues + input.softIssues + input.heldBack;
  return { count, dot: count === 0 && (!input.connected || input.updateAvailable) };
}

/** The `now` tick for a route: every second where a number counts on screen (the Log tab's counter,
 *  the Sync tab's retry countdown), else every minute (spec 4 §3). */
export function clockModeFor(route: Route): 'fast' | 'slow' {
  const tab = tabOf(route);
  return tab === 'log' || tab === 'sync' ? 'fast' : 'slow';
}

/** The tab a route belongs to (the tab bar's active mark). */
export function tabOf(route: Route): Tab {
  return route.tab;
}
