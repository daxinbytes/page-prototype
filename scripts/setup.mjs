#!/usr/bin/env node
import { mkdtemp, rm, mkdir, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { source, readJson, locateHome, compareVersions, compatibleInstallation } from './common.mjs';

const execute = promisify(execFile);
async function command(file, args, cwd) {
  try { return await execute(file, args, { cwd, timeout: 240_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true }); }
  catch (error) { throw new Error(`${file} 执行失败：${error.stderr?.trim() || error.message}`); }
}
async function main() {
  const options = {}, args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--update') options.update = true;
    else if (['--home', '--source'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) options[args[i].slice(2)] = args[++i];
    else throw new Error('用法：node scripts/setup.mjs [--update] [--home 数据目录] [--source 本地运行时源码目录]');
  }
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('运行时需要 Node.js 20 或更新版本');
  const home = await locateHome(options.home);
  const previous = await readJson(join(home, 'installation.json'));
  if (!options.update && await compatibleInstallation(previous)) {
    console.log(JSON.stringify({ installed: false, reused: true, home, ...previous }, null, 2)); return;
  }
  if (previous && !options.update) throw new Error('已有运行时需要更新或修复。先通过旧工具 end、stop，再运行本脚本并添加 --update；原资料与配对码会保留。');
  let temporary;
  try {
    let checkout, commit = null;
    if (options.source) checkout = resolve(options.source);
    else {
      console.error('正在获取页面原型运行时…');
      temporary = await mkdtemp(join(tmpdir(), 'page-prototype-setup-'));
      checkout = join(temporary, 'source');
      await command('git', ['clone', '--depth', '1', '--branch', source.ref, '--', source.repository, checkout]);
      commit = (await command('git', ['rev-parse', 'HEAD'], checkout)).stdout.trim();
    }
    const pkg = await readJson(join(checkout, 'package.json'));
    if (!pkg || pkg.name !== 'page-prototype-runtime' || pkg.pagePrototypeApiVersion !== source.apiVersion || compareVersions(pkg.version, source.minimumVersion) < 0) throw new Error('源码缺失或与此 Skill 不兼容，请检查 runtime-source.json 指向的仓库版本');
    if (previous && compareVersions(pkg.version, previous.version) < 0) throw new Error('获取的运行时比本地版本更旧，已停止降级');
    console.error('正在安装运行依赖…');
    // Windows 的 npm.cmd 需要命令解释器；这里只传固定命令，路径通过 cwd 传入。
    if (process.platform === 'win32') await command(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --omit=dev --ignore-scripts --no-audit --no-fund'], checkout);
    else await command('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], checkout);
    const result = await command(process.execPath, [join(checkout, 'install.mjs'), '--home', home, ...(options.update ? ['--update'] : [])], checkout);
    const installation = JSON.parse(result.stdout);
    const receipt = { repository: options.source ? null : source.repository, ref: options.source ? null : source.ref, commit,
      localSource: options.source ? checkout : null, version: installation.version, installedAt: new Date().toISOString() };
    await mkdir(home, { recursive: true, mode: 0o700 });
    const receiptPath = join(home, `.setup-${randomUUID()}.json`);
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    await rename(receiptPath, join(home, 'setup.json'));
    console.log(JSON.stringify({ ...installation, home, source: receipt }, null, 2));
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
