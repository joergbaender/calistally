import { compareBlocks, liveBlocks, liveSets } from './derive/order';
import { amountOf, metricOf } from './derive/totals';
import { nextOrder, orderBetween, tombstone, touch, undelete } from './record';
import { EXERCISE_ID_PATTERN, MODEL_VERSION } from './schema';
import type { Block, LoadType, Session, SessionFile, SessionLabel, WorkoutSet } from './types';
import { isCalendarDate, isTimestamp } from './validate';

/**
 * Pure edits over session files (spec 4 §3 "Edits"). Every function takes the current file and
 * returns a new one with `updatedAt` moved on the edited record only (spec 1 §3 "What updatedAt
 * covers"); `now` is always passed in. A result passes `validateForWrite('session', …)` whenever
 * the input did; input that could not be stored is refused with an `EditError`.
 */
export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditError';
  }
}

/** A new set; exactly one of reps / seconds; completedAt only from the Log tab (D16). */
export interface SetInput {
  reps?: number;
  seconds?: number;
  loadType: LoadType;
  loadKg: number;
  note?: string;
  completedAt?: string;
}

/** Field changes; `null` removes the note. A reps/seconds switch is not allowed (the metric is the exercise's). */
export interface SetFields {
  reps?: number;
  seconds?: number;
  loadType?: LoadType;
  loadKg?: number;
  note?: string | null;
}

export interface SessionFields {
  date?: string;
  /** true: the date is no longer an estimate; removes `dateUncertain` (spec 4 §5). */
  dateExact?: true;
  label?: SessionLabel | null;
  notes?: string | null;
  tags?: string[];
}

/** Three rules. The kg must be a finite number >= 0 (EditError otherwise); added/assist at 0 kg
 *  is bodyweight (spec 1 §3), so added/assist never stays at <= 0 kg; bodyweight carries 0 kg
 *  (EditError otherwise, the file would not validate). */
export function normalizeLoad(loadType: LoadType, loadKg: number): { loadType: LoadType; loadKg: number } {
  if (!Number.isFinite(loadKg)) throw new EditError(`load must be a number, got ${loadKg}`);
  if (loadKg < 0) throw new EditError(`load must not be negative, got ${loadKg} kg`);
  if ((loadType === 'added' || loadType === 'assist') && loadKg === 0) return { loadType: 'bodyweight', loadKg: 0 };
  if (loadType === 'bodyweight' && loadKg !== 0) throw new EditError(`bodyweight carries no kg, got ${loadKg}`);
  return { loadType, loadKg };
}

function requireDate(date: string): string {
  if (!isCalendarDate(date)) throw new EditError(`not a calendar date: ${date}`);
  return date;
}

