import path from 'node:path';

/** Filled once by the bootstrap; keeps infra modules free of any `electron` import. */
export const paths = { appRoot: process.cwd(), userData: '', documents: '' };

/** node_modules location usable by child processes (never inside the read-only ASAR). */
export const nodeModules = () =>
  path.join(paths.appRoot, 'node_modules').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
