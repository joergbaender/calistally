import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { createExercise, findByName, type NewExerciseFields } from '../../../model/catalog';
import type { Exercise } from '../../../model/types';
import { EXERCISES_PATH } from '../../../sync/paths';
import { useApp } from '../../context';
import { readOnlyCatalog } from '../../locked';
import { reportWrite } from '../log/outcome';
import { BackBar, Button, ClashSheet, ExerciseForm, useBusy } from '../shared';
import { createClash } from '../shared/create-clash';
import { catalogRefusedReason, catalogVm, type CatalogRow } from './catalog.vm';

/** A row opens its edit form; without `onOpen` (a read-only catalog) the rows are plain text. */
function Rows(p: { label: string; rows: readonly CatalogRow[]; onOpen: ((id: string) => void) | undefined }): JSX.Element {
  const open = p.onOpen;
  return (
    <ul class="catalog__rows" aria-label={p.label}>
      {p.rows.map((r) => (
        <li key={r.id}>
          {open === undefined ? (
            <div class="catalog-row">
              <span class="catalog-row__name">{r.name}</span>
              <span class="catalog-row__meta">{r.meta}</span>
            </div>
          ) : (
            <button type="button" class="catalog-row" onClick={() => open(r.id)}>
              <span class="catalog-row__name">{r.name}</span>
              <span class="catalog-row__meta">{r.meta}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A Create that would reuse an existing entry and waits for the owner's answer. */
interface PendingClash { name: string; fields: NewExerciseFields; existing: Exercise; detail: string }

/**
 * Spec 4 §6 `#/more/catalog`: every exercise, live first by family, then archived; each line with
 * pattern, metric, per side and default load type; a line opens the edit form. **Create** opens the
 * shared exercise form. A name that exists already never makes a second entry (spec 1 §3): a live
 * entry with the same metric and per side opens at once; otherwise the clash sheet offers it first
 * (archived or deleted: "Use it" brings it back; another metric or per side: it is named, since
 * both stay as they were), and Cancel returns to the form. Read-only with a banner when the catalog
 * row is refused or missing (spec 1 §5); a read-only or needs-update file still lists its entries.
 */
export function CatalogPage(): JSX.Element {
  const { data, router } = useApp();
  const formOpen = useSignal(false);
  const { busy, run } = useBusy();
  const clash = useSignal<PendingClash | undefined>(undefined);
  const entries = data.catalog.value?.file.exercises ?? readOnlyCatalog(data.refusedRows.value);
  const vm = catalogVm(entries, catalogRefusedReason(data.refusedRows.value));
  const editable = vm.readOnly === undefined;
  const open = (id: string): void => router.navigate({ tab: 'more', page: 'catalog', id });

  const createOnce = async (name: string, fields: NewExerciseFields, confirmed: boolean): Promise<void> => {
    const now = data.clock();
    const before = data.exercises.value;
    const existing = findByName(before, name);
    if (existing !== undefined && !confirmed) {
      const detail = createClash(existing, fields, { askOnRevive: true });
      if (detail !== undefined) {
        clash.value = { name, fields, existing, detail };
        return;
      }
    }
    const preview = createExercise(name, fields, before, now);
    // An existing live entry needs no write; one that was archived or deleted is revived by the write.
    if (preview.existing && preview.catalog.every((e, i) => e === before[i])) {
      clash.value = undefined;
      formOpen.value = false;
      open(preview.exercise.id);
      return;
    }
    let made: Exercise | undefined;
    const ok = await reportWrite(EXERCISES_PATH, () =>
      data.edit('exercises', EXERCISES_PATH, (f) => {
        const result = createExercise(name, fields, f.exercises, now);
        made = result.exercise;
        return { ...f, exercises: result.catalog };
      }),
    );
    if (!ok || made === undefined) return;
    clash.value = undefined;
    formOpen.value = false;
    open(made.id);
  };

  /** One create at a time: a second tap during the catalog write would write again. */
  const create = (name: string, fields: NewExerciseFields, confirmed: boolean): Promise<void> => run(() => createOnce(name, fields, confirmed));

  const empty = vm.live.length === 0 && vm.archived.length === 0;
  const onOpen = editable ? open : undefined;
  const pending = clash.value;
  return (
    <div class="more-page catalog">
      <BackBar title="Catalog" onBack={() => router.navigate({ tab: 'more' })} />
      {vm.readOnly !== undefined && <p class="catalog__banner" role="alert">{vm.readOnly}</p>}
      <div class="catalog__actions">
        <Button kind="primary" disabled={!editable} onClick={() => (formOpen.value = true)}>Create</Button>
      </div>
      {/* Without entries to show (no catalog, or a quarantined one) the banner says it all. */}
      {empty && entries !== undefined && <p class="more-page__empty">No exercises yet.</p>}
      {vm.live.map((g) => (
        <section key={g.family} class="catalog__group">
          <h2 class="catalog__family">{g.family}</h2>
          <Rows label={g.family} rows={g.rows} onOpen={onOpen} />
        </section>
      ))}
      {vm.archived.length > 0 && (
        <section class="catalog__group catalog__group--archived">
          <h2 class="catalog__family">Archived</h2>
          <Rows label="Archived" rows={vm.archived} onOpen={onOpen} />
        </section>
      )}
      {formOpen.value && editable && (
        <ExerciseForm
          initialName=""
          busy={busy.value}
          onSave={(name, fields) => void create(name, fields, false)}
          onCancel={() => (formOpen.value = false)}
        />
      )}
      {pending !== undefined && formOpen.value && editable && (
        <ClashSheet
          name={pending.existing.name}
          detail={pending.detail}
          busy={busy.value}
          onUse={() => void create(pending.name, pending.fields, true)}
          onCancel={() => (clash.value = undefined)}
        />
      )}
    </div>
  );
}
