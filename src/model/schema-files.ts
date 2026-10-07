import type { TSchema } from '@sinclair/typebox';
import { Strict } from './schema';

/** The three file formats, by the name of their emitted schema file (schema/<name>.schema.json). */
export const SCHEMA_FILES = {
  'exercises-file': Strict.ExercisesFile,
  'bodyweight-file': Strict.BodyweightFile,
  'session-file': Strict.SessionFile,
} as const;

/** The JSON Schema document for a TypeBox schema: the schema itself (JSON round trip drops
 *  TypeBox's symbol keys) with a draft declaration in front. */
export function schemaDocument(schema: TSchema): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    ...(JSON.parse(JSON.stringify(schema)) as Record<string, unknown>),
  };
}
