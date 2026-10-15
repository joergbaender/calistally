import { useComputed, useSignal } from '@preact/signals';
import { Component, type JSX } from 'preact';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import { useApp } from '../../context';
import { formatDay, localDate } from '../../format';
import { BackBar, Sheet } from '../shared';
import { calendarSessionLine, calendarVm, reuseMonths, type CalendarDay, type CalendarMonth } from './calendar.vm';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Months mounted on first render (a phone screen shows about one and a half). */
export const INITIAL_MONTHS = 4;
/** Months mounted each time the end of the list comes near or "Show earlier months" is tapped. */
export const MORE_MONTHS = 6;
/** How far below the screen the end of the list starts mounting the next months. */
const AHEAD = '600px 0px';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The in-month cell of `date` in the grids. */
function dayOf(months: readonly CalendarMonth[], date: string): CalendarDay | undefined {
  for (const m of months) for (const week of m.weeks) for (const d of week) if (d.inMonth && d.date === date) return d;
  return undefined;
}

/** What a day cell says to assistive tech: the dots and the hollow mark are only drawn. */
function dayLabel(d: CalendarDay): string {
  const types = d.dots.length > 0 ? `: ${d.dots.join(', ')}` : '';
  return `${formatDay(d.date)}, ${plural(d.sessionIds.length, 'session')}${types}${d.hollow ? '; date uncertain' : ''}`;
}

/**
 * Spec 4 §6 "Calendar": month grids newest first, dots by chip, the streak. Tapping a day lists its
 * sessions in a sheet; tapping one opens the session page (or the Log tab if it is open).
 *
 * Lazy months (spec 4 §6): only the newest INITIAL_MONTHS are mounted at first; the next
 * MORE_MONTHS mount when the end of the list comes within AHEAD of the screen (or on the "Show
 * earlier months" button, which is also the fallback without IntersectionObserver), so three years
 * of history never mount 1,500 cells at once. Months keep their vm object while their content is
 * the same (`reuseMonths`) and are components that compare by identity, with a stable tap handler,
 * so a session change re-renders only the months it touched and the sheet re-renders no grid.
 */
export function CalendarPage(): JSX.Element {
  const { data, router } = useApp();
  const today = useComputed(() => localDate(data.now.value));
  const previous = useRef<CalendarMonth[]>([]);
  const vm = useComputed(() => {
    const next = calendarVm(data.liveSessions.value, data.exercises.value, today.value);
    const months = reuseMonths(previous.current, next.months);
    previous.current = months;
    return { ...next, months };
  });
  const shown = useSignal(INITIAL_MONTHS);
  const sheetDate = useSignal<string | undefined>(undefined);
  const showMore = useCallback((): void => {
    shown.value += MORE_MONTHS;
  }, [shown]);

  const openSession = (sessionId: string): void => {
    sheetDate.value = undefined;
    if (data.openSession.value?.file.session.id === sessionId) router.navigate({ tab: 'log' });
    else router.navigate({ tab: 'days', sessionId });
  };

  // Only cells with sessions are buttons; `sheetDate` is a stable signal, so this never changes.
  const tapDay = useCallback((day: CalendarDay): void => {
    sheetDate.value = day.date;
  }, [sheetDate]);

  const sheetDay = sheetDate.value;
  // The tapped day's sessions are the vm's `sessionIds` for that day (one source for the grid and the sheet).
  const sheetIds = sheetDay === undefined ? [] : (dayOf(vm.value.months, sheetDay)?.sessionIds ?? []);
  const sheetSessions = sheetIds.flatMap((id) => data.liveSessions.value.filter((s) => s.id === id));

  return (
    <section class="cal">
      <BackBar title="Calendar" onBack={() => router.navigate({ tab: 'more' })} />
      <p class="cal__streak">Streak: {plural(vm.value.streakWeeks, 'week')}</p>
      {vm.value.months.slice(0, shown.value).map((m) => (
        <Month key={m.key} month={m} today={today.value} onTap={tapDay} />
      ))}
      {shown.value < vm.value.months.length && <MoreMonths onMore={showMore} />}
      {sheetDay !== undefined && (
        <Sheet title={formatDay(sheetDay)} onClose={() => { sheetDate.value = undefined; }}>
          {sheetSessions.map((s) => (
            <button key={s.id} type="button" class="cal__session" onClick={() => openSession(s.id)}>
              {calendarSessionLine(s, data.exercises.value)}
            </button>
          ))}
        </Sheet>
      )}
    </section>
  );
}

/** The end of the list: a button, and with IntersectionObserver it presses itself when it comes near. */
function MoreMonths(p: { onMore(): void }): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  const { onMore } = p;
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onMore();
    }, { rootMargin: AHEAD });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onMore]);
  return (
    <button ref={ref} type="button" class="cal__more" onClick={onMore}>
      Show earlier months
    </button>
  );
}

interface MonthProps { month: CalendarMonth; today: string; onTap(day: CalendarDay): void }

/**
 * One month, re-rendered only when its vm object, today or the tap handler change (they stay the
 * same while the data does). A class with shouldComponentUpdate, not `memo`: `preact/compat` would
 * install its global vnode hook, which changes how `onChange` behaves on every select in the app.
 */
class Month extends Component<MonthProps> {
  override shouldComponentUpdate(next: MonthProps): boolean {
    return next.month !== this.props.month || next.today !== this.props.today || next.onTap !== this.props.onTap;
  }

  override render(): JSX.Element {
    const p = this.props;
    const m = p.month;
    return (
      <section class="cal__month" aria-label={m.title}>
        <h2 class="cal__title">{m.title}</h2>
        <p class="cal__counts">{`${plural(m.sessions, 'session')} · ${plural(m.trainingDays, 'training day')}`}</p>
        <div class="cal__grid">
          {WEEKDAYS.map((w) => (
            <span key={w} class="cal__weekday" aria-hidden="true">{w}</span>
          ))}
          {m.weeks.flat().map((d) => (
            <Day key={d.date} day={d} today={p.today} onTap={p.onTap} />
          ))}
        </div>
      </section>
    );
  }
}

function Day(p: { day: CalendarDay; today: string; onTap(day: CalendarDay): void }): JSX.Element {
  const d = p.day;
  const cls = `cal__day${d.inMonth ? '' : ' cal__day--out'}${d.date === p.today ? ' cal__day--today' : ''}`;
  const inner = (
    <>
      <span class="cal__num" aria-hidden={d.sessionIds.length > 0 ? 'true' : undefined}>{Number(d.date.slice(8))}</span>
      <span class="cal__dots" aria-hidden="true">
        {d.dots.map((c) => (
          <span key={c} class={`cal__dot cal__dot--${c}${d.hollow ? ' cal__dot--hollow' : ''}`} />
        ))}
      </span>
    </>
  );
  if (d.sessionIds.length === 0) return <div class={cls} aria-hidden={d.inMonth ? undefined : 'true'}>{inner}</div>;
  return (
    <button type="button" class={cls} aria-label={dayLabel(d)} onClick={() => p.onTap(d)}>
      {inner}
    </button>
  );
}
