import { liveBlocks } from '../../../model/derive';
import type { Session } from '../../../model/types';
import type { SyncStatus } from '../../../sync/engine';
import type { Issue, IssueReason } from '../../../sync/store';
import type { SoftIssue } from '../../data';
import { formatDayLong, formatTime, localDate } from '../../format';

/** Spec 4 §7: the Sync tab's pure view model; replaces the shell of spec 3 §12 one to one and adds the soft issues. */

export type UpdateState = 'idle' | 'updating' | 'retrying' | 'failed';

export interface SyncVmInput {
  status: SyncStatus;
  /** `Data.retryLeftMs`: the engine's retry delay counted down against `now`. */
  retryLeftMs: number | undefined;
  issues: Issue[];
  softIssues: SoftIssue[];
  /** The sessions the soft issues name, to number their blocks as the session page shows them. */
  sessions: readonly Session[];
  connected: boolean;
  loginError: string | undefined;
  homeScreenHint: boolean;
  pasteMode: boolean;
  pasteUrl: string | undefined;
  persisted: boolean | undefined;
  updateAvailable: boolean;
  updateState: UpdateState;
  buildId: string;
  counts: { sessions: number; exercises: number; bodyweight: number };
}

export interface IssueCard {
  key: string;
  path: string;
  reason: IssueReason | 'soft';
  title: string;
  detail: string;
  advice: string;
  sessionId?: string;
}

export interface SyncVm {
  connection:
    | { kind: 'disconnected'; hasLocal: boolean; hint: boolean; error: string | undefined; pasteMode: boolean; pasteUrl: string | undefined }
    | { kind: 'connected' };
  /** Spec 3 §11: the first pull found no data files and the owner has not chosen yet. */
  emptyFolder: boolean;
  /** Spec 4 §7: Status only when connected; Issues and Data in every state, so the badge is always explained. */
  showStatus: boolean;
  update: { show: boolean; label: string; disabled: boolean; note: string | undefined; tooNew: boolean };
  statusRows: { label: string; value: string; error?: boolean }[];
  syncNowDisabled: boolean;
  emptyFolderNote: boolean;
  issues: IssueCard[];
  counts: { sessions: number; exercises: number; bodyweight: number };
  footer: string;
}

const UPDATE_LABEL: Record<UpdateState, string> = {
  idle: 'Update app',
  updating: 'Updating…',
  retrying: 'Still syncing, trying again',
  failed: 'Could not update; try again after sync',
};

const UPDATE_NOTE = 'A new version of the app is ready.';

/** Spec 4 §7's table: the title and the action that applies, per reason. */
const CARD_TEXT: Record<IssueReason, { title: string; advice: string }> = {
  'quarantined': { title: 'Quarantined', advice: "Fix the file in Dropbox or restore it from the desktop client's version history; the app never overwrites it." },
  'read-only': { title: 'Read-only', advice: 'Written by a newer app; update this app.' },
  'needs-update': { title: 'Needs a newer app', advice: 'Written by a newer app; update this app.' },
  'held-back': { title: 'Held back', advice: 'Saved on this device, not uploaded; this is an app bug, the change uploads once it is fixed.' },
  'duplicate': { title: 'Duplicate file', advice: 'Remove the second file in Dropbox; the first one holds the merged content.' },
  'remote-deleted': { title: 'Removed from Dropbox', advice: 'Removed from Dropbox; the local copy is kept and re-uploaded only if you change it.' },
  'unexpected-file': { title: 'Unexpected file', advice: 'Not a CalisTally file; ignored.' },
  'push-error': { title: 'Upload failed', advice: 'Retried automatically on the next sync.' },
};

// The session page does not flag blocks yet, so the advice does not claim it does.
const SOFT_ADVICE = 'Nothing is blocked; open the session to fix the block.';

function when(iso: string | undefined): string {
  if (iso === undefined) return 'never';
  return `${formatDayLong(localDate(new Date(iso)))} ${formatTime(iso)}`;
}

function phaseRow(s: SyncStatus, retryLeftMs: number | undefined): { label: string; value: string; error?: boolean } {
  let value: string = s.phase;
  if (!s.online) value += ' · offline';
  if (retryLeftMs !== undefined) value += ` · retry in ${Math.round(retryLeftMs / 1000)} s`;
  return s.online ? { label: 'Phase', value } : { label: 'Phase', value, error: true };
}

