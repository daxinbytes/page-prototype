import { access, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const source = JSON.parse(await readFile(join(skillRoot, 'runtime-source.json'), 'utf8'));
export async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export function compareVersions(left, right) {
  if (![left, right].every((v) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v))) throw new Error('运行时版本必须为 x.y.z');
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}
export async function locateHome(requested) {
  const location = await readJson(join(skillRoot, 'tool-location.json'));
  const explicit = requested || process.env.PAGE_PROTOTYPE_HOME || process.env.BETA_PREVIEW_HOME || location?.home;
  if (explicit) return resolve(explicit);
  for (const name of ['.page-prototype', '.beta-preview']) {
    const candidate = join(homedir(), name);
    if (await readJson(join(candidate, 'installation.json'))) return candidate;
  }
  return join(homedir(), '.page-prototype');
}
export async function compatibleInstallation(installation) {
  if (!installation || installation.name !== 'page-prototype-runtime' || installation.apiVersion !== source.apiVersion) return false;
  if (compareVersions(installation.version, source.minimumVersion) < 0) return false;
  try {
    for (const path of [installation.tool, join(installation.extension, 'manifest.json')]) await access(path);
    return true;
  } catch { return false; }
}
