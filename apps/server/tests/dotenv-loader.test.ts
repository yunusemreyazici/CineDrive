import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDotenvFiles } from '../src/config/dotenv-loader';

const TEST_EXISTING_KEY = 'CINEDRIVE_DOTENV_EXISTING';
const TEST_LOADED_KEY = 'CINEDRIVE_DOTENV_LOADED';

describe('loadDotenvFiles', () => {
  const originalExisting = process.env[TEST_EXISTING_KEY];
  const originalLoaded = process.env[TEST_LOADED_KEY];

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalExisting === undefined) delete process.env[TEST_EXISTING_KEY];
    else process.env[TEST_EXISTING_KEY] = originalExisting;

    if (originalLoaded === undefined) delete process.env[TEST_LOADED_KEY];
    else process.env[TEST_LOADED_KEY] = originalLoaded;
  });

  it('preserves existing values, loads files in order, and stays quiet', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cinedrive-dotenv-'));
    const firstPath = path.join(directory, '.env.first');
    const secondPath = path.join(directory, '.env.second');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      fs.writeFileSync(
        firstPath,
        `${TEST_EXISTING_KEY}=first-file\n${TEST_LOADED_KEY}=first-file\n`,
      );
      fs.writeFileSync(
        secondPath,
        `${TEST_EXISTING_KEY}=second-file\n${TEST_LOADED_KEY}=second-file\n`,
      );
      process.env[TEST_EXISTING_KEY] = 'process-value';
      delete process.env[TEST_LOADED_KEY];

      loadDotenvFiles([firstPath, secondPath]);

      expect(process.env[TEST_EXISTING_KEY]).toBe('process-value');
      expect(process.env[TEST_LOADED_KEY]).toBe('first-file');
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
