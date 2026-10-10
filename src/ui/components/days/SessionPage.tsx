import { useSignal } from '@preact/signals';
import { Fragment, type JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { liveBlocks, liveSets } from '../../../model/derive';
import { addBlock, deleteSession, setSessionFields, undeleteSession } from '../../../model/edit';
import type { Session, WorkoutSet } from '../../../model/types';
import type { FileRow } from '../../../sync/store';
import { useApp } from '../../context';
import { sessionRowById, type SessionRow } from '../../data';
import { lockedSessionRows } from '../../locked';
import { showToast } from '../../toast';
import { BackBar, Button, Marks, SetChips, Sheet } from '../shared';
import { BlockSheet } from '../log/BlockSheet';
import { ExerciseSearch } from '../log/ExerciseSearch';
import { editSession, editSessionQuiet, showHeldBack } from '../log/outcome';
import { SetSheet } from '../log/SetSheet';
import { justCreated } from './PastSessionSheet';
import { SessionHeaderSheet } from './SessionHeaderSheet';
import { notesChanged, readOnlyReason, sessionPageVm, type BlockRow, type SetRow } from './session-page.vm';

type Open =
  | { kind: 'header' }
  | { kind: 'notes' }
  | { kind: 'tag' }
  | { kind: 'set'; setId: string }
  | { kind: 'add-set'; blockId: string }
  | { kind: 'block'; blockId: string; name: string; up: boolean; down: boolean }
  | { kind: 'search' };

/** The ok row (editable unless tombstoned), or a refused row's session, read-only with the banner's reason. */
type Resolved = { session: Session; row: SessionRow; reason: undefined } | { session: Session; row: undefined; reason: string };

/**
 * Spec 4 §5: the same lookup as the Days list, so the list and the page agree on which file an id
 * opens: the ok row first, then the refused rows `lockedSessionRows` lists (never a duplicate loser).
 */
function resolve(rows: readonly SessionRow[], refused: readonly FileRow[], id: string): Resolved | undefined {
  const row = sessionRowById(rows, id);
  if (row !== undefined) return { session: row.file.session, row, reason: undefined };
  const locked = lockedSessionRows(refused, new Set(rows.map((r) => r.file.session.id))).find((l) => l.session.id === id);
  return locked === undefined ? undefined : { session: locked.session, row: undefined, reason: readOnlyReason(locked.row) };
}

/**
 * Spec 4 §5 "Session page" (`#/days/<sessionId>`): header (date, label, tags, notes), the blocks in
 * canonical order with their sets, totals and indicators, and the edits (set and block sheets, Add
 * set without completedAt, Add block, Delete session with Undo). A refused row is shown read-only
 * with a banner and no edit control; a tombstoned session shows "Deleted" with Undo. An open session
 * renders and edits here too (spec 4 §5); its Days row still goes to the Log tab.
 */
export function SessionPage(p: { sessionId: string }): JSX.Element {
  const { data, router } = useApp();
  const open = useSignal<Open | undefined>(undefined);
  /** One write at a time for the page's own buttons (tag chips, Undo): a second tap is ignored. */
  const busy = useSignal(false);
  const close = (): void => {
    open.value = undefined;
  };

  const found = resolve(data.sessions.value, data.refusedRows.value, p.sessionId);
  const pending = found === undefined && justCreated.value === p.sessionId;
  useEffect(() => {
    // The row arrived: the loading state has done its job.
    if (found !== undefined && justCreated.value === p.sessionId) justCreated.value = undefined;
  }, [found !== undefined, p.sessionId]);
  // Just created here (Add past session opens its page at once, spec 4 §5): the store's change has
  // not refreshed the signals yet, so show a loading state instead of "not found".
  if (pending) return <section class="session" aria-busy="true" />;
  if (found === undefined) {
    return (
      <section class="session">
        <BackBar title="Session" onBack={() => router.back()} />
        <p class="session__missing">This session is not here.</p>
      </section>
    );
  }

  const { session, row } = found;
  const vm = sessionPageVm({ session, allSessions: data.liveSessions.value, catalog: data.exerciseById.value, readOnlyReason: found.reason });
  // Edit controls only on an ok row of a live session (spec 4 §5 "Refused rows").
  const editable = row !== undefined && !vm.deleted ? row : undefined;
  const setsById = new Map<string, WorkoutSet>(liveBlocks(session).flatMap(liveSets).map((s) => [s.id, s]));

  /** Runs one page write unless one is running; the flag clears when it settles. */
  const guarded = async (write: () => Promise<unknown>): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      await write();
    } finally {
      busy.value = false;
    }
  };

  const removeTag = (r: SessionRow, tag: string): void => {
    const now = data.clock();
    void guarded(() => editSession(data, r.path, (f) => setSessionFields(f, { tags: f.session.tags.filter((t) => t !== tag) }, now)));
  };

  const deleteThis = async (r: SessionRow): Promise<void> => {
    if (!window.confirm('Delete this session? Undo is offered for a few seconds.')) return;
    const now = data.clock();
    const path = r.path;
    const written = await editSessionQuiet(data, path, (f) => deleteSession(f, now));
    if (!written.ok) return;
    router.navigate({ tab: 'days' });
    showToast('Session deleted', { label: 'Undo', run: () => void editSession(data, path, (f) => undeleteSession(f, data.clock())) }, 6000);
    // The Undo toast would replace the held-back note; it carries the note instead.
    if (written.heldBackNote) showHeldBack();
  };

  const addBlockTo = async (r: SessionRow, exerciseId: string): Promise<void> => {
    const now = data.clock();
    await editSession(data, r.path, (f) => addBlock(f, exerciseId, now).file);
  };

  const sheet = open.value;
  return (
    <section class="session">
      <BackBar
        title={vm.title}
        onBack={() => router.back()}
        right={editable !== undefined && <Button onClick={() => (open.value = { kind: 'header' })}>Edit</Button>}
      />

      {vm.readOnly !== undefined && (
        <div class="session__banner" role="alert">
          {vm.readOnly.reason}. Open the <a class="session__banner-link" href="#/sync">Sync tab</a> for details.
        </div>
      )}

      {vm.deleted && row !== undefined && (
        <div class="session__deleted">
          <span>Deleted</span>
          <Button disabled={busy.value} onClick={() => void guarded(() => editSession(data, row.path, (f) => undeleteSession(f, data.clock())))}>Undo</Button>
        </div>
      )}

      <div class="session-head">
        {vm.uncertain && (
          <p class="session-head__uncertain">
            <span aria-hidden="true">? </span>
            <span>date estimated by the migration</span>
          </p>
        )}
        <div class="session-head__line">
          {vm.label !== undefined && <span class="session-head__label">{vm.label}</span>}
          {vm.tags.map((t) =>
            editable !== undefined ? (
              <button key={t} type="button" class="session-head__tag" aria-label={`Remove tag ${t}`} disabled={busy.value} onClick={() => removeTag(editable, t)}>
                {t} ×
              </button>
            ) : (
              <span key={t} class="session-head__tag">{t}</span>
            ),
          )}
          {editable !== undefined && (
            <button type="button" class="session-head__tag session-head__tag--add" aria-label="Add tag" onClick={() => (open.value = { kind: 'tag' })}>
              + tag
            </button>
          )}
        </div>
        {editable !== undefined ? (
          <button type="button" class="session-head__notes" aria-label="Edit notes" onClick={() => (open.value = { kind: 'notes' })}>
            {vm.notes ?? <span class="session-head__placeholder">Notes</span>}
          </button>
        ) : (
          vm.notes !== undefined && <p class="session-head__notes">{vm.notes}</p>
        )}
      </div>

      {vm.blocks.map((b) => (
        <BlockView
          key={b.blockId}
          block={b}
          setsById={setsById}
          editable={editable !== undefined}
          onName={() => router.navigate({ tab: 'more', page: 'exercise', id: b.exerciseId })}
          onOptions={() => (open.value = { kind: 'block', blockId: b.blockId, name: b.name, up: b.canMoveUp, down: b.canMoveDown })}
          onTapSet={(setId) => (open.value = { kind: 'set', setId })}
          onAddSet={() => (open.value = { kind: 'add-set', blockId: b.blockId })}
        />
      ))}

      {editable !== undefined && (
        <div class="session__foot">
          <Button onClick={() => (open.value = { kind: 'search' })}>Add block</Button>
          <Button kind="danger" onClick={() => void deleteThis(editable)}>Delete session</Button>
        </div>
      )}

      {editable !== undefined && sheet?.kind === 'header' && <SessionHeaderSheet row={editable} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'notes' && <NotesSheet row={editable} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'tag' && <TagSheet row={editable} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'set' && <SetSheet row={editable} setId={sheet.setId} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'add-set' && <SetSheet row={editable} blockId={sheet.blockId} create timed={false} onClose={close} />}
      {editable !== undefined && sheet?.kind === 'block' && (
        <BlockSheet row={editable} blockId={sheet.blockId} name={sheet.name} move={{ up: sheet.up, down: sheet.down }} onClose={close} />
      )}
      {editable !== undefined && sheet?.kind === 'search' && <ExerciseSearch onPick={(id) => addBlockTo(editable, id)} onClose={close} />}
    </section>
  );
}

