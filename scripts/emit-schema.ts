import { mkdirSync, writeFileSync } from 'node:fs';
import { SCHEMA_FILES, schemaDocument } from '../src/model/schema-files';

mkdirSync('schema', { recursive: true });
for (const [name, schema] of Object.entries(SCHEMA_FILES)) {
  const path = `schema/${name}.schema.json`;
  writeFileSync(path, `${JSON.stringify(schemaDocument(schema), null, 2)}\n`);
  console.log(`wrote ${path}`);
}
