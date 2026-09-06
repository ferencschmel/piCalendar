// tsc only emits JS; the .sql migration files have to be carried into dist/
// alongside it so `npm start` can run them on a fresh install.
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'src', 'db', 'migrations');
const to = path.join(root, 'dist', 'db', 'migrations');

await mkdir(path.dirname(to), { recursive: true });
await cp(from, to, { recursive: true });
console.log(`copied migrations -> ${path.relative(root, to)}`);
