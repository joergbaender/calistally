import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { EXIT, runMigration } from '../src/migration/cli';

const { values } = parseArgs({
  options: { xlsx: { type: 'string' }, decisions: { type: 'string' }, out: { type: 'string' } },
  strict: true,
});

if (values.xlsx === undefined || values.decisions === undefined || values.out === undefined) {
  console.error('usage: npm run migrate -- --xlsx <workbook.xlsx> --decisions <decisions.json> --out <directory outside the repo>');
  process.exitCode = EXIT.usage;
} else {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  runMigration({ xlsx: values.xlsx, decisions: values.decisions, out: values.out, repoRoot }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = EXIT.usage;
    },
  );
}
