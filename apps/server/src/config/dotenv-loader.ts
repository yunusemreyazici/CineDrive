import dotenv from 'dotenv';
import fs from 'fs';

export const loadDotenvFiles = (envPaths: readonly string[]): void => {
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, quiet: true });
    }
  }
};
