#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { locateHome, readJson, compatibleInstallation } from './common.mjs';

try {
  const home = await locateHome();
  const installation = await readJson(join(home, 'installation.json'));
  if (!await compatibleInstallation(installation)) throw new Error('尚未安装兼容的页面原型运行时。请运行本 Skill 的 scripts/setup.mjs；已有旧安装时，先用 installation.json 中的 tool 执行 end、stop，再运行 setup.mjs --update。');
  const child = spawn(process.execPath, [installation.tool, ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, PAGE_PROTOTYPE_HOME: home, BRIDGE_RUNTIME_DIR: process.env.BRIDGE_RUNTIME_DIR || installation.runtime },
  });
  child.on('error', (error) => { console.error(`无法启动工具：${error.message}`); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
} catch (error) { console.error(error.message); process.exitCode = 1; }
