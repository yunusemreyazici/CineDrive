import { teardownE2EArtifacts } from './cleanup.js';

export default function globalTeardown() {
  teardownE2EArtifacts();
}
