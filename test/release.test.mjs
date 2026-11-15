import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.env.PAGE_PROTOTYPE_TEST_SOURCE;
const setup = async (home, ...args) => JSON.parse((await run(process.execPath, [join(root, 'scripts/setup.mjs'), '--home', home, ...args])).stdout);
test('doctor explains a fresh machine before a runtime exists', async t => {
  const home = await mkdtemp(join(tmpdir(), 'prototype-new-device-'));
  t.after(() => rm(home, { recursive:true, force:true }));
  const result = await run(process.execPath, [join(root,'scripts/tool.mjs'),'doctor'], { env:{ ...process.env, PAGE_PROTOTYPE_HOME:home } });
  assert.equal(JSON.parse(result.stdout).diagnosis.code,'not-installed');
});
test('offline distributions support upgrade, rollback and restart with the same data', { skip: !source }, async t => {
  const parent = await mkdtemp(join(tmpdir(), 'prototype-rollbacks-')), home = join(parent,'home');
  t.after(() => rm(parent,{recursive:true,force:true}));
  const { buildDistribution } = await import(pathToFileURL(join(source, 'lib/distribution.mjs')));
  const build = join(parent,'new-build'); await mkdir(build);
  await buildDistribution(source,build);
  const pkg = JSON.parse(await readFile(join(build,'package.json')));
  const old = join(parent,'old-source'); await cp(build,old,{recursive:true});
  await rm(join(old,'release.json'));
  for (const name of ['package.json','extension/manifest.json']) {
    const file=join(old,name), value=JSON.parse(await readFile(file)); value.version='0.8.2'; await writeFile(file,JSON.stringify(value));
  }
  const previousBuild=join(parent,'old-build'); await mkdir(previousBuild); await buildDistribution(old,previousBuild);
  const first = await setup(home,'--source',previousBuild);
  const runtime = first.runtime;
  const call = async (...args) => JSON.parse((await run(process.execPath,[join(root,'scripts/tool.mjs'),...args],{env:{...process.env,PAGE_PROTOTYPE_HOME:home}})).stdout);
  await call('init','--name','换机测试','--url','http://127.0.0.1/work','--id','preserve');
  await mkdir(join(runtime,'captures'),{recursive:true});
  await writeFile(join(runtime,'captures','scenario.json'),JSON.stringify({ id:'saved',draft:'蓝色' }));
  await writeFile(join(runtime,'token'),'t'.repeat(43));
  const updated = await setup(home,'--source',build,'--update');
  assert.equal(updated.version,pkg.version);
  await assert.rejects(setup(home,'--rollback','../escape'), /X.Y.Z/);
  const rollback = await setup(home,'--rollback','0.8.2');
  assert.equal(rollback.source.rolledBackFrom,pkg.version);
  assert.equal(JSON.parse(await readFile(join(first.extension,'manifest.json'))).version, '0.8.2');
  const again=await setup(home,'--update');
  assert.equal(again.version,pkg.version); assert.equal(again.extension,first.extension);
  const { createServer }=await import('node:net');
  const probe=createServer(); await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port; await new Promise(resolve=>probe.close(resolve));
  try {
    await call('start','--port',String(port));
    const result=await call('doctor');
    assert.equal(result.versions.service,pkg.version); assert.equal(result.diagnosis.code,'extension-disconnected');
  } finally { await call('stop').catch(()=>{}); }
  assert.deepEqual(JSON.parse(await readFile(join(runtime,'captures','scenario.json'))),{ id:'saved',draft:'蓝色' });
  assert.equal(await readFile(join(runtime,'token'),'utf8'),'t'.repeat(43));
  assert.equal(JSON.parse(await readFile(join(runtime,'projects','preserve.json'))).projectId,'preserve');
});
