import { describe, it, expect } from 'vitest';
import { CryptoService } from '../src/services/crypto.service';

describe('CryptoService', () => {
  const validKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const cryptoService = new CryptoService(validKeyHex);

  it('should encrypt and decrypt string successfully', () => {
    const plainText = 'google-refresh-token-secret-12345';
    const encrypted = cryptoService.encrypt(plainText);
    expect(encrypted).not.toEqual(plainText);
    expect(encrypted.split(':').length).toBe(3);

    const decrypted = cryptoService.decrypt(encrypted);
    expect(decrypted).toEqual(plainText);
  });

  it('should throw error for invalid key length', () => {
    expect(() => new CryptoService('short-key')).toThrow('Encryption key must be a 64-character hex string');
  });

  it('should throw error for tampered ciphertext', () => {
    const encrypted = cryptoService.encrypt('secret');
    const parts = encrypted.split(':');
    const tampered = `${parts[0]}:${parts[1]}:badhexcontent`;

    expect(() => cryptoService.decrypt(tampered)).toThrow();
  });
});