/** Trimmed text, or undefined when the field is to be removed (null, empty or blank). */
function optionalText(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** `{ key: value }` when value is defined, else `{}`: keeps optional properties absent, never undefined. */
function opt<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

function newId(id: string | undefined): string {
  return id ?? crypto.randomUUID();
}

function withSession(file: SessionFile, session: Session): SessionFile {
  return { ...file, session };
}

export function startSession(now: Date, localDate: string, id?: string): SessionFile {
  const stamp = now.toISOString();
  return {
    schemaVersion: MODEL_VERSION,
    session: {
      id: newId(id),
      date: requireDate(localDate),
      startedAt: stamp,
      tags: [],
      source: 'app',
      blocks: [],
      updatedAt: stamp,
    },
  };
}

export function createPastSession(date: string, now: Date, id?: string): SessionFile {
  return {
    schemaVersion: MODEL_VERSION,
    session: { id: newId(id), date: requireDate(date), tags: [], source: 'app', blocks: [], updatedAt: now.toISOString() },
  };
}

/** Touches the session only; `null` removes label / notes; `dateExact: true` removes dateUncertain. */
export function setSessionFields(file: SessionFile, fields: SessionFields, now: Date): SessionFile {
  const { label: _label, notes: _notes, dateUncertain, ...rest } = file.session;
  const label = fields.label === undefined ? file.session.label : fields.label === null ? undefined : fields.label;
  const notes = fields.notes === undefined ? file.session.notes : optionalText(fields.notes);
  const tags = fields.tags === undefined ? file.session.tags : fields.tags.map((t) => t.trim()).filter((t) => t !== '');
  const session: Session = {
    ...rest,
    date: fields.date === undefined ? file.session.date : requireDate(fields.date),
    tags,
    ...opt('dateUncertain', fields.dateExact === true ? undefined : dateUncertain),
    ...opt('label', label),
    ...opt('notes', notes),
  };
  return withSession(file, touch(session, now));
}

export function deleteSession(file: SessionFile, now: Date): SessionFile {
  return withSession(file, tombstone(file.session, now));
}

export function undeleteSession(file: SessionFile, now: Date): SessionFile {
  return withSession(file, undelete(file.session, now));
}

// ---- blocks ----------------------------------------------------------------------------------

const EXERCISE_ID_RE = new RegExp(EXERCISE_ID_PATTERN);

/** Lookup by id, tombstoned blocks included (undelete needs them). */
export function findBlock(session: Session, blockId: string): Block | undefined {
  return session.blocks.find((b) => b.id === blockId);
}

function requireBlock(session: Session, blockId: string): Block {
  const found = findBlock(session, blockId);
  if (found === undefined) throw new EditError(`unknown block ${blockId}`);
  return found;
}

/** Edits other than undelete refuse a tombstoned session: no view would show what they write. */
function requireLiveSession(session: Session): void {
  if (session.deletedAt !== undefined) throw new EditError('the session was deleted');
}

/** A block an edit may change: known, in a live session, and not tombstoned itself. */
function requireLiveBlock(session: Session, blockId: string): Block {
  requireLiveSession(session);
  const found = requireBlock(session, blockId);
  if (found.deletedAt !== undefined) throw new EditError('the block was deleted');
  return found;
}

/** The file with one block replaced (by id); the session record itself is not touched. */
function replaceBlock(file: SessionFile, next: Block): SessionFile {
  return withSession(file, { ...file.session, blocks: file.session.blocks.map((b) => (b.id === next.id ? next : b)) });
}

export function addBlock(file: SessionFile, exerciseId: string, now: Date, id?: string): { file: SessionFile; blockId: string } {
  requireLiveSession(file.session);
  if (!EXERCISE_ID_RE.test(exerciseId)) throw new EditError(`not an exercise id: "${exerciseId}"`);
  const blockId = newId(id);
  const added: Block = { id: blockId, order: nextOrder(file.session.blocks), exerciseId, sets: [], updatedAt: now.toISOString() };
  return { file: withSession(file, { ...file.session, blocks: [...file.session.blocks, added] }), blockId };
}

export function setBlockNote(file: SessionFile, blockId: string, note: string | null, now: Date): SessionFile {
  const { note: _note, ...rest } = requireLiveBlock(file.session, blockId);
  return replaceBlock(file, touch({ ...rest, ...opt('note', optionalText(note)) }, now));
}

export function deleteBlock(file: SessionFile, blockId: string, now: Date): SessionFile {
  return replaceBlock(file, tombstone(requireLiveBlock(file.session, blockId), now));
}

export function undeleteBlock(file: SessionFile, blockId: string, now: Date): SessionFile {
  return replaceBlock(file, undelete(requireBlock(file.session, blockId), now));
}

/**
 * Moves the block past its canonical live neighbour by giving it a midpoint order between that
 * neighbour and the next live block beyond with a *different* order (spec 1 §3 "Sibling order":
 * nobody else is renumbered); one past the neighbour when there is none. Blocks that share the
 * neighbour's order (two devices each appended) cannot be split by an order value, so the moved
 * block steps past the whole tied run: one touch beats renumbering the neighbours. At the edge
 * the same file object comes back. Should no representable number fit between the two orders
 * (adjacent doubles), the move is refused rather than written as a non-move.
 */
export function moveBlock(file: SessionFile, blockId: string, direction: 'up' | 'down', now: Date): SessionFile {
  requireLiveSession(file.session);
  const live = liveBlocks(file.session);
  const moved = live.find((b) => b.id === blockId);
  if (moved === undefined) throw new EditError(`unknown or deleted block ${blockId}`);
  const at = live.indexOf(moved);
  const step = direction === 'up' ? -1 : 1;
  const neighbour = live[at + step];
  if (neighbour === undefined) return file;
  let beyond: Block | undefined;
  for (let i = at + 2 * step; beyond === undefined && i >= 0 && i < live.length; i += step) {
    const candidate = live[i];
    if (candidate !== undefined && candidate.order !== neighbour.order) beyond = candidate;
  }
  const order = beyond === undefined ? neighbour.order + step : orderBetween(beyond.order, neighbour.order);
  const next: Block = { ...moved, order };
  if (Math.sign(compareBlocks(next, neighbour)) !== step) {
    throw new EditError(`no order fits between ${beyond?.order} and ${neighbour.order} to move block ${blockId} ${direction}`);
  }
  return replaceBlock(file, touch(next, now));
}

// ---- sets ------------------------------------------------------------------------------------

type Metric = 'reps' | 'seconds';

/** Lookup by id across every block, tombstoned blocks and sets included. */
export function findSet(session: Session, setId: string): { block: Block; set: WorkoutSet } | undefined {
  for (const block of session.blocks) {
    const set = block.sets.find((s) => s.id === setId);
    if (set !== undefined) return { block, set };
  }
  return undefined;
}

function requireSet(session: Session, setId: string): { block: Block; set: WorkoutSet } {
  const found = findSet(session, setId);
  if (found === undefined) throw new EditError(`unknown set ${setId}`);
  return found;
}

/** A set an edit may change: its block and its session are live (undeleteSet uses requireSet). */
function requireLiveSet(session: Session, setId: string): { block: Block; set: WorkoutSet } {
  requireLiveSession(session);
  const found = requireSet(session, setId);
  if (found.block.deletedAt !== undefined) throw new EditError('the block was deleted');
  return found;
}

/** The file with one set of one block replaced (by id); neither the block nor the session is touched. */
function replaceSet(file: SessionFile, block: Block, next: WorkoutSet): SessionFile {
  return replaceBlock(file, { ...block, sets: block.sets.map((s) => (s.id === next.id ? next : s)) });
}

/** D18: reps > 0; the same for seconds. */
function requireAmount(metric: Metric, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new EditError(`${metric} must be more than 0, got ${amount}`);
  return amount;
}

/** The one metric given, checked; undefined when neither is given; EditError on both. */
function inputAmount(input: { reps?: number; seconds?: number }): { metric: Metric; amount: number } | undefined {
  const { reps, seconds } = input;
  if (reps !== undefined && seconds !== undefined) throw new EditError('a set has reps or seconds, not both');
  if (reps !== undefined) return { metric: 'reps', amount: requireAmount('reps', reps) };
  if (seconds !== undefined) return { metric: 'seconds', amount: requireAmount('seconds', seconds) };
  return undefined;
}

type SetCommon = Omit<WorkoutSet, 'reps' | 'seconds'>;

function withAmount(common: SetCommon, metric: Metric, amount: number): WorkoutSet {
  return metric === 'reps' ? { ...common, reps: amount } : { ...common, seconds: amount };
}

/** The set without its amount field (the one metric it carries); the amount itself is `amountOf`. */
function withoutAmount(set: WorkoutSet): SetCommon {
  if ('reps' in set) {
    const { reps: _reps, ...common } = set;
    return common;
  }
  const { seconds: _seconds, ...common } = set;
  return common;
}

/** Appends a set to the block; order = nextOrder over every sibling (deleted ones included), updatedAt = now. */
export function addSet(file: SessionFile, blockId: string, input: SetInput, now: Date, id?: string): { file: SessionFile; setId: string } {
  const target = requireLiveBlock(file.session, blockId);
  const given = inputAmount(input);
  if (given === undefined) throw new EditError('a set needs reps or seconds');
  // One live set is enough to read the block's metric: the hard rule keeps live sets uniform.
  const existing = liveSets(target)[0];
  if (existing !== undefined && metricOf(existing) !== given.metric) {
    throw new EditError(`the block's sets count ${metricOf(existing)}, not ${given.metric}`);
  }
  if (input.completedAt !== undefined && !isTimestamp(input.completedAt)) {
    throw new EditError(`not a timestamp: ${input.completedAt}`);
  }
  const setId = newId(id);
  const common: SetCommon = {
    id: setId,
    order: nextOrder(target.sets),
    ...normalizeLoad(input.loadType, input.loadKg),
    updatedAt: now.toISOString(),
    ...opt('note', optionalText(input.note)),
    ...opt('completedAt', input.completedAt),
  };
  const added = withAmount(common, given.metric, given.amount);
  return { file: replaceBlock(file, { ...target, sets: [...target.sets, added] }), setId };
}

/** Changes amount, load and note of one set; never touches completedAt (D16). A load given as
 *  type only merges with the stored kg, except that a switch to bodyweight zeroes the kg. */
export function setSetFields(file: SessionFile, setId: string, fields: SetFields, now: Date): SessionFile {
  const { block, set: current } = requireLiveSet(file.session, setId);
  const metric = metricOf(current);
  const change = inputAmount(fields);
  if (change !== undefined && change.metric !== metric) {
    throw new EditError(`a ${metric} set cannot take ${change.metric}: the metric is the exercise's`);
  }
  const loadType = fields.loadType ?? current.loadType;
  const loadKg = fields.loadKg ?? (fields.loadType === 'bodyweight' ? 0 : current.loadKg);
  const load = fields.loadType === undefined && fields.loadKg === undefined ? undefined : normalizeLoad(loadType, loadKg);
  if (current.aggregate === true && (change !== undefined || load !== undefined)) {
    throw new EditError('an aggregate set can change only its note');
  }
  const { note: _note, ...rest } = withoutAmount(current);
  const common: SetCommon = {
    ...rest,
    ...(load ?? {}),
    ...opt('note', fields.note === undefined ? current.note : optionalText(fields.note)),
  };
  const amount = change === undefined ? amountOf(current) : change.amount;
  return replaceSet(file, block, touch(withAmount(common, metric, amount), now));
}

export function deleteSet(file: SessionFile, setId: string, now: Date): SessionFile {
  const { block, set } = requireLiveSet(file.session, setId);
  return replaceSet(file, block, tombstone(set, now));
}

export function undeleteSet(file: SessionFile, setId: string, now: Date): SessionFile {
  const { block, set } = requireSet(file.session, setId);
  return replaceSet(file, block, undelete(set, now));
}
