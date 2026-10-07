import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { EXIT, runMigration } from '../src/migration/cli';

const USAGE = 'usage: npm run migrate -- --xlsx <workbook.xlsx> --decisions <decisions.json> --out <directory outside the repo>';

let values: { xlsx?: string; decisions?: string; out?: string } | undefined;
try {
  values = parseArgs({
    options: { xlsx: { type: 'string' }, decisions: { type: 'string' }, out: { type: 'string' } },
    strict: true,
  }).values;
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  console.error(USAGE);
  process.exitCode = EXIT.usage;
}

if (values === undefined) {
  // parseArgs failed; the message and usage are printed above.
} else if (values.xlsx === undefined || values.decisions === undefined || values.out === undefined) {
  console.error(USAGE);
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