function BlockView(p: {
  block: BlockRow;
  setsById: ReadonlyMap<string, WorkoutSet>;
  editable: boolean;
  onName(): void;
  onOptions(): void;
  onTapSet(setId: string): void;
  onAddSet(): void;
}): JSX.Element {
  const b = p.block;
  return (
    <article class="session-block" aria-label={b.name}>
      <div class="session-block__head">
        <h3 class="session-block__name">
          <button type="button" class="session-block__namebtn" onClick={p.onName}>{b.name}</button>
          {b.archived && <span class="session-block__flag">archived</span>}
          {b.unknownExercise && <span class="session-block__flag">not in the catalog</span>}
        </h3>
        {b.load !== undefined && <span class="session-block__load">{b.load}</span>}
        {p.editable && (
          <button type="button" class="session-block__options" aria-label="Block options" onClick={p.onOptions}>⋯</button>
        )}
      </div>
      {b.note !== undefined && <p class="session-block__note">{b.note}</p>}
      {b.noteOnly ? (
        <p class="session-block__empty">no sets recorded</p>
      ) : (
        <div class="session-block__sets">
          {b.sets.map((r) => (
            <SetCell key={r.setId} row={r} set={p.setsById.get(r.setId)} {...(p.editable ? { onTap: p.onTapSet } : {})} />
          ))}
        </div>
      )}
      <div class="session-block__totals">
        {!b.noteOnly && <span>{b.totals}</span>}
        <Marks amount={b.marks.amount} load={b.marks.load} />
        <span class="session-block__exmark">
          exercise <Marks amount={b.exerciseMark} />
        </span>
      </div>
      {p.editable && (
        <div class="session-block__actions">
          <Button onClick={p.onAddSet}>Add set</Button>
        </div>
      )}
    </article>
  );
}

