import { Type, type TProperties } from '@sinclair/typebox';

export const MODEL_VERSION = 1;

// Patterns are shared with the emitted JSON Schema, so they are plain strings, not RegExp.
export const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
export const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
export const EXERCISE_ID_PATTERN = '^[a-z0-9]+(-[a-z0-9]+)*$';

export const PATTERNS = ['push', 'pull', 'legs', 'core', 'shoulders', 'neck', 'conditioning', 'other'] as const;
export const LOAD_TYPES = ['bodyweight', 'added', 'assist', 'external', 'band'] as const;
export const SESSION_LABELS = ['pull', 'push', 'legs', 'mixed', 'other'] as const;

function literals<T extends string>(values: readonly T[]) {
  return Type.Union(values.map((v) => Type.Literal(v)));
}

/**
 * Builds every schema. `strict: true` rejects unknown properties and is used for files at the
 * app's own version. `strict: false` ignores unknown properties and is used only to read a file
 * whose schemaVersion is newer than the app (spec §5, D9).
 */
export function buildModel(strict: boolean) {
  const obj = <P extends TProperties>(props: P) =>
    strict ? Type.Object(props, { additionalProperties: false }) : Type.Object(props);

  const DateString = Type.String({ pattern: DATE_PATTERN });
  const Timestamp = Type.String({ pattern: TIMESTAMP_PATTERN });
  const Uuid = Type.String({ pattern: UUID_PATTERN });
  const Text = Type.String({ minLength: 1 });
  const Positive = Type.Number({ exclusiveMinimum: 0 });
  const NonNegative = Type.Number({ minimum: 0 });
  const Version = Type.Integer({ minimum: 1 });

  const meta = { updatedAt: Timestamp, deletedAt: Type.Optional(Timestamp) };

  const Exercise = obj({
    ...meta,
    id: Type.String({ pattern: EXERCISE_ID_PATTERN }),
    name: Text,
    family: Type.Optional(Text),
    pattern: literals(PATTERNS),
    metric: literals(['reps', 'seconds'] as const),
    perSide: Type.Boolean(),
    defaultLoadType: literals(LOAD_TYPES),
    cues: Type.Optional(Text),
    archived: Type.Boolean(),
  });

  const BodyweightEntry = obj({
    ...meta,
    id: Uuid,
    date: DateString,
    kg: Positive,
    note: Type.Optional(Text),
  });

  const ExercisesFile = obj({ schemaVersion: Version, exercises: Type.Array(Exercise) });
  const BodyweightFile = obj({ schemaVersion: Version, entries: Type.Array(BodyweightEntry) });

  return { Exercise, BodyweightEntry, ExercisesFile, BodyweightFile };
}

export const Strict = buildModel(true);
export const Lenient = buildModel(false);
