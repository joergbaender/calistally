import { createContext, type Context } from 'preact';
import { useContext } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import type { EmptyFolderChoice } from '../sync/engine';
import type { Data } from './data';
import type { Router } from './router';

/** The shell's actions (spec 3 §12) plus the Update states (spec 4 §7). */
export interface SyncActions {
  connect(): void;
  startPaste(): void;
  submitCode(code: string): void;
  syncNow(): void;
  chooseEmptyFolder(choice: EmptyFolderChoice): void;
  updateApp(): Promise<'reloading' | 'busy'>;
  signOut(): void;
}

/** The pieces of ShellModel that are not in Data. */
export interface UiState {
  connected: Signal<boolean>;
  loginError: Signal<string | undefined>;
  homeScreenHint: boolean;
  pasteMode: Signal<boolean>;
  pasteUrl: Signal<string | undefined>;
  persisted: Signal<boolean | undefined>;
  updateAvailable: Signal<boolean>;
  buildId: string;
}

export interface AppDeps { data: Data; router: Router; sync: SyncActions; ui: UiState }

export const AppContext: Context<AppDeps | null> = createContext<AppDeps | null>(null);

/** Throws outside the provider: every screen is rendered under `<AppContext.Provider>`. */
export function useApp(): AppDeps {
  const deps = useContext(AppContext);
  if (deps === null) throw new Error('useApp() called outside AppContext.Provider');
  return deps;
}