/** One set: its chip (SetChips with one set) and the small line with load, interval and rest below
 *  it. The interval and the rest carry spoken labels, so '+1:02' is never read as rest. */
function SetCell(p: { row: SetRow; set: WorkoutSet | undefined; onTap?(setId: string): void }): JSX.Element | null {
  if (p.set === undefined) return null;
  const meta: { text: string; label: string | undefined }[] = [];
  if (p.row.load !== undefined) meta.push({ text: p.row.load, label: undefined });
  if (p.row.interval !== undefined) meta.push({ text: p.row.interval, label: p.row.intervalLabel });
  if (p.row.rest !== undefined) meta.push({ text: p.row.rest, label: p.row.restLabel });
  const onTap = p.onTap;
  return (
    <div class="session-set">
      <SetChips sets={[p.set]} variant="today" {...(onTap !== undefined ? { onTap: (s: WorkoutSet) => onTap(s.id) } : {})} />
      {meta.length > 0 && (
        <div class="session-set__meta">
          {meta.map((m, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              {m.label === undefined ? <span>{m.text}</span> : <span role="img" aria-label={m.label}>{m.text}</span>}
            </Fragment>
          ))}
        </div>
      )}
      {p.row.note !== undefined && <div class="session-set__note">{p.row.note}</div>}
    </div>
  );
}

