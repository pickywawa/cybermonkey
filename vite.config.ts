import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version,
    ),
  },
  base: './',
  build: { outDir: '../../dist', emptyOutDir: true },
  server: { port: 5273, strictPort: true, host: '127.0.0.1' },
});
