import type { JSX } from 'preact';
import { useApp } from '../../context';
import { BackBar } from '../shared';

/** Spec 4 §6 `#/more/catalog`: a stub until the catalog task replaces it. */
export function CatalogPage(): JSX.Element {
  const { router } = useApp();
  return (
    <div class="more-page">
      <BackBar title="Catalog" onBack={() => router.navigate({ tab: 'more' })} />
    </div>
  );
}
