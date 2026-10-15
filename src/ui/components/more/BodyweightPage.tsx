import { useComputed, useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { BODYWEIGHT_PATH } from '../../../sync/paths';
import { useApp } from '../../context';
import { formatAmount } from '../../format';
import { readOnlyBodyweight } from '../../locked';
import { BackBar, Button } from '../shared';
import { bodyweightLine, bodyweightRows } from './bodyweight.vm';
import { BodyweightSheet } from './BodyweightSheet';

const W = 320;
const H = 120;
const PAD = 16;

/** The sheet state: closed, adding, or editing one entry. */
type SheetState = { mode: 'closed' } | { mode: 'add' } | { mode: 'edit'; entryId: string };

/**
 * Spec 4 §6 "Bodyweight": the line (two entries on), the entries newest first, Add entry; a row edits.
 * A refused bodyweight.json shows the banner and no edit control; a read-only or needs-update file
 * (written by a newer app) still shows its entries and line, a quarantined one only the banner.
 */
export function BodyweightPage(): JSX.Element {
  const { data, router } = useApp();
  const sheet = useSignal<SheetState>({ mode: 'closed' });
  const refused = useComputed(() => data.refusedRows.value.find((r) => r.path === BODYWEIGHT_PATH));
  /** undefined: nothing to show (a quarantined or unparseable file); [] is a file without entries. */
  const shown = useComputed(() => {
    const ok = data.bodyweight.value?.file.entries;
    if (ok !== undefined) return ok;
    return refused.value === undefined ? [] : readOnlyBodyweight(data.refusedRows.value);
  });
  const entries = shown.value ?? [];

  const line = bodyweightLine(entries, W, H, PAD);
  const rows = bodyweightRows(entries);
  const blocked = refused.value;
  const current = sheet.value;
  const editing = current.mode === 'edit' && blocked === undefined ? entries.find((e) => e.id === current.entryId) : undefined;
  const close = (): void => { sheet.value = { mode: 'closed' }; };

  return (
    <section class="bw">
      <BackBar title="Bodyweight" onBack={() => router.navigate({ tab: 'more' })} />
      {blocked !== undefined && (
        <p class="bw__banner" role="alert">bodyweight.json is {blocked.duplicateOf !== undefined ? 'a duplicate' : blocked.status}; entries cannot be changed here. See the Sync tab.</p>
      )}
      {line !== undefined && (
        <svg class="bw-line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bodyweight over time">
          <polyline class="bw-line__path" points={line.polyline} />
          <text class="bw-line__label" x={W - 2} y={line.max.y - 4} text-anchor="end">{`${formatAmount(line.max.kg)} kg`}</text>
          {line.min.kg !== line.max.kg && (
            <text class="bw-line__label" x={W - 2} y={line.min.y + 12} text-anchor="end">{`${formatAmount(line.min.kg)} kg`}</text>
          )}
        </svg>
      )}
      {blocked === undefined && (
        <div class="bw__actions">
          <Button kind="primary" onClick={() => { sheet.value = { mode: 'add' }; }}>Add entry</Button>
        </div>
      )}
      {rows.length === 0 ? (
        shown.value !== undefined && <p class="bw__empty">No entries yet.</p>
      ) : (
        <ul class="bw__list">
          {rows.map((r) => (
            <li key={r.entryId}>
              <button
                type="button"
                class="bw-row"
                disabled={blocked !== undefined}
                onClick={() => { sheet.value = { mode: 'edit', entryId: r.entryId }; }}
              >
                <span class="bw-row__day">{r.day}</span>
                <span class="bw-row__kg">{r.kg}</span>
                {r.note !== undefined && <span class="bw-row__note">{r.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {current.mode === 'add' && <BodyweightSheet onClose={close} />}
      {editing !== undefined && <BodyweightSheet entry={editing} onClose={close} />}
    </section>
  );
}
