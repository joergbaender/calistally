import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { useApp } from '../../context';
import { BackBar, Marks } from '../shared';
import { exerciseHistoryVm, type HistoryRow } from './exercise-history.vm';

/** The rows in runs of one year, newest first (the rows show no year of their own). */
function byYear(rows: readonly HistoryRow[]): { year: string; rows: HistoryRow[] }[] {
  const groups: { year: string; rows: HistoryRow[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last?.year === r.year) last.rows.push(r);
    else groups.push({ year: r.year, rows: [r] });
  }
  return groups;
}

/**
 * Spec 4 §6 `#/more/exercise/<id>`: one row per live block, newest first, under a heading per year;
 * a row opens its session. The open session's marks are provisional (dimmed, spec 4 §14). The view
 * model is recomputed only when its inputs change, not on every signal the page reads.
 */
export function ExerciseHistoryPage(p: { exerciseId: string }): JSX.Element {
  const { data, router } = useApp();
  const sessions = data.liveSessions.value;
  const catalog = data.exerciseById.value;
  const openId = data.openSession.value?.file.session.id;
  const vm = useMemo(() => exerciseHistoryVm(p.exerciseId, sessions, catalog, openId), [p.exerciseId, sessions, catalog, openId]);
  return (
    <div class="more-page">
      <BackBar title={vm.name} onBack={() => router.back()} />
      {(vm.archived || vm.unknown) && (
        <p class="xhist__status">{vm.unknown ? 'Unknown exercise: not in the catalog.' : 'Archived.'}</p>
      )}
      {vm.rows.length === 0 && <p class="more-page__empty">No blocks of this exercise yet.</p>}
      {byYear(vm.rows).map((g) => (
        <section key={g.year} class="xhist__year" aria-label={g.year}>
          <h2 class="xhist__yeartitle">{g.year}</h2>
          <ul class="xhist">
            {g.rows.map((r) => (
              <li key={r.blockId}>
                <button type="button" class="xhist__row" onClick={() => router.navigate({ tab: 'days', sessionId: r.sessionId })}>
                  <span class="xhist__day">
                    {r.day}
                    {r.uncertain && '?'}
                    {r.run > 1 && <sup class="xhist__run">run {r.run}</sup>}
                  </span>
                  <span class={`xhist__sets${r.noteOnly ? ' is-note' : ''}`}>{r.noteOnly ? r.note : r.sets}</span>
                  <span class="xhist__totals">{r.totals}</span>
                  <span class="xhist__marks"><Marks amount={r.marks.amount} load={r.marks.load} provisional={r.open} /></span>
                  <span class="xhist__load">{r.load}</span>
                  {!r.noteOnly && r.note !== undefined && <span class="xhist__note">{r.note}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
