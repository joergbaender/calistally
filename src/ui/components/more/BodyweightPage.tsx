import type { JSX } from 'preact';
import { useApp } from '../../context';
import { BackBar } from '../shared';

/** Spec 4 §6 `#/more/bodyweight`: a stub until the bodyweight task replaces it. */
export function BodyweightPage(): JSX.Element {
  const { router } = useApp();
  return (
    <div class="more-page">
      <BackBar title="Bodyweight" onBack={() => router.navigate({ tab: 'more' })} />
    </div>
  );
}
