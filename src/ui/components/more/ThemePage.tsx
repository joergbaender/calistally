import type { JSX } from 'preact';
import { useApp } from '../../context';
import { applyTheme, currentTheme, THEME_META_KEY, type ThemeId } from '../../theme';
import { showToast } from '../../toast';
import { BackBar, useBusy } from '../shared';
import { themeRows } from './theme.vm';

/**
 * Spec 5 §6: the five themes as a radio group, each row painted in its own theme (`data-theme`).
 * A tap applies at once, then stores the choice in meta; a failed write keeps the theme for this run.
 */
export function ThemePage(): JSX.Element {
  const { data, router } = useApp();
  const { busy, run } = useBusy();
  const rows = themeRows(currentTheme.value);

  const choose = (id: ThemeId): void => {
    if (id === currentTheme.value) return;
    void run(async () => {
      applyTheme(id);
      currentTheme.value = id;
      try {
        await data.setMeta(THEME_META_KEY, id);
      } catch {
        showToast('Theme not saved on this device');
      }
    });
  };

  return (
    <section class="more-page">
      <BackBar title="Theme" onBack={() => router.navigate({ tab: 'more' })} />
      <div class="theme-list" role="radiogroup" aria-label="Theme">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={r.current}
            data-theme={r.id}
            class={`theme-row${r.current ? ' is-current' : ''}`}
            disabled={busy.value}
            onClick={() => choose(r.id)}
          >
            <span class="theme-row__swatches" aria-hidden="true">
              <span class="theme-row__swatch theme-row__swatch--bg" />
              <span class="theme-row__swatch theme-row__swatch--panel-2" />
              <span class="theme-row__swatch theme-row__swatch--accent" />
            </span>
            <span class="theme-row__text">
              <span class="theme-row__name">{r.name}</span>
              <span class="theme-row__kind">{r.kind}</span>
            </span>
            {r.current && <span class="theme-row__tick" aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
