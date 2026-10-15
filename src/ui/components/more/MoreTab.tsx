import type { JSX } from 'preact';
import { useApp } from '../../context';
import type { MorePage } from '../../router';
import { BodyweightPage } from './BodyweightPage';
import { CalendarPage } from './CalendarPage';
import { CatalogPage } from './CatalogPage';
import { ExerciseEditPage } from './ExerciseEditPage';
import { ExerciseHistoryPage } from './ExerciseHistoryPage';
import { ExercisesPage } from './ExercisesPage';

const MENU: ReadonlyArray<{ page: MorePage; label: string }> = [
  { page: 'exercises', label: 'Exercises' },
  { page: 'calendar', label: 'Calendar' },
  { page: 'bodyweight', label: 'Bodyweight' },
  { page: 'catalog', label: 'Catalog' },
];

function Menu(): JSX.Element {
  const { router } = useApp();
  return (
    <nav class="more-menu" aria-label="More">
      <h1 class="more-menu__title">More</h1>
      {MENU.map((m) => (
        <button key={m.page} type="button" class="more-menu__item" onClick={() => router.navigate({ tab: 'more', page: m.page })}>
          {m.label}
        </button>
      ))}
    </nav>
  );
}

/** Spec 4 §6: the menu of four lines and the switch to its pages (routes in spec 4 §3). */
export function MoreTab(): JSX.Element {
  const { router } = useApp();
  const route = router.route.value;
  if (route.tab !== 'more') return <Menu />;
  switch (route.page) {
    case undefined:
      break;
    case 'exercises':
      return <ExercisesPage />;
    case 'exercise':
      return route.id === undefined ? <ExercisesPage /> : <ExerciseHistoryPage exerciseId={route.id} />;
    case 'calendar':
      return <CalendarPage />;
    case 'bodyweight':
      return <BodyweightPage />;
    case 'catalog':
      return route.id === undefined ? <CatalogPage /> : <ExerciseEditPage exerciseId={route.id} />;
  }
  return <Menu />;
}
