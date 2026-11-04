/** Host-level scanner findings as plain sentences (shared by the MCP server and logs). */
export function describeDiagnostic(code: string): string {
  const [id, name] = code.split(/:(.*)/s);
  switch (id) {
    case 'adb-missing':
      return 'ADB is unavailable: install Android Platform Tools and enable USB debugging.';
    case 'simctl-missing':
      return 'iOS simulators unavailable: install Xcode and its runtimes.';
    case 'developer-mode':
      return `${name}: enable Developer Mode on the iPhone.`;
    case 'ddi':
      return `${name}: iOS developer services unavailable. Open Xcode → Window → Devices and Simulators.`;
    case 'devicectl-failed':
      return 'USB iPhone: check Xcode, trust and Developer Mode.';
    default:
      return code;
  }
}
