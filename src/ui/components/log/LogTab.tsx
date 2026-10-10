import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { useApp } from '../../context';
import type { SessionRow } from '../../data';
import { logScreenVm, resolveReference } from './log-screen.vm';
import { currentBlockId, referenceId, referenceLoadedFor } from './log-state';
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

  // Load the reference choice whenever the open session changes. Until `referenceLoadedFor`
  // names this session nothing is rendered, so the proposal never flashes in before the stored
  // choice (a missing choice re-proposes, §4). A remount for the same session (a tab switch)
  // keeps the choice already read and renders at once.
  useEffect(() => {
    if (referenceLoadedFor.value === id) return;
    let live = true;
    referenceId.value = undefined;
    void data.getMeta<string>(`reference:${id}`).then(
      (v) => {
        if (!live) return;
        referenceId.value = v;
        referenceLoadedFor.value = id;
      },
      () => {
        if (live) referenceLoadedFor.value = id;
      },
    );
    return () => {
      live = false;
    };
  }, [data, id]);

  if (referenceLoadedFor.value !== id) return <section class="log" aria-busy="true" />;

  const reference = resolveReference(referenceId.value, data.liveSessions.value, data.exercises.value, id);
  const vm = logScreenVm({
    today,
    reference,
    catalog: data.exerciseById.value,
    currentBlockId: currentBlockId.value,
    now: data.now.value,
    online: data.status.value.online,
  });
  return <LogScreen row={p.row} vm={vm} />;
}
