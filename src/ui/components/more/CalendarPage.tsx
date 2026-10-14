import type { JSX } from 'preact';
import { useApp } from '../../context';
import { BackBar } from '../shared';

/** Spec 4 §6 `#/more/calendar`: a stub until the calendar task replaces it. */
export function CalendarPage(): JSX.Element {
  const { router } = useApp();
  return (
    <div class="more-page">
      <BackBar title="Calendar" onBack={() => router.navigate({ tab: 'more' })} />
    </div>
  );
}
