import { useComputed, useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useApp } from '../../context';
import { lockedSessionsOf } from '../../locked';
import { Button, Marks } from '../shared';
import { daysVm, exerciseMarks, isDaysChip, type DayRow, type DaysChip } from './days.vm';
import { PastSessionSheet } from './PastSessionSheet';

const CHIP_META = 'daysChip';

/** Spec 4 §5 "Days list": chips (remembered in meta), Add past session, month groups of rows. */
export function DaysTab(): JSX.Element {
  const { data, router } = useApp();
  const chip = useSignal<DaysChip>('all');
  const adding = useSignal(false);
  /** A tap before the stored chip arrives wins over it. */
  const tapped = useRef(false);

  useEffect(() => {
    let alive = true;
    void data.getMeta<unknown>(CHIP_META).then((stored) => {
      if (alive && !tapped.current && isDaysChip(stored)) chip.value = stored;
    });
    return () => { alive = false; };
  }, []);

  // Computed once per data change, not on every chip tap.
  const marks = useComputed(() => exerciseMarks(data.liveSessions.value));
  const locked = useComputed(() => lockedSessionsOf(data.refusedRows.value, new Set(data.sessions.value.map((r) => r.file.session.id))));

  const vm = daysVm({
    sessions: data.liveSessions.value,
    lockedSessions: locked.value,
    catalog: data.exercises.value,
    chip: chip.value,
    openSessionId: data.openSession.value?.file.session.id,
    marks: marks.value,
  });

  function pick(id: DaysChip): void {
    tapped.current = true;
    chip.value = id;
    void data.setMeta(CHIP_META, id);
  }

  function openRow(row: DayRow): void {
    if (row.open) router.navigate({ tab: 'log' });
    else router.navigate({ tab: 'days', sessionId: row.sessionId });
  }

  return (
    <div class="days">
      <div class="days__chips" role="group" aria-label="Filter by pattern">
        {vm.chips.map((c) => (
          <button
            key={c.id}
            type="button"
            class={`days__chip${c.active ? ' is-active' : ''}`}
            aria-pressed={c.active}
            onClick={() => pick(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div class="days__add">
        <Button onClick={() => { adding.value = true; }}>Add past session</Button>
      </div>
      {vm.empty && (
        <p class="days__empty">{chip.value === 'all' ? 'No sessions yet.' : 'No session matches this filter.'}</p>
      )}
      {vm.months.map((m) => (
        <section key={m.key} class="days__group">
          <h2 class="days__month">{m.title}</h2>
          <ul class="days__list">
            {m.rows.map((r, i) => (
              <li key={`${r.locked ? 'locked' : 'ok'}:${r.sessionId}:${i}`}>
                <Row row={r} onOpen={() => openRow(r)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {adding.value && <PastSessionSheet onClose={() => { adding.value = false; }} />}
    </div>
  );
}

/** One session. The open session's marks are dimmed: provisional until it closes (spec 4 §14). */
function Row(p: { row: DayRow; onOpen(): void }): JSX.Element {
  const r = p.row;
  return (
    <button
      type="button"
      class={`days-row${r.open ? ' is-open' : ''}${r.locked ? ' is-locked' : ''}`}
      onClick={() => p.onOpen()}
    >
      <span class="days-row__head">
        <span class="days-row__day">
          <span class="days-row__date">{r.day}</span>
          {r.uncertain && <span class="days-row__uncertain" title="date estimated by the migration">?</span>}
        </span>
        <span class="days-row__label">{r.label ?? '—'}</span>
        {r.open && <span class="days-row__open">open</span>}
        {r.span !== undefined && <span class="days-row__span">{r.span}</span>}
        {r.locked && <LockGlyph />}
      </span>
      {r.exercises.length > 0 && (
        <span class="days-row__exercises">
          {r.exercises.map((e) => (
            <span key={e.id} class="days-row__exercise">
              {e.name} <Marks amount={e.mark} provisional={r.open} />
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

/** A padlock in the muted colour (currentColor of .days-row__lock): the row opens read-only. */
function LockGlyph(): JSX.Element {
  return (
    <span class="days-row__lock" role="img" aria-label="read-only">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor" />
        <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6" />
      </svg>
    </span>
  );
}
