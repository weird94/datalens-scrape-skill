# 评测体系

这里是开发和评测 skill 用的东西，用 skill 不需要它。迭代规则见根目录 `CLAUDE.md`。

```bash
npm install            # 在仓库根目录
npm test               # skill 单测（node --test）+ 演练场 fixture 单测（vitest）
npm run serve          # 演练场服务，http://localhost:3031
npm run regress        # 另开终端：重跑存下来的配置并打分（盲测 14 份 + 开发 16 份）
```

- **演练场**（`playground/`）：80 个 case，每个是一个本地 mock 页面（`fixtures/<name>/route.ts`）加场景说明（`case.json`）和标准答案（`expected.json`），覆盖晚渲染、虚拟列表、死分页控件、嵌套回复、shadow DOM、加密字体、拦截页等。分类见 `playground/INDEX.md` 和 `playground/PATTERNS.md`。`next/server` 用 `playground/fixtures/_lib/next-shim.ts` 顶替。
- **回归**（`regress.sh` + `grade.mjs`）：只测引擎。重跑盲测 agent 当初写的配置（`blind/`，按标准答案打分）和开发用配置（`dev/`，对行数）。
- **盲测**（`BLIND.md`）：测 SKILL.md 本身。每次派一个独立 agent，只给短链 `/t/<token>`（`aliases.json`），看不到 case 名；改文档要跑改前 / 改后对比，至少 Sonnet 和 Haiku 各 2 次。
- **真站**（`real-sites/`）：11-09 那轮的配置、核查脚本和 227 站注册表。

2026-11-21 基线（边采边写、详情页 detail.mjs 上线后）：skill 单测 113/113；fixture 单测 39 个文件 / 505 条；回归盲测 16/16、开发 18/18（`SCRAPE_CHUNK_STEPS=1` 分段跑结果相同）。详情页盲测：H01-001、H01-002 上 Sonnet、Haiku 各 2 次，8/8 全对。

## 真站测试记录

### 无头浏览器盲测（2026-11-09）

每站一个独立的采集 agent（Opus），只给 skill、一句请求和 URL；再派一个不能用 skill 脚本的核查 agent（Sonnet）自己打开页面，按列表、覆盖、逐列字段、非数据行、报告是否如实五项打分。15 个站从 227 站的真站注册表里挑：一半是插件当时能过的，一半是插件没过的。

| 站点 | 请求 | 结果 | 核查 |
|---|---|---|---|
| Hacker News | 前 3 页 | 90 行 · 11 列 | PASS |
| 豆瓣电影 Top250 | 全部 | 250 行 · 11 列 | PASS |
| 维基百科「最大公司」营收表 | 主表 | 50 行 · 10 列 | PARTIAL：250 格错 3 格，都在合并单元格那两行 |
| 百度热搜 | 全部 | 51 行 · 7 列 | PASS |
| YouTube 搜索 | ~100 条 | 100 行 · 8 列 | PASS（排除了 Shorts 和广告） |
| YouTube 视频评论 | ~50 条 | 50 行 · 7 列 | PASS |
| Nature 文章参考文献 | 全部 | 62 行 · 7 列 | PASS |
| 腾讯新闻评论 | 全部 | 160 行 · 9 列 | PASS（主评论 123 + 回复 37） |
| Google Play 应用评论 | ~50 条 | 50 行 · 6 列 | PASS |
| Spotify 专辑页 | 全部 | 84 行 · 6 列 | PASS（虚拟列表） |
| Reddit r/all | ~100 条 | 被拦 | agent 如实停下 |
| Product Hunt 月榜 | 全部 | 被拦（Cloudflare） | agent 如实停下 |
| Udemy 课程评价 | ~50 条 | 被拦（Cloudflare） | agent 如实停下 |
| 同花顺大宗交易 | 前 3 页 | 被拦（403） | agent 如实停下 |
| 雪球讨论 | 前 50 条 | 被拦 | agent 如实停下 |

能打开的 10 站：**9 PASS、1 PARTIAL**；5 站在第一页就被拦，没有一个 agent 编数据或绕验证。

### 同 10 站换 Haiku（11-09 → 11-10）

| 轮次 | 结果 | 主要问题 |
|---|---|---|
| H1（混合版 skill） | 7 PASS · 2 PARTIAL · 1 FAIL | Spotify 滚错容器；腾讯回复全缺 |
| H2（定版 skill） | 7 PASS · 2 PARTIAL · 1 FAIL | 腾讯自设 maxPages=5 就交差（69/160）；YouTube 链接带跟踪参数没去重 |
| H3（加了脚本兜底后） | **7 PASS · 3 PARTIAL · 0 FAIL** | 腾讯 155/160；YouTube 混进 4 条行内 Shorts；Spotify 82/84 |

H3 前加的兜底：去重剥跟踪参数、撞上限时报 `NOT THE END`、对页面声明的总数、滚动不涨时列出别的可滚动容器。Haiku 20 次里从没选错过列表，错都错在「过早相信做完了」。

### 在用户自己的 Chrome 里跑（`--browser chrome`，11-09 / 11-10）

| 站点 | 结果 |
|---|---|
| Hacker News，2 页 | 60 行，和无头浏览器逐条一致 |
| Reddit r/all（无头时被拦） | 80 行，标题、板块、作者、分数、评论数、链接都对 |
| Product Hunt 月榜（无头时被拦） | 18 行 |
| Udemy、同花顺、雪球（无头时被拦） | 都能正常打开（只验证了能打开，没有采） |

拦截页识别：5 个会被拦的站用无头浏览器打开，5/5 判为 `blocked`；7 个正常站（HN、豆瓣、百度、Nature、维基、YouTube、Google Play）0 误报。

### 功能验证（自己写配置，不是盲测）

`setup`、字段清洗上线时各挑一个站验：Google Play（用 setup 打开评论弹窗，30 行）、Hacker News（`number` / `default` / 负 index）、百度热搜（`exclude` 去掉「查看更多>」）、豆瓣（`split` + `regex` 拆出年份、地区、类型）、Nature（`all` + `join`）。只证明功能能用，不证明 agent 会用。

### 插件里用同一引擎修过的真站问题

这个引擎在 general-scraping 里也是插件侧栏 AI 采集的执行层。下面这些是在插件里发现、在引擎里修的，不是这个 skill 的盲测：抖音视频评论（展开回复按钮点不动、点到弹窗底下的元素，11-10）、Reddit 帖子（403 个 shadow host 下列表识别 258ms，11-10）、知乎回答（点开后才出现的作者 / 时间被重读丢掉，11-19）。

### 还没测

- 最后一次完整的真站盲测是 11-10 的 Haiku H3；之后的引擎改动（11-12 补齐旧采集器的机械行为、11-19 展开重读、11-21 判停等）只过了演练场回归。
- Sonnet 没在真站上跑过。
- 被拦的 5 站里，Udemy、同花顺、雪球在自己的 Chrome 里只验证了能打开，没有采。

细节和逐站分析见 `docs/skill-real-site-eval-2026-11-09.md`、`docs/skill-haiku-eval-2026-11-09.md`、`docs/skill-browser-attach-spike-2026-11-09.md`（路径还是 monorepo 时代的）。

## 来源

从 [weird94/general-scraping](https://github.com/weird94/general-scraping) 的 `packages/scrape-skill`、`test/playground`、`packages/backend/src/app/dev-fixtures/playground` 拆出，基线 origin/main `9c8a6d40`（2026-11-21）。之后两边各自演化：插件里那份不会自动同步过来，这边的改进也不会自动进插件。
