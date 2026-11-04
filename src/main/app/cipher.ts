import { safeStorage } from 'electron';
import type { Cipher } from '../integrations/secrets.js';

/**
 * OS keychain encryption (macOS Keychain, Windows DPAPI, libsecret). Creating it touches nothing: the keychain is only
 * reached when a secret is actually written or read, because macOS asks the person to allow it on the first use.
 * If the system cannot encrypt, `encrypt` throws and the store falls back to an owner-only file.
 */
export function electronCipher(): Cipher {
  return {
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64')),
  };
}
