import type { JSX } from 'preact';
import { useApp } from '../../context';
import { localDate } from '../../format';
import { BackBar } from '../shared';
import { exercisesVm, type ExerciseGroup } from './exercises.vm';

function Groups(p: { groups: readonly ExerciseGroup[]; onOpen(id: string): void }): JSX.Element {
  return (
    <>
      {p.groups.map((g) => {
        // A family of one named like its exercise needs no heading of its own.
        const only = g.rows.length === 1 ? g.rows[0] : undefined;
        const heading = only === undefined || only.name !== g.family;
        return (
          <section key={g.family} class="xlist__group">
            {heading && <h2 class="xlist__family">{g.family}</h2>}
            <ul class="xlist__rows">
              {g.rows.map((r) => (
                <li key={r.id}>
                  <button type="button" class="xlist__row" onClick={() => p.onOpen(r.id)}>
                    <span class="xlist__name">{r.name}</span>
                    <span class="xlist__date">{r.lastDate ?? 'never'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/** Spec 4 §6 `#/more/exercises`: every exercise by family with its last date; archived ones collapsed. */
export function ExercisesPage(): JSX.Element {
  const { data, router } = useApp();
  const vm = exercisesVm(data.exercises.value, data.liveSessions.value, localDate(data.now.value));
  const open = (id: string): void => router.navigate({ tab: 'more', page: 'exercise', id });
  return (
    <div class="more-page">
      <BackBar title="Exercises" onBack={() => router.back()} />
      {vm.live.length === 0 && vm.archived.length === 0 && <p class="more-page__empty">No exercises yet.</p>}
      <Groups groups={vm.live} onOpen={open} />
      {vm.archived.length > 0 && (
        <details class="xlist__archived">
          <summary>Archived</summary>
          <Groups groups={vm.archived} onOpen={open} />
        </details>
      )}
    </div>
  );
}
