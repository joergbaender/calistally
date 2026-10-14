import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { deleteExercise, restoreClash, setArchived, undeleteExercise, updateExercise, type ExerciseFields } from '../../../model/edit-catalog';
import { LOAD_TYPES, PATTERNS } from '../../../model/schema';
import type { Exercise, ExercisesFile, Session } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import { useApp } from '../../context';
import type { Data, WriteOutcome } from '../../data';
import { sessionsWithLocked } from '../../locked';
import { showToast } from '../../toast';
import { quietWrite, reportWrite, showHeldBack } from '../log/outcome';
import { BackBar, Button, ClashSheet, useBusy } from '../shared';
import { catalogReadOnly, catalogRefusedReason, exerciseFormVm } from './catalog.vm';

const UNDO_MS = 6000;

function editCatalog(data: Data, fn: (f: ExercisesFile) => ExercisesFile): Promise<WriteOutcome> {
  return data.edit('exercises', EXERCISES_PATH, fn);
}

/**
 * Every session whose blocks keep an exercise from being deleted: the live readable ones and the
 * locked ones the Days list shows (read-only, needs-update, quarantined but parsing). Spec 1 §3: "an
 * exercise referenced by any non-deleted block cannot be tombstoned"; the engine's heal reads only
 * ok rows, so a tombstone written past a locked session would never be repaired (spec 4 §6 "Catalog").
 */
function referenceSessions(data: Data): Session[] {
  return sessionsWithLocked(data.liveSessions.value, data.refusedRows.value, new Set(data.sessions.value.map((r) => r.file.session.id)));
}

/**
 * Brings a deleted entry back unless a non-deleted one holds its name by now. A rename never takes a
 * deleted entry's name (`updateExercise`), so that happens only in the offline race spec 1 §3 accepts
 * (another device naming an entry alike before the sync). On a clash nothing is written and the
 * entry holding the name is returned; else whether the write went through.
 */
async function restoreChecked(data: Data, id: string): Promise<{ clash: Exercise } | { written: boolean }> {
  let clash: Exercise | undefined;
  const written = await reportWrite(EXERCISES_PATH, () => editCatalog(data, (f) => {
    clash = restoreClash(f, id);
    return clash === undefined ? undeleteExercise(f, id, data.clock()) : f;
  }));
  return clash === undefined ? { written } : { clash };
}

/** The select's value as one of the allowed literals, else the previous value. */
function oneOf<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  return allowed.find((x) => x === value) ?? fallback;
}

/**
 * Spec 4 §6 `#/more/catalog/<id>`: the edit form of one exercise. Without a readable catalog the
 * page shows the read-only banner and no form (spec 1 §5).
 */
export function ExerciseEditPage(p: { exerciseId: string }): JSX.Element {
  const { data, router } = useApp();
  const readOnly = catalogReadOnly(data.catalog.value?.file.exercises, catalogRefusedReason(data.refusedRows.value));
  const exercise = data.exerciseById.value.get(p.exerciseId);
  return (
    <div class="more-page catalog-edit">
      <BackBar title={exercise?.name ?? 'Exercise'} onBack={() => router.navigate({ tab: 'more', page: 'catalog' })} />
      {readOnly !== undefined && <p class="catalog__banner" role="alert">{readOnly}</p>}
      {exercise === undefined
        ? readOnly === undefined && <p class="more-page__empty">No exercise with this id.</p>
        : <EditForm key={exercise.id} exercise={exercise} />}
    </div>
  );
}

/**
 * Name (a rename keeps the id; a clash with any entry, deleted ones included, offers that entry
 * instead of saving, and a deleted one's page then offers Restore; spec 1 §3), family,
 * pattern, default load type and cues; metric and per side shown locked (spec 1 §3); Archive /
 * Unarchive; Delete only while no live block of any live session uses it, locked sessions included
 * (else the reason), with the 6 s Undo toast. Save sends only the fields changed against the values
 * the form opened with, and nothing when none changed. A deleted exercise shows its
 * fields read-only with Restore as the only action; Restore and the delete's Undo refuse while a
 * non-deleted entry holds the name (spec 1 §3) and offer that entry. Keyed by the exercise id, so
 * "Use it" on a clash opens a fresh form.
 */
