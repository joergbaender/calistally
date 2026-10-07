import { resolveExercise } from './exercises';
import { parseLine, type ParsedSet } from './parse-line';
import type { ReviewKind } from './types';

export interface CellBlock {
  /** 1-based index among the cell's non-empty lines (the `#n` of a decision key). */
  line: number;
  rawLine: string;
  /** undefined: no alias and no header fallback (review item `unknown-exercise`). */
  exerciseId: string | undefined;
  exerciseRaw: string;
  sets: ParsedSet[];
  aggregate?: true;
  restSec?: number;
  note?: string;
  orderFirst: boolean;
  bands: boolean;
}

export interface CellIssue {
  kind: ReviewKind;
  line: number;
  rawLine: string;
  detail: string;
}

export interface CellResult {
  blocks: CellBlock[];
  tags: string[];
  cuesDropped: string[];
  unrecognised: string[];
  issues: CellIssue[];
}

/** The non-empty, trimmed lines of a cell; their 1-based index is the `#n` of a decision key. */
export function cellLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
}

function setNote(block: CellBlock, note: string | undefined): void {
  if (note === undefined) delete block.note;
  else block.note = note;
}

function appendNote(existing: string | undefined, more: string | undefined): string | undefined {
  if (more === undefined || more === '') return existing;
  return existing === undefined ? more : `${existing} ${more}`;
}

/** Spec 2 §4 "Cells to blocks": lines → blocks, with header fallback, continuation, `dann`, `plus`. */
export function parseCell(text: string, header: string): CellResult {
  const lines = cellLines(text);
  const parsed = lines.map(parseLine);
  const result: CellResult = { blocks: [], tags: [], cuesDropped: [], unrecognised: [], issues: [] };
  let current: CellBlock | undefined;

  parsed.forEach((p, idx) => {
    const line = idx + 1;
    const rawLine = lines[idx]!;
    result.tags.push(...p.tags);
    result.cuesDropped.push(...p.cuesDropped);
    result.unrecognised.push(...p.unrecognised);
    const noteText = p.noteWords.length > 0 ? p.noteWords.join(' ') : undefined;
    const exerciseId = resolveExercise(p.alias?.id, header, { bands: p.bands, refinements: p.refinements });
    const exerciseRaw = p.alias?.raw ?? header;
    const make = (sets: ParsedSet[], extra: Partial<CellBlock> = {}): CellBlock => ({
      line,
      rawLine,
      exerciseId,
      exerciseRaw,
      sets,
      orderFirst: p.orderFirst,
      bands: p.bands,
      ...(p.restSec !== undefined ? { restSec: p.restSec } : {}),
      ...extra,
    });
    const pushIssues = (): void => {
      for (const i of p.issues) result.issues.push({ kind: i.kind, line, rawLine, detail: i.detail });
    };

    if (p.issues.some((i) => i.kind === 'unparsed-line')) {
      pushIssues();
      result.blocks.push(make([], { note: rawLine }));
      current = undefined;
      return;
    }
    if (p.nichts) {
      pushIssues();
      return;
    }
    if (p.segments.length === 0) {
      // Pure note line (tags, cues, leftover words): attach to the preceding block of this cell.
      pushIssues();
      if (current !== undefined) setNote(current, appendNote(current.note, noteText));
      else if (noteText !== undefined) result.blocks.push(make([], { note: noteText }));
      return;
    }

    const previous = result.blocks.at(-1);
    const previousLine = idx > 0 ? parsed[idx - 1] : undefined;
    const continuesNoteOnly =
      p.alias === undefined && p.join === 'new' && previous !== undefined && previousLine !== undefined &&
      previousLine.aliases.length === 1 && previous.sets.length === 0 && previous.note === previousLine.alias?.raw &&
      previous.line === idx;
    if (continuesNoteOnly) {
      // `Overhead Press Bands` then `10kg 15x 15x easy`: the second line fills the first line's block.
      const firstSeg = p.segments[0]!;
      result.issues = result.issues.filter((i) => !(i.kind === 'note-only' && i.line === previous.line));
      previous.sets = firstSeg.sets;
      delete previous.note;
      if (noteText !== undefined) previous.note = noteText;
      previous.bands = previous.bands || p.bands;
      if (p.restSec !== undefined) previous.restSec = p.restSec;
      if (firstSeg.aggregate) previous.aggregate = true;
      previous.exerciseId = resolveExercise(previousLine.alias?.id, header, { bands: previous.bands, refinements: p.refinements });
      current = previous;
      for (const seg of p.segments.slice(1)) {
        const b = make(seg.sets, { exerciseId: previous.exerciseId, exerciseRaw: previous.exerciseRaw });
        result.blocks.push(b);
        current = b;
      }
      pushIssues();
      return;
    }
    if (p.join === 'plus' && current !== undefined) {
      const firstSeg = p.segments[0]!;
      current.sets.push(...firstSeg.sets);
      setNote(current, appendNote(current.note, noteText));
      if (p.restSec !== undefined) current.restSec = p.restSec;
      for (const seg of p.segments.slice(1)) {
        const b = make(seg.sets, { exerciseId: current.exerciseId, exerciseRaw: current.exerciseRaw });
        result.blocks.push(b);
        current = b;
      }
      pushIssues();
      return;
    }
    if (p.join === 'dann' && current !== undefined && p.alias === undefined) {
      const inherit = { exerciseId: current.exerciseId, exerciseRaw: current.exerciseRaw };
      p.segments.forEach((seg, k) => {
        const b = make(seg.sets, { ...inherit, ...(k === 0 && noteText !== undefined ? { note: noteText } : {}) });
        result.blocks.push(b);
        current = b;
      });
      pushIssues();
      return;
    }
    p.segments.forEach((seg, k) => {
      const b = make(seg.sets, {
        ...(seg.aggregate ? { aggregate: true as const } : {}),
        ...(seg.noteOnly !== undefined ? { note: seg.noteOnly } : {}),
        ...(k === 0 && noteText !== undefined && seg.noteOnly === undefined ? { note: noteText } : {}),
      });
      if (seg.noteOnly !== undefined && p.aliases.length > 1) {
        const own = p.aliases[k];
        b.exerciseId = resolveExercise(own?.id, header, { bands: p.bands, refinements: p.refinements });
        b.exerciseRaw = own?.raw ?? header;
      }
      result.blocks.push(b);
      current = b;
    });
    if (exerciseId === undefined) result.issues.push({ kind: 'unknown-exercise', line, rawLine, detail: `no exercise for "${exerciseRaw}"` });
    pushIssues();
  });
  return result;
}
