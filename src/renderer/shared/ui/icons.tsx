import type { OS } from '../../../shared/domain/scenario';

export const Logo = ({ size = 28 }: { size?: number }) => (
  <img src="./cybermonkey.svg" width={size} height={size} alt="" />
);
/** `plain`: the glyph takes the text colour instead of the brand colour (Android is green, which reads as « passed »). */
export function PlatformIcon({ os, size = 14, plain }: { os: OS; size?: number; plain?: boolean }) {
  return os === 'android' ? (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={plain ? 'currentColor' : 'var(--android)'}
      aria-label="Android"
    >
      <path d="M17.6 9.5a1 1 0 0 0 0-2l-.8-1.4 1.1-1.9a.5.5 0 0 0-.9-.5l-1.1 1.9A6 6 0 0 0 12 5a6 6 0 0 0-3.9.9L7 4a.5.5 0 0 0-.9.5l1.1 1.9-.8 1.4a1 1 0 0 0 0 2A6.5 6.5 0 0 0 5.5 14h13a6.5 6.5 0 0 0-.9-4.5ZM9.5 11a.8.8 0 1 1 0-1.600.8.8 0 0 1 0 1.600Zm5 0a.8.8 0 1 1 0-1.600.8.8 0 0 1 0 1.600ZM5.500 15v4a1.500 1.500 0 0 0 3 0v-4h-3Zm10 0v4a1.500 1.500 0 0 0 3 0v-4h-3Zm-6.500 0v5a1.500 1.500 0 0 0 1.500 1.500h.5V15H9Zm3.500 0v6.500h.5a1.500 1.500 0 0 0 1.500-1.500v-5h-2Z" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-label="iOS">
      <path d="M16.400 12.600c0-2.300 1.900-3.400 2-3.500-1.100-1.600-2.800-1.800-3.400-1.800-1.400-.1-2.800.9-3.500.9s-1.800-.8-3-.8C6.900 7.500 5.400 8.400 4.600 9.800 3 12.600 4.200 16.700 5.700 19c.8 1.100 1.700 2.300 2.900 2.300 1.100 0 1.600-.7 3-.7s1.800.7 3 .7 2-1.100 2.800-2.200c.9-1.300 1.200-2.500 1.300-2.600-.1 0-2.300-.9-2.300-3.600ZM14.100 5.800c.6-.8 1.100-1.900.9-3-.9 0-2.100.6-2.700 1.400-.6.700-1.100 1.800-1 2.900 1.100.1 2.100-.5 2.800-1.300Z" />
    </svg>
  );
}
export const osName = (os: OS) => (os === 'ios' ? 'iOS' : 'Android');
