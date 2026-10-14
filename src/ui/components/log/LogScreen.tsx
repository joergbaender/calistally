import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { latestCompletedAt } from '../../../model/derive';
import { addBlock, findBlock } from '../../../model/edit';
import type { Session } from '../../../model/types';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { blockFlags } from '../../soft-flags';
import { Button, Marks, SetChips } from '../shared';
import type { CardVm, LogScreenVm, RestStop } from './log-screen.vm';
import { currentBlockId, restStop } from './log-state';
import { BlockSheet } from './BlockSheet';
import { ExerciseSearch } from './ExerciseSearch';
import { editSession } from './outcome';
import { SetSheet } from './SetSheet';
import { PickerSheet } from './StartPicker';
import { useWriteGuard } from './use-write-guard';

type Open =
  | { kind: 'picker'; mode: 'start' | 'change' }
  | { kind: 'set'; setId: string }
  | { kind: 'block'; blockId: string; name: string }
  | { kind: 'search' };

/** Spec 4 §4 "The screen": header, cards, Other exercise…, Done. The entry area is rendered by LogTab.
 *  `reference` is the session the cards compare against (for the soft-issue flags of its blocks). */
export function LogScreen(p: { row: SessionRow; vm: LogScreenVm; reference?: Session | undefined }): JSX.Element {
  const { data, router } = useApp();
  const open = useSignal<Open | undefined>(undefined);
  const close = (): void => {
    open.value = undefined;
  };
  const { header } = p.vm;
  const path = p.row.path;

  // One Start at a time (a card's Start, or a pick in the search), held until the card shows the
  // new block: a second tap would add a second block of the exercise, an unpaired extra card.
  const guard = useWriteGuard((blockId) => findBlock(p.row.file.session, blockId) !== undefined);

  const startBlock = (exerciseId: string): Promise<void> =>
    guard.run(async () => {
      const now = data.clock();
      let added: string | undefined;
      const ok = await editSession(data, path, (f) => {
        const result = addBlock(f, exerciseId, now);
        added = result.blockId;
        return result.file;
      });
      if (!ok || added === undefined) return undefined;
      currentBlockId.value = added;
      return added;
    });

  // Spec 4 §4: a tap stops the rest counter after the latest set, a tap on a stopped one resumes it.
  // A device-local meta write only (no data file, so no write guard): the signal first, then meta.
  const toggleCounter = (): void => {
    const session = p.row.file.session;
    const key = `restStop:${session.id}`;
    if (p.vm.counter?.stopped === true) {
      restStop.value = undefined;
      void data.setMeta(key, undefined);
      return;
    }
    const after = latestCompletedAt(session);
    if (after === undefined) return;
    const stop: RestStop = { after, at: data.clock().toISOString() };
    restStop.value = { sessionId: session.id, ...stop };
    void data.setMeta(key, stop);
  };

  // The soft issues the Sync tab lists (none without a catalog, as there), on the block they name:
  // today's block of the card, else (a not-started card) the reference's block.
  const noFlags = new Map<string, string[]>();
  const catalogHere = data.catalog.value !== undefined;
  const flags = catalogHere ? blockFlags(p.row.file.session, data.exercises.value) : noFlags;
  const refFlags = catalogHere && p.reference !== undefined ? blockFlags(p.reference, data.exercises.value) : noFlags;
  const flagsOf = (c: CardVm): string[] =>
    (c.todayBlockId !== undefined ? flags.get(c.todayBlockId) : c.referenceBlockId !== undefined ? refFlags.get(c.referenceBlockId) : undefined) ?? [];

  const sheet = open.value;
  return (
    <section class="log">
      <header class="log-head">
        <div class="log-head__when">
          {header.date} · {header.startedAt}
        </div>
        <div class="log-head__actions">
          <button type="button" class="log-head__ref" onClick={() => (open.value = { kind: 'picker', mode: 'change' })}>
            {header.reference ?? 'No reference'} ▾
          </button>
          {/* Spec 4 §4 header: label, notes, tags, date and late entries live on the session page (§5). */}
          <Button onClick={() => router.navigate({ tab: 'days', sessionId: p.row.file.session.id })}>Details</Button>
          {header.offline && <span class="log-head__offline">offline</span>}
          <Button onClick={() => (open.value = { kind: 'picker', mode: 'start' })}>Start new</Button>
        </div>
      </header>

      {p.vm.cards.map((c) => (
        <Card
          key={c.key}
          card={c}
          counter={p.vm.counter}
          onTapCounter={toggleCounter}
          flags={flagsOf(c)}
          starting={guard.held()}
          onStart={() => void startBlock(c.exerciseId)}
          onTapSet={(setId) => (open.value = { kind: 'set', setId })}
          onTapName={(blockId) => (open.value = { kind: 'block', blockId, name: c.name })}
        />
      ))}

      <div class="log-foot">
        <Button onClick={() => (open.value = { kind: 'search' })}>Other exercise…</Button>
        <Button onClick={() => router.navigate({ tab: 'days' })}>Done</Button>
      </div>

      {sheet?.kind === 'picker' && <PickerSheet mode={sheet.mode} sessionId={p.row.file.session.id} onClose={close} />}
      {sheet?.kind === 'set' && <SetSheet row={p.row} setId={sheet.setId} onClose={close} />}
      {sheet?.kind === 'block' && <BlockSheet row={p.row} blockId={sheet.blockId} name={sheet.name} onClose={close} />}
      {sheet?.kind === 'search' && <ExerciseSearch onPick={startBlock} onClose={close} />}
    </section>
  );
}

