import { teardownE2EDatabase } from './seed.js';

export default function globalTeardown() {
  teardownE2EDatabase();
}
