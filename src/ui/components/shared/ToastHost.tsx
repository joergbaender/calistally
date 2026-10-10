import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { dismissToast, toast } from '../../toast';

/** Spec 4 §8: at most one toast; auto-dismisses after its ms; the action runs and dismisses. */
export function ToastHost(): JSX.Element {
  const t = toast.value;
  useEffect(() => {
    if (!t) return undefined;
    const id = setTimeout(dismissToast, t.ms);
    return () => clearTimeout(id);
  }, [t]);
  if (!t) return <></>;
  const action = t.action;
  return (
    <div class="toast" role="status">
      <span class="toast__text">{t.text}</span>
      {action && (
        <button type="button" class="toast__action" onClick={() => { dismissToast(); action.run(); }}>
          {action.label}
        </button>
      )}
    </div>
  );
}
