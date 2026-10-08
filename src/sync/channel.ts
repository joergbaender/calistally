/** Tells the other open tabs which path changed (spec 3 §5). */

export const CHANGE_CHANNEL = 'calistally';

export interface ChangeChannel {
  post(path: string): void;
  subscribe(listener: (path: string) => void): () => void;
}

export class BroadcastChangeChannel implements ChangeChannel {
  private readonly channel = new BroadcastChannel(CHANGE_CHANNEL);

  post(path: string): void {
    this.channel.postMessage({ path });
  }

  subscribe(listener: (path: string) => void): () => void {
    const handler = (event: MessageEvent<{ path: string }>) => listener(event.data.path);
    this.channel.addEventListener('message', handler);
    return () => this.channel.removeEventListener('message', handler);
  }
}

/** Tests and single-tab use: delivers to local subscribers only. */
export class LocalChangeChannel implements ChangeChannel {
  private readonly listeners = new Set<(path: string) => void>();
  readonly posted: string[] = [];

  post(path: string): void {
    this.posted.push(path);
    for (const l of this.listeners) l(path);
  }

  subscribe(listener: (path: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
