import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '../../../sync/engine';
import type { Issue, IssueReason } from '../../../sync/store';
import type { SoftIssue } from '../../data';
import { formatDayLong, formatTime, localDate } from '../../format';
import { block, session } from '../../../model/test-fixtures';
import { syncVm, type SyncVmInput, type UpdateState } from './sync.vm';

const STATUS: SyncStatus = { phase: 'idle', online: true, connected: true, queueLength: 0, heldBackCount: 0, issues: [], tooNewSeen: false, emptyFolder: false };
const COUNTS = { sessions: 0, exercises: 0, bodyweight: 0 };
const URL = 'https://www.dropbox.com/oauth2/authorize?client_id=k&response_type=code';

function input(over: Partial<SyncVmInput> = {}): SyncVmInput {
  return {
    status: STATUS, retryLeftMs: undefined, issues: [], softIssues: [], sessions: [], connected: true, loginError: undefined, homeScreenHint: false,
    pasteMode: false, pasteUrl: undefined, persisted: true, updateAvailable: false, updateState: 'idle', buildId: 'b1', counts: COUNTS, ...over,
  };
}

const status = (over: Partial<SyncStatus>): SyncStatus => ({ ...STATUS, ...over });

describe('syncVm connection', () => {
  it('not connected, nothing local', () => {
    expect(syncVm(input({ connected: false })).connection).toEqual({ kind: 'disconnected', hasLocal: false, hint: false, error: undefined, pasteMode: false, pasteUrl: undefined });
  });

  it('not connected with local data or a queue: connect again, data kept', () => {
    expect(syncVm(input({ connected: false, counts: { sessions: 3, exercises: 0, bodyweight: 0 } })).connection).toMatchObject({ kind: 'disconnected', hasLocal: true });
    expect(syncVm(input({ connected: false, status: status({ queueLength: 2 }) })).connection).toMatchObject({ kind: 'disconnected', hasLocal: true });
  });

  it('home-screen hint and login error', () => {
    expect(syncVm(input({ connected: false, homeScreenHint: true })).connection).toMatchObject({ hint: true });
    expect(syncVm(input({ connected: false, loginError: 'login failed' })).connection).toMatchObject({ error: 'login failed' });
  });

  it('shows the last sync error when there is no login error', () => {
    expect(syncVm(input({ connected: false, status: status({ lastError: 'expired' }) })).connection).toMatchObject({ error: 'Last error: expired' });
    expect(syncVm(input({ connected: false, loginError: 'bad code', status: status({ lastError: 'expired' }) })).connection).toMatchObject({ error: 'bad code' });
  });

  it('paste mode with and without url', () => {
    expect(syncVm(input({ connected: false, pasteMode: true })).connection).toMatchObject({ pasteMode: true, pasteUrl: undefined });
    expect(syncVm(input({ connected: false, pasteMode: true, pasteUrl: URL })).connection).toMatchObject({ pasteMode: true, pasteUrl: URL });
  });

  it('empty folder: connected, with the choice card until the owner chooses to copy', () => {
    const empty = syncVm(input({ status: status({ emptyFolder: true }) }));
    expect(empty.connection).toEqual({ kind: 'connected' });
    expect(empty.emptyFolder).toBe(true);
    const copying = syncVm(input({ status: status({ emptyFolder: true, emptyFolderChoice: 'copy' }) }));
    expect(copying.emptyFolder).toBe(false);
    expect(copying.emptyFolderNote).toBe(true);
    expect(syncVm(input({ connected: false, status: status({ emptyFolder: true }) })).emptyFolder).toBe(false);
  });

  it('connected', () => {
    expect(syncVm(input()).connection).toEqual({ kind: 'connected' });
    expect(syncVm(input()).emptyFolder).toBe(false);
  });

  it('Status only when connected; Issues and Data in every state', () => {
    expect(syncVm(input()).showStatus).toBe(true);
    const off = syncVm(input({ connected: false, issues: [{ path: 'p', reason: 'held-back', detail: 'd' }] }));
    expect(off.showStatus).toBe(false);
    expect(off.issues).toHaveLength(1);
  });
});

