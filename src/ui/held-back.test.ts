import { describe, expect, it } from 'vitest';
import { noteHeldBack } from './held-back';

describe('noteHeldBack', () => {
  it('is true the first time per path, false after, independent per path', () => {
    expect(noteHeldBack('sessions/2030/2030-03-04-a.json')).toBe(true);
    expect(noteHeldBack('sessions/2030/2030-03-04-a.json')).toBe(false);
    expect(noteHeldBack('sessions/2030/2030-03-05-b.json')).toBe(true);
  });
});
