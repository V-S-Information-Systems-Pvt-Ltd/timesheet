// scripts/copy-standalone-assets.mjs
// Next.js standalone output does not automatically copy .next/static or public.
// When running the standalone server via `node .next/standalone/server.js`,
// static assets must be present in .next/standalone/.next/static.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standaloneDir = path.join(root, '.next', 'standalone');
const staticSrc = path.join(root, '.next', 'static');
const staticDest = path.join(standaloneDir, '.next', 'static');
const publicSrc = path.join(root, 'public');
const publicDest = path.join(standaloneDir, 'public');

if (fs.existsSync(standaloneDir)) {
  if (fs.existsSync(staticSrc)) {
    fs.mkdirSync(path.dirname(staticDest), { recursive: true });
    fs.cpSync(staticSrc, staticDest, { recursive: true, force: true });
  }
  if (fs.existsSync(publicSrc)) {
    fs.cpSync(publicSrc, publicDest, { recursive: true, force: true });
  }
}
