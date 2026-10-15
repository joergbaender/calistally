import type { NewExerciseFields } from '../../../model/catalog';
import type { Exercise } from '../../../model/types';

/**
 * Spec 1 §3: creating a name that exists never makes a second record; `createExercise` returns the
 * existing entry, revived when it was archived or deleted, and keeps its metric and per side, which
 * never change. Before that happens without a word, the create form asks (spec 4 §4 "Exercises",
 * §6 "Catalog"): always when the form's metric or per side differ from the entry's (the owner would
 * otherwise log hold times as reps), and with `askOnRevive` also before bringing back an archived or
 * deleted entry (the catalog's Create; the Log search revives a matching entry silently, spec 4
 * §4). Returns the sheet's line, or undefined when the entry can be used without asking.
 */
export function createClash(existing: Exercise, fields: NewExerciseFields, opts: { askOnRevive: boolean }): string | undefined {
  const deleted = existing.deletedAt !== undefined;
  const facts: string[] = [];
  if (deleted) facts.push('deleted');
  else if (existing.archived) facts.push('archived');
  const metricDiffers = existing.metric !== fields.metric;
  const perSideDiffers = existing.perSide !== fields.perSide;
  if (metricDiffers) facts.push(`measured in ${existing.metric}, not ${fields.metric}`);
  if (perSideDiffers) facts.push(existing.perSide ? 'per side' : 'not per side');
  if (metricDiffers || perSideDiffers) return `It is ${facts.join(', ')}. Use it as it is, or cancel and pick another name for the new one.`;
  if (opts.askOnRevive && facts.length > 0) return `It is ${facts.join(', ')}. Use it to bring it back.`;
  return undefined;
}
