// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIn, setup } from '../../test-harness';
import { currentTheme } from '../../theme';
import { toast } from '../../toast';
import { MoreTab } from './MoreTab';

const NOW = new Date('2030-03-05T10:00:00.000Z');

beforeEach(() => {
  currentTheme.value = 'slate';
  document.documentElement.dataset.theme = 'slate';
});
afterEach(() => {
  currentTheme.value = 'slate';
  delete document.documentElement.dataset.theme;
  toast.value = undefined;
  vi.restoreAllMocks();
});

async function mount(hash: '#/more' | '#/more/theme') {
  const m = await setup({ now: NOW, sessions: [] });
  m.deps.router.navigate(hash === '#/more' ? { tab: 'more' } : { tab: 'more', page: 'theme' });
  renderIn(m.deps, <MoreTab />);
  return m;
}

const radio = (name: RegExp): HTMLElement => screen.getByRole('radio', { name });

describe('More menu (spec 5 §6)', () => {
  it('shows the fifth line with the current theme and opens the Theme page', async () => {
    currentTheme.value = 'dune';
    const { deps } = await mount('#/more');
    const line = screen.getByRole('button', { name: 'Theme, Dune' });
    expect(line.textContent).toBe('ThemeDune');
    fireEvent.click(line);
    expect(deps.router.route.value).toEqual({ tab: 'more', page: 'theme' });
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy());
  });
});

describe('ThemePage (spec 5 §6)', () => {
  it('lists the five themes, each painted in its own theme, with the current one checked', async () => {
    await mount('#/more/theme');
    const rows = screen.getAllByRole('radio');
    expect(rows.map((r) => r.dataset.theme)).toEqual(['slate', 'daylight', 'berry', 'ultraviolet', 'dune']);
    expect(rows.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(rows[0]?.textContent).toContain('dark · default');
    expect(rows[4]?.textContent).toContain('light');
  });

  it('a tap applies the theme at once, moves the tick and stores it in meta', async () => {
    const { store } = await mount('#/more/theme');
    fireEvent.click(radio(/Dune/));
    expect(document.documentElement.dataset.theme).toBe('dune');
    expect(currentTheme.value).toBe('dune');
    await waitFor(() => expect(radio(/Dune/).getAttribute('aria-checked')).toBe('true'));
    expect(radio(/Slate & Amber/).getAttribute('aria-checked')).toBe('false');
    await waitFor(async () => expect(await store.getMeta('theme')).toBe('dune'));
  });

  it('a tap on the current theme writes nothing', async () => {
    const { data } = await mount('#/more/theme');
    const setMeta = vi.spyOn(data, 'setMeta');
    fireEvent.click(radio(/Slate & Amber/));
    expect(setMeta).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe('slate');
  });

  it('a second tap while the write is in flight is ignored', async () => {
    const { data, store } = await mount('#/more/theme');
    let release!: () => void;
    const setMeta = vi.spyOn(data, 'setMeta').mockImplementation((key, value) =>
      new Promise<void>((resolve) => { release = () => { void store.setMeta(key, value).then(resolve); }; }));
    fireEvent.click(radio(/Dune/));
    fireEvent.click(radio(/Berry Night/));
    expect(setMeta).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.theme).toBe('dune');
    release();
    await waitFor(async () => expect(await store.getMeta('theme')).toBe('dune'));
    await waitFor(() => expect((radio(/Berry Night/) as HTMLButtonElement).disabled).toBe(false));
  });

  it('a failed meta write keeps the theme for this run and says so', async () => {
    const { data } = await mount('#/more/theme');
    vi.spyOn(data, 'setMeta').mockRejectedValue(new Error('idb'));
    fireEvent.click(radio(/Ultraviolet/));
    expect(document.documentElement.dataset.theme).toBe('ultraviolet');
    await waitFor(() => expect(toast.value?.text).toBe('Theme not saved on this device'));
    expect(currentTheme.value).toBe('ultraviolet');
  });

  it('Back goes to the More menu', async () => {
    const { deps } = await mount('#/more/theme');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(deps.router.route.value).toEqual({ tab: 'more' });
  });
});
