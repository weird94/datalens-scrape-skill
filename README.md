# scrape-skill

`datalens-scrape` skill 和评测它的整套东西。AI 看页面、写一份 JSON 配置；固定脚本按配置翻页、滚动、点展开、去重、判停，输出 CSV。

从 general-scraping（`weird94/general-scraping`）的 `packages/scrape-skill` 拆出来，基线是 origin/main `9c8a6d40`（2026-11-21）。之后两边各自演化：插件里那份不会自动同步过来，这边的改进也不会自动进插件。

## 目录

```
skill/                    skill 本体，装给 agent 用的就是这个目录
  SKILL.md                工作流 + 配置语法（## Config 段）
  references/*.md         踩坑笔记：rows / fields / pagination / stop-signals / encrypted-fonts / browser
  scripts/                inspect.mjs · collect.mjs · verify.mjs，引擎在 scripts/lib/
eval/
  serve.mts               演练场 mock 服务（不需要 Next；next/server 用 fixtures/_lib/next-shim.ts 顶替）
  regress.sh · grade.mjs  回归：重跑存下来的配置并打分
  blind/ · aliases.json   盲测 agent 写出的配置；短链 /t/<token> → case，agent 看不到 case 名
  dev/                    开发时用的配置（只对行数）
  BLIND.md                怎么派盲测 agent、怎么判分
  playground/
    cases/<id>/           case.json（场景、期望行为）+ expected.json（标准答案）
    fixtures/<name>/      每个 mock 页面的 route.ts；__test__/ 是 fixture 自己的单测
    INDEX.md · PATTERNS.md  case 总表、pattern 分类
  real-sites/             11-09 真站盲测：配置、核查脚本、227 站注册表
docs/                     11-09 的 spike 和评测报告（路径还是 monorepo 时代的）
```

## 常用命令

```bash
npm install
npm test                 # skill 单测（node --test）+ fixture 单测（vitest）
npm run serve            # 演练场服务，默认 http://localhost:3031
npm run regress          # 另开一个终端：回归，盲测 14 份 + 开发 16 份
npm run sync-references  # 改了 references/*.md 或 SKILL.md 的 ## Config 段之后跑
```

skill 的脚本自己找 Playwright：`skill/node_modules`，或 `PLAYWRIGHT_FROM` 指向的目录（`regress.sh` 默认指向本仓库根目录）。

## 给 Claude Code 装上

```bash
ln -s ~/projects/scrape-skill/skill ~/.claude/skills/datalens-scrape
```

## 2026-11-21 的基线

- skill 单测 42/42，fixture 单测 38 个文件 / 486 条全过。
- 回归：盲测 14/14，开发 16/16。
- G01-002（三个字段分散在几个视图里）盲测：Sonnet 用原版 SKILL.md 2/2 三项齐全；Haiku 0/8，从没去内容库。往 SKILL.md 加规则没能改善 Haiku。
