# 盲测

回归（`regress.sh`）只重跑已经存下来的配置，测的是引擎。要测 SKILL.md 本身（agent 会不会看、会不会选、会不会判停），得派 agent 从零做一遍。

## 准备

1. 给要测的 case 加一个短链：`aliases.json` 里加 `"<8 位随机 hex>": { "id": "<case id>", "url": "<case.json 里的 url>" }`。短链让 agent 看不到 case 名和 fixture 名。页面里的相对链接（`?view=…`）落回短链时，请求自己的 query 会覆盖短链里的。
2. 重启 `npm run serve`（短链在启动时读取）。
3. 把要测的 skill 版本复制到临时目录，**只复制 `SKILL.md`、`references/`、`scripts/`、`package.json`**，不要带上 `eval/`（里面有答案）。`node_modules` 可以软链到本仓库根目录的 `node_modules`。改前 / 改后各一份。

## 派 agent

每次运行一个独立 agent，互不共享上下文。提示词模板：

```
You are an agent helping a user collect data from a web page. You have a scraping skill in the folder SKILL_DIR=<skill copy> . Read SKILL_DIR/SKILL.md first and follow it (dependencies are already installed; run the scripts from SKILL_DIR).

The user is on this page: http://localhost:3031/t/<token>
The user says: "<case.json 里的 message>"

Rules for this run:
- Only read files inside SKILL_DIR. Write every file you create (configs, CSVs) into OUT_DIR=<out dir> . Do not read the web server's source code or anything else on disk; look at the page only through the skill's scripts (curl is not allowed either).
- The user is not available for questions; do the best you can and finish with your report.
- Keep a list of every script command you ran, in order.

Finish with:
1. REPORT: exactly what you would tell the user (file, rows, columns, anything missing and why).
2. COMMANDS: the numbered list of commands you ran.
3. FINAL_CSV: the path of the final CSV, or "none".
```

模型至少跑 Sonnet 和 Haiku，每格至少 2 次。

## 判分

- 不信 agent 的报告，自己读 CSV：行数、每个要求的列填了几行、总数对不对（`expected.json`）。
- 报告也要核：有没有说错的地方（比如「页面上没有这个字段」而其实在别的视图里有）。
- 想把一次好的运行固化成回归：把它的配置放进 `blind/<token>.json`（短链）或 `dev/<case id>.json`（直链）。`grade.mjs` 用 `expected.json` 的 `rowMatch.textPrefix` 认行，只采了不含该文字的列时会判错，这种放 `dev/`。

## 真站

`real-sites/` 是 11-09 那轮的材料：`configs/` 是采集 agent 写的配置（老原型时代的，可能要按现在的配置语法调整），`verify/` 是核查 agent 当时写的 Playwright 脚本，`registry.json` 是 227 站的真站注册表。做法见 `docs/skill-real-site-eval-2026-11-09.md`：每站一个采集 agent，再派一个不能用 skill 脚本的核查 agent 自己打开页面逐字段核对，给 PASS / PARTIAL / FAIL。
