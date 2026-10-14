import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { EntryArea } from './EntryArea';
import { logScreenVm, readRestStop, resolveReference } from './log-screen.vm';
import { currentBlockId, referenceId, referenceLoadedFor, restStop } from './log-state';
import { LogScreen } from './LogScreen';
import { StartPicker } from './StartPicker';

/** Spec 4 §4: the start picker without an open session, else the open session (Resume). */
export function LogTab(): JSX.Element {
  const { data } = useApp();
  const row = data.openSession.value;
  return row === undefined ? <StartPicker /> : <OpenSession row={row} />;
}

function OpenSession(p: { row: SessionRow }): JSX.Element {
  const { data } = useApp();
  const today = p.row.file.session;
  const id = today.id;

  // Load the reference choice and the rest stop whenever the open session changes. Until
  // `referenceLoadedFor` names this session nothing is rendered, so the proposal never flashes in
  // before the stored choice (a missing choice re-proposes, §4) and a stopped counter never shows
  // running. A remount for the same session (a tab switch) keeps both and renders at once. A failed
  // read counts as missing.
  useEffect(() => {
    if (referenceLoadedFor.value === id) return;
    let live = true;
    referenceId.value = undefined;
    restStop.value = undefined;
    const read = <T,>(key: string): Promise<T | undefined> => data.getMeta<T>(key).catch(() => undefined);
    void Promise.all([read<string>(`reference:${id}`), read<unknown>(`restStop:${id}`)])
      .then(([reference, stored]) => {
        if (!live) return;
        referenceId.value = reference;
        // A resume stores undefined under the key (the meta store has no delete), and a value of the
        // wrong shape is no stop either: both read as running.
        const stop = readRestStop(stored);
        restStop.value = stop === undefined ? undefined : { sessionId: id, ...stop };
      })
      // Whatever went wrong above, the session must still show: no stored choice, no stop.
      .catch(() => {})
      .finally(() => {
        if (live) referenceLoadedFor.value = id;
      });
    return () => {
      live = false;
    };
  }, [data, id]);

  if (referenceLoadedFor.value !== id) return <section class="log" aria-busy="true" />;

  const reference = resolveReference(referenceId.value, data.liveSessions.value, data.exercises.value, id);
  const stop = restStop.value;
  const vm = logScreenVm({
    today,
    reference,
    catalog: data.exerciseById.value,
    currentBlockId: currentBlockId.value,
    now: data.now.value,
    online: data.status.value.online,
    restStop: stop?.sessionId === id ? stop : undefined,
  });
  return (
    <>
      <LogScreen row={p.row} vm={vm} reference={reference} />
      {vm.current !== undefined && <EntryArea row={p.row} current={vm.current} />}
    </>
  );
}
