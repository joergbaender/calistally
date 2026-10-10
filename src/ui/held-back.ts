/** Spec 4 §9: the "Saved here, not uploaded (app bug)" toast shows once per path per app run. */
const noted = new Set<string>();

/** True the first time a path is held back; false after. */
export function noteHeldBack(path: string): boolean {
  if (noted.has(path)) return false;
  noted.add(path);
  return true;
}