describe('syncVm update', () => {
  const cases: ReadonlyArray<readonly [UpdateState, string, boolean]> = [
    ['idle', 'Update app', false],
    ['updating', 'Updating…', true],
    ['retrying', 'Still syncing, trying again', true],
    ['failed', 'Could not update; try again after sync', false],
  ];
  it.each(cases)('%s → %s (disabled %s)', (state, label, disabled) => {
    const u = syncVm(input({ updateAvailable: true, updateState: state })).update;
    expect(u).toMatchObject({ show: true, label, disabled, tooNew: false });
    expect(u.note).toBe('A new version of the app is ready.');
  });

  it('is hidden without a waiting build; tooNew only then', () => {
    expect(syncVm(input()).update).toMatchObject({ show: false, tooNew: false, note: undefined });
    expect(syncVm(input({ status: status({ tooNewSeen: true }) })).update).toMatchObject({ show: false, tooNew: true });
    expect(syncVm(input({ status: status({ tooNewSeen: true }), updateAvailable: true })).update).toMatchObject({ show: true, tooNew: false });
  });
});

describe('syncVm status rows', () => {
  const rows = (s: Partial<SyncStatus>) => syncVm(input({ status: status(s) })).statusRows;
  const row = (s: Partial<SyncStatus>, label: string) => rows(s).find((r) => r.label === label);

  it('phase alone, with offline marker and the retry seconds left (counted down by Data, not the raw delay)', () => {
    expect(row({}, 'Phase')).toEqual({ label: 'Phase', value: 'idle' });
    expect(row({ phase: 'pulling', online: false }, 'Phase')).toEqual({ label: 'Phase', value: 'pulling · offline', error: true });
    const phase = (retryLeftMs: number | undefined, retryInMs: number) =>
      syncVm(input({ status: status({ retryInMs }), retryLeftMs })).statusRows.find((r) => r.label === 'Phase');
    expect(phase(4400, 10_000)).toEqual({ label: 'Phase', value: 'idle · retry in 4 s' });
    expect(phase(0, 10_000)).toEqual({ label: 'Phase', value: 'idle · retry in 0 s' });
    expect(phase(undefined, 10_000)).toEqual({ label: 'Phase', value: 'idle' });
  });

  it('last pull and push as local day and time, never when unknown', () => {
    expect(row({}, 'Last pull')).toEqual({ label: 'Last pull', value: 'never' });
    expect(row({}, 'Last push')).toEqual({ label: 'Last push', value: 'never' });
    const iso = '2030-03-04T11:05:00.000Z';
    const expected = `${formatDayLong(localDate(new Date(iso)))} ${formatTime(iso)}`;
    expect(row({ lastPullAt: iso }, 'Last pull')).toEqual({ label: 'Last pull', value: expected });
    expect(row({ lastPushAt: iso }, 'Last push')).toEqual({ label: 'Last push', value: expected });
  });

  it('queued with the held-back count', () => {
    expect(row({ queueLength: 2 }, 'Queued')).toEqual({ label: 'Queued', value: '2' });
    expect(row({ queueLength: 2, heldBackCount: 1 }, 'Queued')).toEqual({ label: 'Queued', value: '2 (1 held back)' });
  });

  it('error row only when there is one', () => {
    expect(row({}, 'Error')).toBeUndefined();
    expect(row({ lastError: 'boom' }, 'Error')).toEqual({ label: 'Error', value: 'boom', error: true });
    expect(rows({ lastError: 'boom' }).map((r) => r.label)).toEqual(['Phase', 'Last pull', 'Last push', 'Queued', 'Error']);
  });

  it('Sync now is disabled unless idle; the copy note shows while the folder stays empty', () => {
    expect(syncVm(input()).syncNowDisabled).toBe(false);
    expect(syncVm(input({ status: status({ phase: 'pushing' }) })).syncNowDisabled).toBe(true);
    expect(syncVm(input()).emptyFolderNote).toBe(false);
    expect(syncVm(input({ status: status({ emptyFolder: true, emptyFolderChoice: 'copy' }) })).emptyFolderNote).toBe(true);
  });
});