function EditForm(p: { exercise: Exercise }): JSX.Element {
  const { data, router } = useApp();
  const id = p.exercise.id;
  const [opened] = useState(() => exerciseFormVm(p.exercise, referenceSessions(data)));
  const vm = exerciseFormVm(p.exercise, referenceSessions(data));
  const name = useSignal(opened.name);
  const family = useSignal(opened.family);
  const pattern = useSignal(opened.pattern);
  const defaultLoadType = useSignal(opened.defaultLoadType);
  const cues = useSignal(opened.cues);
  const clash = useSignal<{ entry: Exercise; restoring: boolean } | undefined>(undefined);
  const { busy, run: guarded } = useBusy();
  const toCatalog = (): void => router.navigate({ tab: 'more', page: 'catalog' });

  const changes = (): ExerciseFields => {
    const c: ExerciseFields = {};
    if (name.value.trim() !== opened.name) c.name = name.value;
    if (family.value.trim() !== opened.family) c.family = family.value;
    if (pattern.value !== opened.pattern) c.pattern = pattern.value;
    if (defaultLoadType.value !== opened.defaultLoadType) c.defaultLoadType = defaultLoadType.value;
    if (cues.value.trim() !== opened.cues) c.cues = cues.value;
    return c;
  };

  const save = (): Promise<void> => guarded(async () => {
    const c = changes();
    if (Object.keys(c).length === 0) {
      toCatalog();
      return;
    }
    let found: Exercise | undefined;
    const ok = await reportWrite(EXERCISES_PATH, () => editCatalog(data, (f) => {
      const result = updateExercise(f, id, c, data.clock());
      found = result.ok ? undefined : result.clash;
      return result.ok ? result.file : f;
    }));
    if (found !== undefined) {
      clash.value = { entry: found, restoring: false };
      return;
    }
    if (ok) toCatalog();
  });

  const archive = (archived: boolean): Promise<void> => guarded(async () => {
    await reportWrite(EXERCISES_PATH, () => editCatalog(data, (f) => setArchived(f, id, archived, data.clock())));
  });

  const restore = (): Promise<void> => guarded(async () => {
    const result = await restoreChecked(data, id);
    if ('clash' in result) clash.value = { entry: result.clash, restoring: true };
  });

  /** The delete toast's Undo: a name taken since the delete leaves the tombstone and says so. */
  const undo = async (): Promise<void> => {
    const result = await restoreChecked(data, id);
    if (!('clash' in result)) return;
    const other = result.clash;
    showToast(`Not restored: an exercise named “${other.name}” exists`, {
      label: 'Open',
      run: () => router.navigate({ tab: 'more', page: 'catalog', id: other.id }),
    });
  };

  const remove = (): Promise<void> => guarded(async () => {
    // The sessions as they are when the write runs, so a locked one that arrived meanwhile refuses it.
    const written = await quietWrite(EXERCISES_PATH, () => editCatalog(data, (f) => deleteExercise(f, id, referenceSessions(data), data.clock())));
    if (!written.ok) return;
    toCatalog();
    showToast(
      'Exercise deleted',
      { label: 'Undo', run: () => void undo() },
      UNDO_MS,
    );
    if (written.heldBackNote) showHeldBack();
  });

  // A deleted entry is not in the catalog list; its page (reached by a link or "Use it") only restores.
  const deleted = p.exercise.deletedAt !== undefined;
  const c = clash.value;
  return (
    <>
      {deleted && (
        <p class="catalog-edit__deleted">
          This exercise was deleted. Restore it to edit. <Button disabled={busy.value} onClick={() => void restore()}>Restore</Button>
        </p>
      )}
      <label class="exform__field">
        <span>Name</span>
        <input type="text" autocomplete="off" aria-label="Name" disabled={deleted} value={name.value} onInput={(e) => (name.value = e.currentTarget.value)} />
      </label>
      <label class="exform__field">
        <span>Family</span>
        <input type="text" autocomplete="off" aria-label="Family" placeholder="optional" disabled={deleted} value={family.value} onInput={(e) => (family.value = e.currentTarget.value)} />
      </label>
      <label class="exform__field">
        <span>Pattern</span>
        <select aria-label="Pattern" disabled={deleted} value={pattern.value} onChange={(e) => (pattern.value = oneOf(PATTERNS, e.currentTarget.value, pattern.value))}>
          {PATTERNS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label class="exform__field">
        <span>Default load</span>
        <select aria-label="Default load" disabled={deleted} value={defaultLoadType.value} onChange={(e) => (defaultLoadType.value = oneOf(LOAD_TYPES, e.currentTarget.value, defaultLoadType.value))}>
          {LOAD_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label class="exform__field">
        <span>Cues</span>
        <textarea class="catalog-edit__cues" aria-label="Cues" rows={3} placeholder="optional" disabled={deleted} value={cues.value} onInput={(e) => (cues.value = e.currentTarget.value)} />
      </label>
      <div class="catalog-edit__locked" role="group" aria-label="Fixed at creation">
        <dl class="catalog-edit__fixed">
          <dt>Metric</dt>
          <dd>{vm.metric}</dd>
          <dt>Per side</dt>
          <dd>{vm.perSide ? 'yes' : 'no'}</dd>
        </dl>
        <p class="catalog-edit__note">fixed at creation; create a new exercise instead</p>
      </div>
      {!deleted && (
        <>
          <div class="catalog-edit__actions">
            <Button kind="primary" disabled={busy.value || name.value.trim() === ''} onClick={() => void save()}>Save</Button>
            <Button disabled={busy.value} onClick={() => void archive(!vm.archived)}>{vm.archived ? 'Unarchive' : 'Archive'}</Button>
            {vm.canDelete && <Button kind="danger" disabled={busy.value} onClick={() => void remove()}>Delete</Button>}
          </div>
          {vm.deleteReason !== undefined && <p class="catalog-edit__reason">{vm.deleteReason}</p>}
        </>
      )}
      {c !== undefined && (
        <ClashSheet
          name={c.entry.name}
          detail={c.restoring
            ? 'Names are unique in the catalog. Rename that one to restore this one, or open it.'
            : c.entry.deletedAt !== undefined
              ? 'Names are unique in the catalog, deleted ones included. Open that exercise to restore it, or cancel and pick another name.'
              : 'Names are unique in the catalog. Open that exercise instead?'}
          busy={false}
          onUse={() => {
            clash.value = undefined;
            router.navigate({ tab: 'more', page: 'catalog', id: c.entry.id });
          }}
          onCancel={() => (clash.value = undefined)}
        />
      )}
    </>
  );
}
