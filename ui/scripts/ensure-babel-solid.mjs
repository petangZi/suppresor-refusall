import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const version = '1.9.12';
const target = join(here, '..', 'node_modules', 'babel-preset-solid');
const marker = join(target, 'index.js');

if (!existsSync(marker)) {
  const work = mkdtempSync(join(tmpdir(), 'babel-solid-'));
  const tarball = join(work, 'package.tgz');
  const url = `https://registry.npmjs.org/babel-preset-solid/-/babel-preset-solid-${version}.tgz`;

  console.log(`[ensure-babel-solid] repairing babel-preset-solid@${version}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));

  mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', target, '--strip-components=1']);
  rmSync(work, { recursive: true, force: true });

  if (!existsSync(marker)) throw new Error('babel-preset-solid repair failed');
  console.log('[ensure-babel-solid] repaired');
}
