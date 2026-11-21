# 在这个仓库里迭代 skill

回复用中文。代码、SKILL.md、references 用英文。

## 规则

- **改 skill 先有 case。** 每个要修的问题先在 `eval/playground` 里有一个能复现的 case（fixture 页面 + `case.json` + `expected.json`），改前红、改后绿。真站上发现的问题也先抽象成演练场 case。
- **提示词必须通用。** SKILL.md 和 references 里不能出现只对某个站、某个 fixture 成立的说法（fixture 自己的按钮文字、class 名、页面名都不行）。改完派一个没看过改动理由的 subagent 审一遍通用性。
- **弱模型靠脚本兜，不靠加长文档。** Haiku 犯的错（过早相信「已经找全了」、不去其它视图）往文档里加规则基本救不回来；优先让脚本的输出把问题摆到它眼前（WARN、summary 字段）。
- **文档改动要盲测对比。** 改 SKILL.md 的工作流段时，用 `eval/BLIND.md` 的做法跑改前 / 改后，至少 Sonnet 和 Haiku 各 2 次；没有对比证据的规则不加。
- **改了 `references/*.md` 或 `## Config` 段**，跑 `npm run sync-references`，`npm test` 会查漂移。
- 每次改引擎都跑 `npm test` 和 `npm run regress`（回归要先 `npm run serve`）。

## 背景

- 这份是从 general-scraping 的 `packages/scrape-skill` 复制出来的（基线 9c8a6d40），之后两边各自演化。插件侧栏 AI 采集用的是 monorepo 里那份。
- 插件那边的提示词问题（上下文裁剪导致重复查看、只能采单个列表）在这里不存在：Claude Code 不裁剪工具输出，也能采几次再合并。
- `docs/` 里是 11-09 的 spike 和评测报告，里面的路径还是 monorepo 时代的。
