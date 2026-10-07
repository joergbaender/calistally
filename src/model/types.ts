import type { Static } from '@sinclair/typebox';
import { Strict } from './schema';

export type Exercise = Static<typeof Strict.Exercise>;
export type BodyweightEntry = Static<typeof Strict.BodyweightEntry>;
export type WorkoutSet = Static<typeof Strict.WorkoutSet>;
export type Block = Static<typeof Strict.Block>;
export type Session = Static<typeof Strict.Session>;
export type ExercisesFile = Static<typeof Strict.ExercisesFile>;
export type BodyweightFile = Static<typeof Strict.BodyweightFile>;
export type SessionFile = Static<typeof Strict.SessionFile>;
export type SessionLabel = NonNullable<Session['label']>;

export type Pattern = Exercise['pattern'];
export type LoadType = Exercise['defaultLoadType'];

/** The fields every stored record has (spec §3). */
export interface RecordMeta {
  updatedAt: string;
  deletedAt?: string;
}

export type FileKind = 'exercises' | 'bodyweight' | 'session';
