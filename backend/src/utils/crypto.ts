import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;

  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('ENCRYPTION_KEY deve conter exatamente 64 caracteres hexadecimais.');
  }

  const keyBuffer = Buffer.from(key, 'hex');
  if (keyBuffer.length !== KEY_LENGTH_BYTES) {
    throw new Error('ENCRYPTION_KEY deve representar exatamente 32 bytes.');
  }

  return keyBuffer;
}

function decodeHex(value: string, name: string, expectedLength?: number): Buffer {
  if (!/^[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) {
    throw new Error(`Payload criptografado inválido: ${name} não é hexadecimal válido.`);
  }

  const decoded = Buffer.from(value, 'hex');
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error(`Payload criptografado inválido: ${name} possui tamanho inválido.`);
  }

  return decoded;
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

export function decrypt(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Payload criptografado inválido: formato esperado iv:authTag:ciphertext.');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = decodeHex(ivHex, 'IV', IV_LENGTH_BYTES);
  const authTag = decodeHex(authTagHex, 'Auth Tag', AUTH_TAG_LENGTH_BYTES);
  const encrypted = decodeHex(encryptedHex, 'texto cifrado');

  try {
    const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (error) {
    throw new Error('Falha ao descriptografar e autenticar o payload.', { cause: error });
  }
}
