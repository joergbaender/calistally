/** Spec 2 §9: the kinds of review item. */
export type ReviewKind =
  | 'date-proposed'
  | 'date-repaired-doubtful'
  | 'date-unreadable'
  | 'date-out-of-order'
  | 'empty-row'
  | 'unparsed-line'
  | 'unknown-exercise'
  | 'load-missing'
  | 'sets-exceed-reps'
  | 'parenthesised-numbers'
  | 'aggregate'
  | 'note-only'
  | 'pyramid-expanded'
  | 'stale-decision';

export interface ReviewItem {
  kind: ReviewKind;
  /** The decision key that answers it: a cell address (`G9`) or address#line (`M27#3`). */
  key: string;
  /** `Pull`, `Push`, `Legs`, `Extra`, or `?` for a decision without a cell. */
  block: string;
  row: number;
  date: string | undefined;
  /** The cell text (or line) the item is about; empty for an undated row. */
  raw: string;
  /** What the script did meanwhile. */
  proposal: string;
  detail: string;
}

export type ReportKind = 'repair' | 'dropped' | 'decision' | 'unrecognised' | 'skipped' | 'accepted';

export interface ReportEntry {
  kind: ReportKind;
  /** Cell address or decision key. */
  where: string;
  detail: string;
}