function Card(p: {
  card: CardVm;
  counter: LogScreenVm['counter'];
  onTapCounter(): void;
  /** Soft-issue flags of the card's block (soft-flags.ts): today's, else the reference's; shown under its name. */
  flags: readonly string[];
  /** A Start is running or waiting for its block to show: every Start is disabled. */
  starting: boolean;
  onStart(): void;
  onTapSet(setId: string): void;
  onTapName(blockId: string): void;
}): JSX.Element {
  const c = p.card;
  const started = c.state !== 'not-started';
  const current = c.state === 'current';
  const todayBlockId = c.todayBlockId;
  // Spec 4 §4: tapping a finished card makes it current again, so a forgotten set can be added there.
  const makeCurrent =
    c.state === 'finished' && todayBlockId !== undefined
      ? () => {
          currentBlockId.value = todayBlockId;
        }
      : undefined;
  // The keyboard and screen-reader target is the part of the body without controls of its own
  // (last time's chips, the note, the totals); a pointer tap anywhere on the body works too.
  const target: JSX.HTMLAttributes<HTMLDivElement> =
    makeCurrent !== undefined
      ? {
          role: 'button',
          tabIndex: 0,
          onKeyDown: (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            makeCurrent();
          },
        }
      : {};
  return (
    <article class={`log-card log-card--${c.state}`} aria-label={c.name}>
      <div class="log-card__head">
        <h3 class="log-card__name">
          {todayBlockId === undefined ? (
            c.name
          ) : (
            <button type="button" class="log-card__namebtn" onClick={() => p.onTapName(todayBlockId)}>{c.name}</button>
          )}
          {c.archived && <span class="log-card__archived">archived</span>}
        </h3>
        {started ? <span class="log-card__load">{c.loadText}</span> : <Button kind="primary" disabled={p.starting} onClick={p.onStart}>Start</Button>}
      </div>
      {p.flags.length > 0 && (
        <p class="log-card__flags">
          {p.flags.map((f) => (
            <span key={f} class="flag">{f}</span>
          ))}
        </p>
      )}
      <div class="log-card__body" onClick={makeCurrent}>
        {started && (
          <>
            {c.referenceSets.length > 0 && <div class="log-card__caption">Today</div>}
            {/* A chip tap opens the set sheet only; it never also makes the card current. */}
            <div class="log-card__today" onClick={(e) => e.stopPropagation()}>
              <SetChips
                sets={c.todaySets}
                variant="today"
                proposed={c.proposed}
                onTap={(s) => p.onTapSet(s.id)}
                {...(current && c.todaySets.length > 0 ? { lastIndex: c.todaySets.length - 1 } : {})}
              />
            </div>
          </>
        )}
        <div class={`log-card__rest${makeCurrent !== undefined ? ' is-target' : ''}`} {...target}>
          {/* The target's name comes from its content (so the marks stay readable); this line leads it. */}
          {makeCurrent !== undefined && <span class="visually-hidden">Make {c.name} current. </span>}
          {c.referenceSets.length > 0 && (
            <>
              {started && <div class="log-card__caption">Last time</div>}
              <SetChips sets={c.referenceSets} variant="reference" {...(c.markIndex !== undefined ? { markIndex: c.markIndex } : {})} />
            </>
          )}
          {c.blockNote !== undefined && <p class="log-card__note">{c.blockNote}</p>}
          {c.totals !== undefined && (
            <div class="log-card__totals">
              <span>{c.totals.today}</span>
              {c.totals.reference !== '' && <span>{c.totals.reference}</span>}
              {c.marks !== undefined && <Marks amount={c.marks.amount} load={c.marks.load} provisional />}
              {current && p.counter !== undefined && (
                <button
                  type="button"
                  class={`log-card__counter${p.counter.stopped ? ' is-stopped' : ''}`}
                  aria-label={p.counter.stopped ? 'Rest taken, tap to resume' : 'Rest since the last set, tap to stop'}
                  onClick={p.onTapCounter}
                >
                  {p.counter.text}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
