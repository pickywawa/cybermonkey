import { safeStorage } from 'electron';
import type { Cipher } from '../integrations/secrets.js';

/** OS keychain encryption (macOS Keychain, Windows DPAPI, libsecret) when the system offers it. */
export async function electronCipher(): Promise<Cipher | undefined> {
  try {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return undefined;
  } catch {
    return undefined;
  }
  return {
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher, 'base64')),
  };
}
