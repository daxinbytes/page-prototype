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

const versionPattern = /^\d+\.\d+\.\d+$/;
const tagPattern = /^v\d+\.\d+\.\d+$/;

// The configured release may still be local. Only an authoritative "no such
// tag" response permits the documented bootstrap commit; network errors do not.
async function defaultRef() {
  if (!source.bootstrapCommit || !tagPattern.test(source.ref)) return source.ref;
  try {
    await execute('git', ['ls-remote', '--exit-code', '--refs', '--tags', '--', source.repository, 'refs/tags/' + source.ref],
      { timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    return source.ref;
  } catch (error) {
    if (error.code !== 2) throw new Error('无法检查发布标签，请核对 Git 和仓库连接：' + (error.stderr?.trim() || error.message));
    console.error(source.ref + ' 尚未发布。将使用已公开的固定提交 ' + source.bootstrapCommit + '；体验新版可用 --source 指定发行包目录。');
    return source.bootstrapCommit;
  }
}
async function fetchRelease(directory, ref) {
  const tag = tagPattern.test(ref);
  if (!tag && !/^[a-f0-9]{40}$/.test(ref)) throw new Error('安装来源须为固定的 vX.Y.Z 标签或完整提交号');
  await command('git', ['init', '--quiet'], directory);
  const revision = tag ? 'refs/tags/' + ref : ref;
  try { await command('git', ['fetch', '--quiet', '--depth', '1', '--no-tags', '--', source.repository, revision], directory); }
  catch (error) { throw new Error(`无法获取固定版本 ${ref}。请核对网络以及该版本是否已发布。\n${error.message}`); }
  await command('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], directory);
  const commit = (await command('git', ['rev-parse', 'HEAD'], directory)).stdout.trim();
  if (!tag && commit !== ref) throw new Error('下载的提交与固定版本不同');
  return commit;
}
async function main() {
  const options = {}, args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--update') options.update = true;
    else if (['--home', '--source', '--tag', '--rollback'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) options[args[i].slice(2)] = args[++i];
    else throw new Error('用法：node scripts/setup.mjs [--home 目录] [--update] [--source 目录 | --tag vX.Y.Z | --rollback X.Y.Z]');
  }
  if ([options.source, options.tag, options.rollback].filter(Boolean).length > 1) throw new Error('--source、--tag 和 --rollback 每次只能选择一种');
  if (options.tag && !tagPattern.test(options.tag)) throw new Error('发布标签格式为 vX.Y.Z');
  if (options.rollback && !versionPattern.test(options.rollback)) throw new Error('回退版本格式为 X.Y.Z');
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('运行时需要 Node.js 20 或更新版本');
  const home = await locateHome(options.home);
  const previous = await readJson(join(home, 'installation.json'));
  const previousSource = await readJson(join(home, 'setup.json'));
  const explicitChange = options.rollback || (options.tag && previous?.version !== options.tag.slice(1));
  if (!options.update && !explicitChange && await compatibleInstallation(previous)) {
    console.log(JSON.stringify({ installed: false, reused: true, home, ...previous }, null, 2)); return;
  }
  if (previous && !options.update && !options.rollback) throw new Error('已有工具。结束协作并停止服务后，加 --update 安装目标版本；原资料与配对码会保留。');
  if (options.rollback && (!previous || compareVersions(options.rollback, previous.version) >= 0)) throw new Error('请选择比当前安装更早且已保存在本机的版本');
  const localSource = options.source || (options.update && !options.tag && !options.rollback && (previousSource?.updateSource || previousSource?.localSource));
  let ref = options.tag;
  let temporary;
  try {
    let checkout, commit = null;
    if (options.rollback) checkout = join(home, 'versions', options.rollback);
    else if (localSource) checkout = resolve(localSource);
    else {
      temporary = await mkdtemp(join(tmpdir(), 'page-prototype-setup-'));
      checkout = temporary;
      ref ||= await defaultRef();
      console.error('正在获取固定版本 ' + ref + '…');
      commit = await fetchRelease(checkout, ref);
    }
    const pkg = await readJson(join(checkout, 'package.json'));
    if (!pkg || pkg.name !== 'page-prototype-runtime' || pkg.pagePrototypeApiVersion !== source.apiVersion || compareVersions(pkg.version, source.minimumVersion) < 0) {
      throw new Error(options.rollback ? '该版本未安装或不兼容，请查看安装目录下的 versions。' : '源码缺失或不兼容，请核对 --source 或固定发布版本。');
    }
    const expected = options.rollback || (!localSource && tagPattern.test(ref) && ref.slice(1));
    if (expected && pkg.version !== expected) throw new Error('版本标签或回退目录与包内版本不一致');
    if (previous && compareVersions(pkg.version, previous.version) < 0 && !options.rollback) throw new Error('目标版本比本地更旧。如要回退，请显式使用 --rollback X.Y.Z。');

    const distribution = await readJson(join(checkout, 'release.json'));
    if (options.rollback && !distribution) throw new Error('回退版本缺少发行清单，保留现有安装');
    if (!distribution) {
      console.error('正在安装运行依赖…');
      if (process.platform === 'win32') await command(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --omit=dev --ignore-scripts --no-audit --no-fund'], checkout);
      else await command('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], checkout);
    }
    const result = await command(process.execPath, [join(checkout, 'install.mjs'), '--home', home, ...(options.update || options.rollback ? ['--update'] : [])], checkout);
    const installation = JSON.parse(result.stdout);
    const receipt = { repository: commit ? source.repository : null, ref: commit ? ref : null, commit,
      localSource: localSource ? checkout : null,
      updateSource: options.rollback ? previousSource?.updateSource || previousSource?.localSource || null : null,
      rolledBackFrom: options.rollback ? previous.version : null, version: installation.version, installedAt: new Date().toISOString() };
    await mkdir(home, { recursive: true, mode: 0o700 });
    const receiptPath = join(home, `.setup-${randomUUID()}.json`);
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    await rename(receiptPath, join(home, 'setup.json'));
    const next = previous ? '在 chrome://extensions 重新加载「页面原型」，运行 start，再运行 doctor 核对服务和扩展版本。'
      : '在 chrome://extensions 加载 extension 指向的目录。运行 start 和 pair 配对，再运行 doctor 核对连接。';
    console.log(JSON.stringify({ ...installation, home, source: receipt, next }, null, 2));
  } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