function statusRows(s: SyncStatus, retryLeftMs: number | undefined): SyncVm['statusRows'] {
  const rows: SyncVm['statusRows'] = [
    phaseRow(s, retryLeftMs),
    { label: 'Last pull', value: when(s.lastPullAt) },
    { label: 'Last push', value: when(s.lastPushAt) },
    { label: 'Queued', value: `${s.queueLength}${s.heldBackCount > 0 ? ` (${s.heldBackCount} held back)` : ''}` },
  ];
  if (s.lastError !== undefined) rows.push({ label: 'Error', value: s.lastError, error: true });
  return rows;
}

/**
 * 'block N: ' with N the block's 1-based position among the session's live blocks in canonical order,
 * as the session page lists them (the pointer's index is the file's array position, which carries no
 * meaning, spec 1 §3). Empty when the session or the block is not at hand.
 */
function blockNumber(pointer: string, session: Session | undefined): string {
  const m = /^\/session\/blocks\/(\d+)/.exec(pointer);
  if (m?.[1] === undefined || session === undefined) return '';
  const target = session.blocks[Number(m[1])];
  const position = target === undefined ? -1 : liveBlocks(session).indexOf(target);
  return position < 0 ? '' : `block ${position + 1}: `;
}

function softCard(soft: SoftIssue, session: Session | undefined): IssueCard {
  const unknown = soft.issues.some((i) => i.message.startsWith('unknown exercise'));
  const metric = soft.issues.some((i) => !i.message.startsWith('unknown exercise'));
  const kinds: string[] = [];
  if (unknown) kinds.push('Unknown exercise');
  if (metric) kinds.push(unknown ? 'metric mismatch' : 'Metric mismatch');
  return {
    key: `soft:${soft.path}`,
    path: soft.path,
    reason: 'soft',
    title: kinds.join(', '),
    detail: [formatDayLong(soft.date), ...soft.issues.map((i) => `${blockNumber(i.path, session)}${i.message}`)].join(' · '),
    advice: SOFT_ADVICE,
    sessionId: soft.sessionId,
  };
}

export function syncVm(input: SyncVmInput): SyncVm {
  const s = input.status;
  const c = input.counts;
  const hasLocal = s.queueLength > 0 || c.sessions > 0 || c.exercises > 0 || c.bodyweight > 0;

  let connection: SyncVm['connection'];
  if (!input.connected) {
    connection = {
      kind: 'disconnected',
      hasLocal,
      hint: input.homeScreenHint,
      error: input.loginError ?? (s.lastError !== undefined ? `Last error: ${s.lastError}` : undefined),
      pasteMode: input.pasteMode,
      pasteUrl: input.pasteUrl,
    };
  } else {
    connection = { kind: 'connected' };
  }

  const update: SyncVm['update'] = {
    show: input.updateAvailable,
    label: UPDATE_LABEL[input.updateState],
    disabled: input.updateState === 'updating' || input.updateState === 'retrying',
    note: input.updateAvailable ? UPDATE_NOTE : undefined,
    tooNew: !input.updateAvailable && s.tooNewSeen,
  };

  const hard: IssueCard[] = input.issues.map((i, n) => ({
    key: `${i.reason}:${i.path}:${n}`,
    path: i.path,
    reason: i.reason,
    title: CARD_TEXT[i.reason].title,
    detail: i.detail,
    advice: CARD_TEXT[i.reason].advice,
  }));

  const byId = new Map(input.sessions.map((x) => [x.id, x]));
  return {
    connection,
    emptyFolder: input.connected && s.emptyFolder && s.emptyFolderChoice !== 'copy',
    showStatus: input.connected,
    update,
    statusRows: statusRows(s, input.retryLeftMs),
    syncNowDisabled: s.phase !== 'idle',
    emptyFolderNote: s.emptyFolder && s.emptyFolderChoice === 'copy',
    issues: [...hard, ...input.softIssues.map((soft) => softCard(soft, byId.get(soft.sessionId)))],
    counts: { ...c },
    footer: `Build ${input.buildId} · storage ${input.persisted === undefined ? 'unknown' : input.persisted ? 'persistent' : 'not persistent'}`,
  };
}
