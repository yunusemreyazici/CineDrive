import path from 'path';
import { fileURLToPath } from 'url';
import { envSchema, type EnvConfig } from '@cinedrive/shared';
import { loadDotenvFiles } from './dotenv-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../../../.env'),
];

loadDotenvFiles(envPaths);

const parseEnv = (): EnvConfig => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.format());
    throw new Error('Environment variable validation failed');
  }

  const parsed = result.data;

  // Strict production secrets validation
  if (parsed.NODE_ENV === 'production') {
    const placeholders = [
      'your-32-byte-hex-session-secret-key-goes-here',
      'your-google-client-id.apps.googleusercontent.com',
      'your-google-client-secret',
      'your-google-drive-root-folder-id',
      'admin@example.com',
      'YourStrongAdminPassword123!',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    ];
    if (
      placeholders.some((placeholder) =>
        [
          parsed.SESSION_SECRET,
          parsed.TOKEN_ENCRYPTION_KEY,
          parsed.GOOGLE_CLIENT_ID,
          parsed.GOOGLE_CLIENT_SECRET,
          parsed.GOOGLE_DRIVE_ROOT_FOLDER_ID,
          parsed.ADMIN_EMAIL,
          parsed.ADMIN_PASSWORD,
        ].includes(placeholder),
      )
    ) {
      throw new Error('FATAL: Example credentials cannot be used in production environment!');
    }
  }

  return parsed;
};

export const env = parseEnv();
