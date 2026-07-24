import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Recommended IV length for AES-GCM

export class CryptoService {
  private key: Buffer;

  constructor(encryptionKeyHex: string) {
    if (!encryptionKeyHex || encryptionKeyHex.length !== 64) {
      throw new Error('Encryption key must be a 64-character hex string (32 bytes)');
    }
    this.key = Buffer.from(encryptionKeyHex, 'hex');
  }

  public encrypt(plainText: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);

    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  public decrypt(cipherTextWithMeta: string): string {
    const parts = cipherTextWithMeta.split(':');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error('Invalid ciphertext format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
