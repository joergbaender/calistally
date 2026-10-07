import type { BuildResult } from './build';
import type { ReportKind, ReviewItem } from './types';

const BLOCK_TITLES: Readonly<Record<string, string>> = {
  Pull: 'Pull (columns A–D)',
  Push: 'Push (columns F–J)',
  Legs: 'Legs (columns L–O)',
  Extra: 'Extra sessions (column J)',
  Other: 'Other cells (outside the column blocks)',
  '?': 'Decisions without a cell',
};

/** The ready-to-paste answer for one item (spec 2 §9). */
export function decisionSkeleton(item: ReviewItem): string {
  const k = JSON.stringify(item.key);
  const raw = JSON.stringify(item.raw);
  switch (item.kind) {
    case 'date-proposed':
    case 'date-unreadable':
    case 'date-out-of-order':
    case 'date-repaired-doubtful':
      return `${k}: { "date": "YYYY-MM-DD" }   or   ${k}: { "dateExact": true }   or   ${k}: { "accept": true }`;
    case 'unparsed-line':
    case 'unknown-exercise':
    case 'load-missing':
    case 'sets-exceed-reps':
    case 'parenthesised-numbers':
      return `${k}: { "text": ${raw} }   (rewrite the text)   or   ${k}: { "skip": true }`;
    case 'aggregate':
    case 'note-only':
    case 'pyramid-expanded':
      return `${k}: { "accept": true }   or   ${k}: { "text": ${raw} }`;
    case 'empty-row':
    case 'outside-blocks':
      return `${k}: { "accept": true }`;
    case 'stale-decision':
      return `remove the entry ${k} from decisions.json`;
  }
}

/** review.md: every open item with the cell, the raw text, what was done and how to answer. */
export function renderReview(items: readonly ReviewItem[]): string {
  const lines = ['# Migration review', ''];
  if (items.length === 0) {
    lines.push('0 open items. The output is final.', '');
    return lines.join('\n');
  }
  lines.push(`${items.length} open item${items.length === 1 ? '' : 's'}. Answer each with an entry in decisions.json under the key shown, then rerun.`, '');
  let block = '';
  for (const item of items) {
    if (item.block !== block) {
      block = item.block;
      lines.push(`## ${BLOCK_TITLES[block] ?? block}`, '');
    }
    lines.push(`### ${item.key} · ${item.kind} · row ${item.row}${item.date !== undefined ? ` · ${item.date}` : ''}`);
    lines.push(`- cell text: ${item.raw === '' ? '(empty)' : `\`${item.raw.replace(/\r?\n/g, ' | ')}\``}`);
    lines.push(`- problem: ${item.detail}`);
    lines.push(`- done for now: ${item.proposal}`);
    lines.push(`- answer: \`${decisionSkeleton(item)}\``, '');
  }
  return lines.join('\n');
}

export interface ReportMeta {
  final: boolean;
  xlsx: string;
  decisionCount: number;
}

const SECTIONS: readonly { title: string; kind: ReportKind }[] = [
  { title: 'Repairs', kind: 'repair' },
  { title: 'Accepted items', kind: 'accepted' },
  { title: 'Decisions (why)', kind: 'decision' },
  { title: 'Skipped cells', kind: 'skipped' },
  { title: 'Dropped phrases', kind: 'dropped' },
  { title: 'Unrecognised words kept as notes', kind: 'unrecognised' },
];

/** report.md: counts, repairs, decisions, dropped phrases, unrecognised words, catalog (spec 2 §9). */
export function renderReport(result: BuildResult, meta: ReportMeta): string {
  const lines = [
    `# Migration report — ${meta.final ? 'FINAL' : 'NOT FINAL'}`,
    '',
    `Source: ${meta.xlsx}. Decisions applied: ${meta.decisionCount}. ${result.review.length} open review item(s).`,
    '',
    '## Counts',
    '',
    '| what | count |',
    '|---|---|',
    `| sessions | ${result.sessions.length} |`,
  ];
  const byLabel = new Map<string, number>();
  for (const s of result.sessions) byLabel.set(s.label ?? 'none', (byLabel.get(s.label ?? 'none') ?? 0) + 1);
  for (const [label, n] of [...byLabel].sort()) lines.push(`| sessions labelled ${label} | ${n} |`);
  lines.push(`| blocks | ${result.sessions.reduce((n, s) => n + s.blocks.length, 0)} |`);
  lines.push(`| sets | ${result.sessions.reduce((n, s) => n + s.blocks.reduce((m, b) => m + b.sets.length, 0), 0)} |`);
  lines.push(`| sessions with dateUncertain | ${result.sessions.filter((s) => s.dateUncertain).length} |`);
  const byKind = new Map<string, number>();
  for (const i of result.review) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  for (const [kind, n] of [...byKind].sort()) lines.push(`| open: ${kind} | ${n} |`);
  lines.push('');
  for (const section of SECTIONS) {
    lines.push(`## ${section.title}`, '');
    const entries = result.report.filter((e) => e.kind === section.kind);
    if (entries.length === 0) lines.push('- none');
    for (const e of entries) lines.push(`- ${e.where}: ${e.detail}`);
    lines.push('');
  }
  lines.push('## Catalog', '', ...result.catalog.map((e) => `- ${e.id}`), '');
  return lines.join('\n');
}
