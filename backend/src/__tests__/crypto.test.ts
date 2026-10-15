import { beforeEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../utils/crypto.js';

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('crypto utilities', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  it('encrypts and decrypts text using AES-256-GCM', () => {
    const encrypted = encrypt('dado pessoal protegido');

    expect(encrypted.split(':')).toHaveLength(3);
    expect(decrypt(encrypted)).toBe('dado pessoal protegido');
  });

  it('rejects a missing or malformed encryption key', () => {
    process.env.ENCRYPTION_KEY = 'invalid-key';

    expect(() => encrypt('texto')).toThrow(/ENCRYPTION_KEY/);
  });

  it('rejects a malformed encrypted payload', () => {
    expect(() => decrypt('invalid-payload')).toThrow(/payload/i);
  });

  it('rejects an encrypted payload with a modified authentication tag', () => {
    const [iv, authTag, ciphertext] = encrypt('texto').split(':');
    const modifiedTag = `${authTag.slice(0, -2)}${authTag.slice(-2) === '00' ? 'ff' : '00'}`;

    expect(() => decrypt(`${iv}:${modifiedTag}:${ciphertext}`)).toThrow(/descriptografar|autenticar/i);
  });
});
