import { access, cp, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// electron-builder may place sharp's native addon in a nested @img scope while
// hoisting libvips. The addon uses relative dyld/rpath paths, so both packages
// must be siblings on disk before signing. Keep the original package intact.
export default async function afterPack(context) {
  const resources =
    context.electronPlatformName === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : path.join(context.appOutDir, 'resources');
  const modules = path.join(resources, 'app.asar.unpacked', 'node_modules');
  const exists = (file) =>
    access(file).then(
      () => true,
      () => false,
    );
  const metadata = async (folder) =>
    JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8').catch(() => '{}'));
  async function findLibrary(name, version) {
    const queue = [path.join(context.packager.projectDir, 'node_modules')];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const folder = queue[cursor];
      const candidate = path.join(folder, '@img', name);
      if (
        (await exists(candidate)) &&
        (!version || (await metadata(candidate)).version === version)
      )
        return candidate;
      for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory()) continue;
        const module = path.join(folder, entry.name);
        if (entry.name.startsWith('@')) {
          for (const item of await readdir(module))
            queue.push(path.join(module, item, 'node_modules'));
        } else queue.push(path.join(module, 'node_modules'));
      }
    }
  }
  let restored = 0;
  async function visit(folder) {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const location = path.join(folder, entry.name);
      if (entry.name === '@img') {
        const packages = await readdir(location);
        for (const name of packages.filter(
          (name) => name.startsWith('sharp-') && !name.startsWith('sharp-libvips-'),
        )) {
          const library = name.replace('sharp-', 'sharp-libvips-');
          const target = path.join(location, library);
          const native = await metadata(path.join(location, name));
          const expected = native.optionalDependencies?.['@img/' + library];
          const present = await exists(target);
          if (present && (!expected || (await metadata(target)).version === expected)) continue;
          const source = await findLibrary(library, expected);
          if (source) {
            await cp(source, target, { recursive: true });
            restored++;
          } else if (expected)
            throw new Error(`Missing ${library}@${expected} required by ${name}`);
        }
      }
      if (entry.name.startsWith('@')) {
        for (const name of await readdir(location))
          await visit(path.join(location, name, 'node_modules'));
      } else await visit(path.join(location, 'node_modules'));
    }
  }
  await visit(modules);
  console.log(
    `Verified native image package layout; restored ${restored} sibling libvips package(s) before signing`,
  );
}
