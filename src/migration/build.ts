import type { Block, BodyweightEntry, Exercise, LoadType, Session, WorkoutSet } from '../model/types';
import { classifyDate, resolveBlockDates, type DateStatus, type ResolvedDate } from './dates';
import { applyCellDecisions, type Decisions } from './decisions';
import { uuidV5 } from './ids';
import { cellLines, parseCell, type CellBlock } from './parse-cell';
import type { ParsedSet } from './parse-line';
import type { SourceRow } from './rows';
import { COLUMN_BLOCKS } from './sheet';
import type { ReportEntry, ReviewItem, ReviewKind } from './types';

export interface BuildResult {
  sessions: Session[];
  catalog: Exercise[];
  bodyweight: BodyweightEntry[];
  review: ReviewItem[];
  report: ReportEntry[];
}

export interface BuildOptions {
  year: number;
  stamp: string;
  bodyweightKg: number;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Spec 2 §5 "Load type per set". `ohne`/`Bodyweight` are explicit, so they win for any exercise kind. */
export function loadOf(set: ParsedSet, exercise: Exercise, bands: boolean): { loadType: LoadType; loadKg: number; missing: boolean } {
  const kind = exercise.defaultLoadType;
  const bodyKind = kind === 'bodyweight' || kind === 'added' || kind === 'assist';
  if (set.kg !== undefined && set.kg > 0) {
    if (bands) return { loadType: 'band', loadKg: round2(set.kg), missing: false };
    return { loadType: bodyKind ? 'added' : kind, loadKg: round2(set.kg), missing: false };
  }
  if (bodyKind || set.bodyweight) return { loadType: 'bodyweight', loadKg: 0, missing: false };
  return { loadType: bands ? 'band' : kind, loadKg: 0, missing: true };
}

/** Spec 2 §4–§9: rows → sessions, catalog, bodyweight, review items and report entries. */
export function buildSessions(rows: readonly SourceRow[], decisions: Decisions, catalog: readonly Exercise[], options: BuildOptions): BuildResult {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const review: ReviewItem[] = [];
  const report: ReportEntry[] = [];
  const usedKeys = new Set<string>();
  const seenKeys = new Set<string>();

  const statusOf = (row: SourceRow): DateStatus => {
    const d = decisions[row.dateAddress];
    const parsed = classifyDate(row.dateCell, options.year);
    if (d !== undefined) seenKeys.add(row.dateAddress);
    if (d?.date === undefined) return parsed;
    const parsedDate = 'date' in parsed ? parsed.date : undefined;
    if (parsedDate !== d.date) usedKeys.add(row.dateAddress);
    return { kind: 'exact', date: d.date };
  };

  // 1. Dates, per column block; Extra sessions fall back to their host row (spec 2 §4).
  const resolved = new Map<string, ResolvedDate>();
  for (const block of COLUMN_BLOCKS) {
    const blockRows = rows.filter((r) => r.block === block.name);
    for (const rd of resolveBlockDates(blockRows.map((r) => ({ key: r.key, status: statusOf(r) })), options.year)) resolved.set(rd.key, rd);
  }
  for (const r of rows) {
    if (r.block !== 'Extra') continue;
    const status = statusOf(r);
    const host = r.hostKey !== undefined ? resolved.get(r.hostKey) : undefined;
    const rd: ResolvedDate = { key: r.key, date: '', uncertain: false, items: [], repairs: [] };
    if (status.kind === 'exact' || status.kind === 'repaired' || status.kind === 'doubtful') {
      rd.date = status.date;
      if (status.kind === 'repaired') rd.repairs.push(status.repair);
      if (status.kind === 'doubtful') {
        rd.uncertain = true;
        rd.items.push({ kind: 'date-repaired-doubtful', detail: status.reason });
      }
    } else {
      rd.date = host?.date ?? `${options.year}-01-01`;
      rd.uncertain = true;
      const text = status.kind === 'unreadable' ? status.text : '';
      rd.items.push({ kind: 'date-unreadable', detail: `"${text}" is not a date; using the push row's date`, proposal: rd.date });
    }
    resolved.set(r.key, rd);
  }
  for (const r of rows) {
    const d = decisions[r.dateAddress];
    const rd = resolved.get(r.key)!;
    if (d?.dateExact && rd.uncertain) {
      rd.uncertain = false;
      rd.items = [];
      usedKeys.add(r.dateAddress);
    }
  }

  // 2. One session per row.
  const sessions: Session[] = [];
  for (const row of rows) {
    const rd = resolved.get(row.key)!;
    for (const repair of rd.repairs) {
      report.push({ kind: 'repair', where: row.dateAddress, detail: `date "${row.dateCell?.value ?? ''}" → ${rd.date} (${repair})` });
    }
    for (const item of rd.items) {
      const flag = rd.uncertain ? ', flagged dateUncertain' : '';
      let proposal = `date ${rd.date}${flag}`;
      if (item.proposal !== undefined) {
        proposal = item.kind === 'date-out-of-order' ? `proposed ${item.proposal}; written date kept${flag}` : `using proposed ${item.proposal}${flag}`;
      }
      review.push({
        kind: item.kind,
        key: row.dateAddress,
        block: row.block,
        row: row.row,
        date: rd.date,
        raw: row.dateCell?.value ?? '',
        proposal,
        detail: item.detail,
      });
    }
    if (row.cells.length === 0) {
      review.push({ kind: 'empty-row', key: row.dateAddress, block: row.block, row: row.row, date: rd.date, raw: row.dateCell?.value ?? '', proposal: 'session without blocks', detail: 'a date with no exercise cells' });
    }

    const tags = new Set<string>();
    const built: { cell: CellBlock; address: string; exercise: Exercise; lineCount: number }[] = [];
    for (const cell of row.cells) {
      const applied = applyCellDecisions(cell.address, cell.text, decisions);
      for (const k of applied.used) usedKeys.add(k);
      for (const k of applied.seen) seenKeys.add(k);
      if (applied.text === undefined) {
        report.push({ kind: 'skipped', where: cell.address, detail: `cell skipped by decision: ${JSON.stringify(cell.text)}` });
        continue;
      }
      const parsed = parseCell(applied.text, cell.header);
      const lineCount = cellLines(applied.text).length;
      for (const t of parsed.tags) tags.add(t);
      if (parsed.cuesDropped.length > 0) report.push({ kind: 'dropped', where: cell.address, detail: `cues dropped: ${parsed.cuesDropped.join(', ')}` });
      for (const w of parsed.unrecognised) report.push({ kind: 'unrecognised', where: cell.address, detail: `"${w}" kept as note text` });
      const keyFor = (line: number): string => (lineCount > 1 ? `${cell.address}#${line}` : cell.address);
      for (const issue of parsed.issues) {
        review.push({
          kind: issue.kind,
          key: keyFor(issue.line),
          block: row.block,
          row: row.row,
          date: rd.date,
          raw: issue.rawLine,
          proposal: proposalFor(issue.kind, parsed.blocks.filter((b) => b.line === issue.line)),
          detail: issue.detail,
        });
      }
      for (const b of parsed.blocks) {
        const exercise = b.exerciseId !== undefined ? byId.get(b.exerciseId) : undefined;
        if (exercise === undefined) {
          if (b.exerciseId !== undefined) {
            review.push({ kind: 'unknown-exercise', key: keyFor(b.line), block: row.block, row: row.row, date: rd.date, raw: b.rawLine, proposal: 'block dropped', detail: `${b.exerciseId} is not in the catalog` });
          }
          continue;
        }
        built.push({ cell: b, address: cell.address, exercise, lineCount });
      }
    }

    const ordered = [...built.filter((b) => b.cell.orderFirst), ...built.filter((b) => !b.cell.orderFirst)];
    const sessionName = `session/${row.key}`;
    const blocks: Block[] = ordered.map((b, blockIndex) => {
      const blockName = `${sessionName}/block/${blockIndex}`;
      const sets: WorkoutSet[] = b.cell.sets.map((s, setIndex) => {
        const load = loadOf(s, b.exercise, b.cell.bands);
        if (load.missing) {
          review.push({
            kind: 'load-missing',
            key: b.lineCount > 1 ? `${b.address}#${b.cell.line}` : b.address,
            block: row.block,
            row: row.row,
            date: rd.date,
            raw: b.cell.rawLine,
            proposal: `${load.loadType} 0 kg`,
            detail: `${b.exercise.name} is a ${b.exercise.defaultLoadType} exercise and the cell has no kg`,
          });
        }
        return {
          updatedAt: options.stamp,
          id: uuidV5(`${blockName}/set/${setIndex}`),
          order: setIndex,
          reps: s.reps,
          loadType: load.loadType,
          loadKg: load.loadKg,
          ...(b.cell.restSec !== undefined ? { restSec: b.cell.restSec } : {}),
          ...(b.cell.aggregate ? { aggregate: true as const } : {}),
        };
      });
      return {
        updatedAt: options.stamp,
        id: uuidV5(blockName),
        order: blockIndex,
        exerciseId: b.exercise.id,
        ...(b.cell.note !== undefined ? { note: b.cell.note } : {}),
        sets,
      };
    });

    const notes = row.noteCells.map((c) => `${c.header}: ${c.text.trim()}`).join('\n');
    sessions.push({
      updatedAt: options.stamp,
      id: uuidV5(sessionName),
      date: rd.date,
      ...(rd.uncertain ? { dateUncertain: true as const } : {}),
      label: row.label,
      ...(notes !== '' ? { notes } : {}),
      tags: [...tags].sort(),
      source: 'migrated',
      blocks,
    });
  }

  // load-missing is raised once per block, not once per set.
  dedupe(review);

  // 3. accept decisions close items; 4. stale decisions become items.
  const open: ReviewItem[] = [];
  for (const item of review) {
    const address = item.key.split('#')[0]!;
    const d = decisions[item.key] ?? (item.key !== address ? decisions[address] : undefined);
    const key = decisions[item.key] !== undefined ? item.key : address;
    if (d?.accept) {
      usedKeys.add(key);
      seenKeys.add(key);
      report.push({ kind: 'accepted', where: item.key, detail: `${item.kind}: ${item.proposal}${d.why !== undefined ? ` (${d.why})` : ''}` });
    } else open.push(item);
  }
  for (const [key, d] of Object.entries(decisions)) {
    if (d.why !== undefined) report.push({ kind: 'decision', where: key, detail: d.why });
    if (!usedKeys.has(key)) {
      const address = key.split('#')[0]!;
      const row = rows.find((r) => r.dateAddress === address || r.cells.some((c) => c.address === address));
      open.push({
        kind: 'stale-decision',
        key,
        block: row?.block ?? '?',
        row: row?.row ?? 0,
        date: row !== undefined ? resolved.get(row.key)?.date : undefined,
        raw: JSON.stringify(d),
        proposal: 'decision ignored',
        detail: seenKeys.has(key) ? 'the decision changes nothing' : 'no cell or item has this key',
      });
    }
  }

  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const earliest = sessions[0]?.date ?? `${options.year}-01-01`;
  const bodyweight: BodyweightEntry[] = [{
    updatedAt: options.stamp,
    id: uuidV5('bodyweight/initial'),
    date: earliest,
    kg: options.bodyweightKg,
    note: `estimated, constant ${options.bodyweightKg} kg through ${options.year} (migration)`,
  }];
  open.sort(compareItems);
  return { sessions, catalog: [...catalog], bodyweight, review: open, report };
}

function proposalFor(kind: ReviewKind, blocks: readonly CellBlock[]): string {
  const summary = blocks
    .map((b) => {
      const sets = b.sets.length === 0
        ? (b.note !== undefined ? `note-only "${b.note}"` : 'no sets')
        : b.sets.map((s) => `${s.reps}${s.kg !== undefined ? `@${s.kg}` : ''}`).join(' ');
      return `${b.exerciseId ?? '?'}: ${sets}${b.aggregate ? ' (aggregate)' : ''}`;
    })
    .join(' | ');
  switch (kind) {
    case 'unparsed-line':
      return `emitted as note-only block with the raw line; ${summary}`;
    case 'unknown-exercise':
      return 'block dropped';
    default:
      return summary;
  }
}

const BLOCK_ORDER: Readonly<Record<string, number>> = { Pull: 0, Push: 1, Legs: 2, Extra: 3, '?': 4 };

function compareItems(a: ReviewItem, b: ReviewItem): number {
  const ba = BLOCK_ORDER[a.block] ?? 9;
  const bb = BLOCK_ORDER[b.block] ?? 9;
  if (ba !== bb) return ba - bb;
  if (a.row !== b.row) return a.row - b.row;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function dedupe(items: ReviewItem[]): void {
  const seen = new Set<string>();
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const sig = `${items[i]!.kind}|${items[i]!.key}|${items[i]!.detail}`;
    if (seen.has(sig)) items.splice(i, 1);
    else seen.add(sig);
  }
}
