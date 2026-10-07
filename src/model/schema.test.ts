import { describe, expect, it } from 'vitest';
import { MODEL_VERSION } from './schema';

describe('model version', () => {
  it('starts at 1', () => {
    expect(MODEL_VERSION).toBe(1);
  });
});
