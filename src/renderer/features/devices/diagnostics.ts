import type { Key } from '../../shared/i18n';

/** Host-level findings emitted by the device scanner → i18n message + optional documentation. */
export function describeDiagnostic(code: string): {
  key: Key;
  name?: string;
  doc?: 'adb' | 'xcode' | 'provisioning';
} {
  const [id, name] = code.split(/:(.*)/s);
  switch (id) {
    case 'adb-missing':
      return { key: 'dev.diag.adb', doc: 'adb' };
    case 'simctl-missing':
      return { key: 'dev.diag.simctl', doc: 'xcode' };
    case 'developer-mode':
      return { key: 'dev.diag.developerMode', name };
    case 'ddi':
      return { key: 'dev.diag.ddi', name };
    case 'devicectl-failed':
      return { key: 'dev.diag.devicectl', doc: 'xcode' };
    default:
      return { key: 'dev.diag.unknown', name: code };
  }
}