/** Spec 4 §5: the session notes, multi-line; a blank text removes them (edit.ts trims). A save that
 *  does not change the words the sheet opened with writes nothing (`notesChanged`), so a migrated note
 *  keeps its whitespace and notes another device wrote meanwhile are not overwritten. */
function NotesSheet(p: { row: SessionRow; onClose(): void }): JSX.Element {
  const { data } = useApp();
  // The notes as the sheet opened; never re-read from a refreshed row.
  const opened = useRef(p.row.file.session.notes);
  const draft = useSignal(opened.current ?? '');
  const edited = useSignal(false);
  const busy = useSignal(false);
  const save = async (): Promise<void> => {
    if (busy.value) return;
    const text = draft.value;
    if (!edited.value || !notesChanged(opened.current, text)) {
      p.onClose();
      return;
    }
    busy.value = true;
    try {
      const now = data.clock();
      if (await editSession(data, p.row.path, (f) => setSessionFields(f, { notes: text }, now))) p.onClose();
    } finally {
      busy.value = false;
    }
  };
  return (
    <Sheet title="Notes" onClose={p.onClose}>
      <textarea
        class="sessionsheet__notes"
        aria-label="Notes"
        rows={6}
        value={draft.value}
        onInput={(e) => {
          draft.value = e.currentTarget.value;
          edited.value = true;
        }}
      />
      <Button kind="primary" disabled={busy.value} onClick={() => void save()}>Save</Button>
    </Sheet>
  );
}

/** Spec 4 §5: add a tag from those seen in all sessions, or type a new one. */
function TagSheet(p: { row: SessionRow; onClose(): void }): JSX.Element {
  const { data } = useApp();
  const draft = useSignal('');
  const busy = useSignal(false);
  const own = new Set(p.row.file.session.tags);
  const seen = [...new Set(data.liveSessions.value.flatMap((s) => s.tags))].filter((t) => !own.has(t)).sort((a, b) => a.localeCompare(b));
  const add = async (raw: string): Promise<void> => {
    if (busy.value) return;
    const tag = raw.trim();
    if (tag === '') return;
    busy.value = true;
    try {
      const now = data.clock();
      const ok = await editSession(data, p.row.path, (f) => (f.session.tags.includes(tag) ? f : setSessionFields(f, { tags: [...f.session.tags, tag] }, now)));
      if (ok) p.onClose();
    } finally {
      busy.value = false;
    }
  };
  return (
    <Sheet title="Add tag" onClose={p.onClose}>
      {seen.length > 0 && (
        <div class="tagsheet__seen">
          {seen.map((t) => (
            <button key={t} type="button" class="session-head__tag" disabled={busy.value} onClick={() => void add(t)}>{t}</button>
          ))}
        </div>
      )}
      <input
        class="tagsheet__input"
        type="text"
        autocomplete="off"
        enterkeyhint="done"
        placeholder="New tag"
        aria-label="New tag"
        value={draft.value}
        onInput={(e) => (draft.value = e.currentTarget.value)}
      />
      <Button kind="primary" disabled={busy.value || draft.value.trim() === ''} onClick={() => void add(draft.value)}>Add</Button>
    </Sheet>
  );
}
