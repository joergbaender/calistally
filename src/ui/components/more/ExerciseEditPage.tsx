import type { JSX } from 'preact';
import { useApp } from '../../context';
import { BackBar } from '../shared';

/** Spec 4 §6 `#/more/catalog/<id>`: a stub until the catalog task replaces it. */
export function ExerciseEditPage(p: { exerciseId: string }): JSX.Element {
  const { data, router } = useApp();
  const exercise = data.exercises.value.find((e) => e.id === p.exerciseId);
  return (
    <div class="more-page">
      <BackBar title={exercise?.name ?? 'Exercise'} onBack={() => router.navigate({ tab: 'more', page: 'catalog' })} />
    </div>
  );
}
