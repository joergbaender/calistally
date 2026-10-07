import type { Block, BodyweightEntry, BodyweightFile, Exercise, ExercisesFile, Session, SessionFile, WorkoutSet } from './types';
import { MODEL_VERSION } from './schema';

export const T0 = '2030-01-01T10:00:00.000Z';

let counter = 0;
/** Deterministic, valid v4-shaped uuids: 00000000-0000-4000-8000-000000000001, …002, … */
export function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

export function exercise(over: Partial<Exercise> = {}): Exercise {
  return {
    id: 'pull-ups',
    name: 'Pull-ups',
    pattern: 'pull',
    metric: 'reps',
    perSide: false,
    defaultLoadType: 'bodyweight',
    archived: false,
    updatedAt: T0,
    ...over,
  };
}

export function bodyweight(over: Partial<BodyweightEntry> = {}): BodyweightEntry {
  return { id: uuid(), date: '2030-01-01', kg: 80, updatedAt: T0, ...over };
}

export function exercisesFile(exercises: Exercise[] = []): ExercisesFile {
  return { schemaVersion: MODEL_VERSION, exercises };
}

export function bodyweightFile(entries: BodyweightEntry[] = []): BodyweightFile {
  return { schemaVersion: MODEL_VERSION, entries };
}

export function set(over: Partial<Extract<WorkoutSet, { reps: number }>> = {}): WorkoutSet {
  return { id: uuid(), order: 0, reps: 10, loadType: 'bodyweight', loadKg: 0, updatedAt: T0, ...over };
}

export function timedSet(over: Partial<Extract<WorkoutSet, { seconds: number }>> = {}): WorkoutSet {
  return { id: uuid(), order: 0, seconds: 30, loadType: 'bodyweight', loadKg: 0, updatedAt: T0, ...over };
}

/** A block's sets from a list of rep counts, e.g. ladder([17, 16, 15]). */
export function ladder(reps: number[], over: Partial<Extract<WorkoutSet, { reps: number }>> = {}): WorkoutSet[] {
  return reps.map((r, i) => set({ reps: r, order: i, ...over }));
}

export function block(sets: WorkoutSet[] = [], over: Partial<Block> = {}): Block {
  return { id: uuid(), order: 0, exerciseId: 'pull-ups', sets, updatedAt: T0, ...over };
}

export function session(blocks: Block[] = [], over: Partial<Session> = {}): Session {
  return { id: uuid(), date: '2030-01-01', tags: [], source: 'app', blocks, updatedAt: T0, ...over };
}

export function sessionFile(s: Session = session()): SessionFile {
  return { schemaVersion: MODEL_VERSION, session: s };
}
