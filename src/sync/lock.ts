/** Which tab runs the engine (spec 3 §5): the holder of the Web Lock `calistally-sync`. */

export const SYNC_LOCK = 'calistally-sync';

export interface Leadership {
  /** Resolves once this tab holds the lock; the lock is kept until the tab closes. */
  whenLeader(): Promise<void>;
}

export class WebLocksLeadership implements Leadership {
  private leader: Promise<void> | undefined;

  whenLeader(): Promise<void> {
    if (this.leader === undefined) {
      this.leader = new Promise<void>((resolve) => {
        const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
        if (locks === undefined) {
          resolve(); // No Web Locks (very old browser): every tab syncs; the rev check still keeps data safe.
          return;
        }
        void locks.request(SYNC_LOCK, () => {
          resolve();
          return new Promise<never>(() => undefined); // held for the lifetime of the tab
        });
      });
    }
    return this.leader;
  }
}

/** Tests: leader at once, or when `grant()` is called. */
export class FakeLeadership implements Leadership {
  private resolve: (() => void) | undefined;
  private readonly promise: Promise<void>;

  constructor(immediate: boolean = true) {
    this.promise = new Promise<void>((resolve) => { this.resolve = resolve; });
    if (immediate) this.grant();
  }

  grant(): void {
    this.resolve?.();
  }

  whenLeader(): Promise<void> {
    return this.promise;
  }
}
