import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCHEMA_FILES, schemaDocument } from './schema-files';

describe('emitted JSON Schema files', () => {
  it.each(Object.keys(SCHEMA_FILES))('schema/%s.schema.json matches the schema definition', (name) => {
    const onDisk = JSON.parse(readFileSync(`schema/${name}.schema.json`, 'utf8'));
    const expected = schemaDocument(SCHEMA_FILES[name as keyof typeof SCHEMA_FILES]);
    // If this fails, run `npm run emit-schema` and commit the result.
    expect(onDisk).toEqual(expected);
  });

  it('declares draft-07 and forbids unknown properties at the top level', () => {
    const doc = schemaDocument(SCHEMA_FILES['session-file']) as { $schema: string; additionalProperties: boolean };
    expect(doc.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(doc.additionalProperties).toBe(false);
  });
});
