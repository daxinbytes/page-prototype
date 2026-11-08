# 页面原型 · page-prototype

让 AI 在现有网页上分析逻辑、试改样式和交互，并保存可切换的原型方案。用户继续使用已登录的 Chrome 页面体验修改。

本仓库只维护中文 Skill 和安装入口。Node 本地服务与 Chrome 扩展在 [page-prototype-runtime](https://github.com/daxinbytes/page-prototype-runtime)，分别更新。

## 安装 Skill

```sh
npx skills add daxinbytes/page-prototype --skill page-prototype -g
```

按提示选择使用的 Agent。`skills` CLI 有自己的 Node.js 版本要求；如果提示不满足 engines，请升级 Node 后重试。Skill 安装完成不等于 Chrome 扩展已加载。

然后对 Agent 说：

> 使用 page-prototype 帮我配置页面原型工具，我要协作的页面是 https://你的测试站点/页面。

Agent 会检查环境、获取并安装运行时、启动本地服务，给出扩展目录和接入指引。首次需要你在 Chrome 开发者模式下加载该目录、配对并授权站点。后续直接描述需求，例如“分析当前页面的搜索逻辑”或“把搜索按钮改成蓝色”。

## 安装内容

- Skill：当前仓库，由 `npx skills` 安装到对应 Agent 的技能目录。
- 运行时：首次调用 Skill 时自动获取，默认安装到 `~/.page-prototype`；已有旧安装沿用原目录。
- 扩展：运行时安装结果中的稳定 `extension` 目录，由 Chrome 加载。

服务、扩展和采集数据均在本机，运行时包不包含另一份 Skill。Agent 会读取本地采集文件来分析页面，相关内容的模型处理方式取决于你使用的 Agent。

## 更新与开发

Skill 用 `npx skills update page-prototype -g` 更新；运行时与扩展由 Agent 按 [接入与更新](references/接入与更新.md) 执行 `scripts/setup.mjs --update`，然后在 Chrome 重新加载扩展。更新保留方案和配对信息。

运行时最低 Node.js 20、Chrome 125；首次获取和更新需要 Git、npm 及 GitHub/npm 网络。Agent 须能在用户电脑执行命令和读写文件。当前在 macOS 验证。

开发验证可用 `node scripts/setup.mjs --source /绝对路径/page-prototype-runtime --home /临时数据目录`。后续执行 `scripts/tool.mjs` 时设置相同的 `PAGE_PROTOTYPE_HOME`。这一入口可在仓库发布前验证两仓库协作流程。

运行安装集成测试（仅使用临时数据目录）：

```sh
PAGE_PROTOTYPE_TEST_SOURCE=/绝对路径/page-prototype-runtime node --test test/setup.test.mjs
```
