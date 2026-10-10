import { cleanup } from '@testing-library/preact';
import { afterEach } from 'vitest';

/** Unmounts every rendered component after each test (component files under happy-dom); harmless in Node files. */
afterEach(() => cleanup());