describe('syncVm issues', () => {
  const issue = (reason: IssueReason, detail = 'detail'): Issue => ({ path: `sessions/2030/2030-03-04-x.json`, reason, detail });
  const ADVICE: Record<IssueReason, string> = {
    'quarantined': "Fix the file in Dropbox or restore it from the desktop client's version history; the app never overwrites it.",
    'read-only': 'Written by a newer app; update this app.',
    'needs-update': 'Written by a newer app; update this app.',
    'held-back': 'Saved on this device, not uploaded; this is an app bug, the change uploads once it is fixed.',
    'duplicate': 'Remove the second file in Dropbox; the first one holds the merged content.',
    'remote-deleted': 'Removed from Dropbox; the local copy is kept and re-uploaded only if you change it.',
    'unexpected-file': 'Not a CalisTally file; ignored.',
    'push-error': 'Retried automatically on the next sync.',
  };

  it.each(Object.keys(ADVICE) as IssueReason[])('one card per %s with its advice', (reason) => {
    const cards = syncVm(input({ issues: [issue(reason, 'the detail')] })).issues;
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card).toMatchObject({ path: 'sessions/2030/2030-03-04-x.json', reason, detail: 'the detail', advice: ADVICE[reason] });
    expect(card?.title.length).toBeGreaterThan(0);
    expect(card?.sessionId).toBeUndefined();
  });

  it('hard issues come first, then one soft card per session with its session id', () => {
    const s = session([block([], { exerciseId: 'foo', order: 0 }), block([], { order: 1 }), block([], { exerciseId: 'plank', order: 2 })], { id: 'b1000000-0000-4000-8000-000000000001', date: '2030-03-04' });
    const soft: SoftIssue = {
      path: 'sessions/2030/2030-03-04-s.json', sessionId: s.id, date: '2030-03-04',
      issues: [
        { level: 'soft', path: '/session/blocks/0/exerciseId', message: 'unknown exercise foo' },
        { level: 'soft', path: '/session/blocks/2/sets/1/reps', message: 'plank is measured in seconds' },
      ],
    };
    const cards = syncVm(input({ issues: [issue('held-back')], softIssues: [soft], sessions: [s] })).issues;
    expect(cards.map((c) => c.reason)).toEqual(['held-back', 'soft']);
    expect(cards[1]).toMatchObject({ path: soft.path, sessionId: s.id, title: 'Unknown exercise, metric mismatch' });
    expect(cards[1]?.detail).toBe(`${formatDayLong('2030-03-04')} · block 1: unknown exercise foo · block 3: plank is measured in seconds`);
    expect(cards[1]?.advice).toBe('Nothing is blocked; open the session to fix the block.');
  });

  it('numbers a block by its canonical position on the session page, not by its index in the file', () => {
    // File order: plank (order 5), a deleted block (order 0), foo (order 1). The page shows foo, then plank.
    const s = session(
      [
        block([], { exerciseId: 'plank', order: 5 }),
        block([], { exerciseId: 'dips', order: 0, deletedAt: '2030-03-04T12:00:00.000Z' }),
        block([], { exerciseId: 'foo', order: 1 }),
      ],
      { id: 'b1000000-0000-4000-8000-000000000002', date: '2030-03-04' },
    );
    const soft: SoftIssue = {
      path: 'p', sessionId: s.id, date: '2030-03-04',
      issues: [
        { level: 'soft', path: '/session/blocks/0/sets/0/reps', message: 'plank is measured in seconds' },
        { level: 'soft', path: '/session/blocks/2/exerciseId', message: 'unknown exercise foo' },
      ],
    };
    const card = syncVm(input({ softIssues: [soft], sessions: [s] })).issues[0];
    expect(card?.detail).toBe(`${formatDayLong('2030-03-04')} · block 2: plank is measured in seconds · block 1: unknown exercise foo`);
  });

  it('leaves the block number out when the session is not at hand', () => {
    const soft: SoftIssue = { path: 'p', sessionId: 'gone', date: '2030-03-04', issues: [{ level: 'soft', path: '/session/blocks/0/exerciseId', message: 'unknown exercise foo' }] };
    expect(syncVm(input({ softIssues: [soft] })).issues[0]?.detail).toBe(`${formatDayLong('2030-03-04')} · unknown exercise foo`);
  });

  it('soft titles name the one kind when there is one', () => {
    const one = (message: string): SoftIssue => ({ path: 'p', sessionId: 's', date: '2030-03-04', issues: [{ level: 'soft', path: '/session/blocks/0/exerciseId', message }] });
    expect(syncVm(input({ softIssues: [one('unknown exercise foo')] })).issues[0]?.title).toBe('Unknown exercise');
    expect(syncVm(input({ softIssues: [one('plank is measured in seconds')] })).issues[0]?.title).toBe('Metric mismatch');
  });

  it('keys are unique across cards for the same path', () => {
    const cards = syncVm(input({ issues: [issue('duplicate'), issue('remote-deleted')] })).issues;
    expect(new Set(cards.map((c) => c.key)).size).toBe(2);
  });
});

describe('syncVm counts and footer', () => {
  it('passes the counts through', () => {
    expect(syncVm(input({ counts: { sessions: 3, exercises: 20, bodyweight: 5 } })).counts).toEqual({ sessions: 3, exercises: 20, bodyweight: 5 });
  });

  it('footer with persistent, not persistent, unknown', () => {
    expect(syncVm(input({ persisted: true })).footer).toBe('Build b1 · storage persistent');
    expect(syncVm(input({ persisted: false })).footer).toBe('Build b1 · storage not persistent');
    expect(syncVm(input({ persisted: undefined })).footer).toBe('Build b1 · storage unknown');
  });
});
