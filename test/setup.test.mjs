import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.env.PAGE_PROTOTYPE_TEST_SOURCE;
const setup = (...args) => run(process.execPath, [join(root, 'scripts/setup.mjs'), ...args], { timeout: 240_000 });
async function temporary(t) { const path = await mkdtemp(join(tmpdir(), 'prototype-skill-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }

test('Skill installs runtime separately, reuses it offline, and preserves data across update', { skip: !source }, async (t) => {
  const parent = await temporary(t), home = join(parent, 'home');
  const first = JSON.parse((await setup('--home', home, '--source', source)).stdout);
  assert.equal(first.installed, true); assert.equal(first.apiVersion, 1);
  assert.equal(first.source.localSource, resolve(source));
  const versionRoot = resolve(first.tool, '../..');
  const release = JSON.parse(await readFile(join(versionRoot, 'release.json'), 'utf8'));
  assert.equal(Object.keys(release.files).some((name) => /SKILL\.md|^skills?\//.test(name)), false);
  const env = { ...process.env, PAGE_PROTOTYPE_HOME: home, BRIDGE_RUNTIME_DIR: first.runtime };
  const call = async (...args) => JSON.parse((await run(process.execPath, [join(root, 'scripts/tool.mjs'), ...args], { env })).stdout);
  assert.equal((await call('doctor')).extensionDirectory, first.extension);
  await call('init', '--name', '独立安装测试', '--url', 'http://127.0.0.1:17374/work', '--id', 'test-split');
  // 无需 Git、npm 或源码即可重复使用；故意传一个不存在的 source。
  const again = JSON.parse((await setup('--home', home, '--source', join(parent, 'absent'))).stdout);
  assert.equal(again.reused, true);
  await mkdir(join(first.runtime, 'captures'), { recursive: true });
  await writeFile(join(first.runtime, 'captures/saved-draft'), 'preserve me');
  await writeFile(join(first.runtime, 'token'), 'test-token');
  const updated = JSON.parse((await setup('--home', home, '--source', source, '--update')).stdout);
  assert.equal(updated.extension, first.extension);
  assert.equal(await readFile(join(first.runtime, 'captures/saved-draft'), 'utf8'), 'preserve me');
  assert.equal(await readFile(join(first.runtime, 'token'), 'utf8'), 'test-token');
  assert.ok((await readdir(join(first.runtime, 'projects'))).includes('test-split.json'));
  const server = createServer((request, response) => { response.end('{}'); });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  await writeFile(join(first.runtime, 'connection.json'), JSON.stringify({ port: server.address().port }));
  await assert.rejects(setup('--home', home, '--source', source, '--update'), /本地服务仍在运行/);
  assert.equal(await readFile(join(first.runtime, 'captures/saved-draft'), 'utf8'), 'preserve me');
});

test('incompatible source and old installations give an actionable failure before changing data', async (t) => {
  const parent = await temporary(t), home = join(parent, 'home'), candidate = join(parent, 'candidate');
  await mkdir(candidate); await writeFile(join(candidate, 'package.json'), '{"name":"another-tool"}');
  await assert.rejects(setup('--home', home, '--source', candidate), /不兼容/);
  await assert.rejects(readFile(join(home, 'installation.json')), { code: 'ENOENT' });
  await mkdir(home); await writeFile(join(home, 'installation.json'), '{"version":"0.6.0"}');
  await assert.rejects(setup('--home', home), /--update/);
  assert.deepEqual(JSON.parse(await readFile(join(home, 'installation.json'), 'utf8')), { version: '0.6.0' });
});
