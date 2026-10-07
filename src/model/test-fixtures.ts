import type { BodyweightEntry, BodyweightFile, Exercise, ExercisesFile } from './types';
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
