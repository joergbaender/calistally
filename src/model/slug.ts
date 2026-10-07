const TRANSLITERATE: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' };

/** Spec §3 slug rule: German transliteration, strip diacritics, lowercase, [^a-z0-9]+ -> "-",
 *  trim "-", empty -> "exercise". Collision suffixes are handled in catalog.ts. */
export function slugify(name: string): string {
  const slug = name
    .replace(/[äöüßÄÖÜ]/g, (c) => TRANSLITERATE[c] ?? c)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'exercise' : slug;
}

/** Name comparison key (spec §3 "Name uniqueness"): trimmed, whitespace collapsed, lowercased. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
