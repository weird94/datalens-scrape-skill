# scrape-skill

把网页上的列表和表格采成 CSV 的 agent skill：搜索结果、商品列表、评论和回复、榜单、名录、表格都行，翻页、无限滚动、「加载更多」、「展开回复」都能处理。

分工是：**AI 做判断，脚本做重复。** agent 看页面，决定哪个元素是一行、读哪些字段、下一页怎么来，写成一份 JSON 配置；固定脚本按配置去翻页、滚动、点展开、去重、判断到没到底。脚本不调任何模型，只依赖 Playwright。

这个仓库同时放着评测它的整套东西：演练场（80 个本地 mock 页面 case）、回归、盲测做法、真站盲测材料。

## 快速开始

```bash
git clone git@github.com:weird94/scrape-skill.git ~/projects/scrape-skill
cd ~/projects/scrape-skill && npm install
cd skill && npm install && npx playwright install chromium
```

给 Claude Code 装上：

```bash
ln -s ~/projects/scrape-skill/skill ~/.claude/skills/datalens-scrape
```

之后直接跟 agent 说「把这个页面的评论都导出成 CSV：<url>」。它会按 `skill/SKILL.md` 的工作流跑。

也可以手动用：

```bash
cd skill
node scripts/inspect.mjs "https://news.ycombinator.com/news"          # 看页面：列表、控件、滚动、浮层
node scripts/collect.mjs cfg.json --out /tmp/p.csv --max-pages 2      # 按配置预览两页
node scripts/verify.mjs /tmp/p.csv                                    # 质检
node scripts/collect.mjs cfg.json --out hn.csv                        # 正式跑
```

网站拦无头浏览器时，加 `--browser chrome` 在你自己的 Chrome 里跑（要装 Playwright 扩展，见 `skill/references/browser.md`）。

## 工作原理

agent 按 9 步走：

| 步 | 做什么 | 谁做 |
|---|---|---|
| 1 看 | `inspect.mjs` 报告重复结构（LISTS）、整页树（TREE）、翻页 / 展开候选、滚动容器、浮层；识别拦截页 | 脚本报告 |
| 2 展开 | 点开内容最多的那条记录看结构，展开按钮写进 `expand` | agent |
| 3 行 | 一行 = 用户说的一条记录 | agent |
| 4 字段 | 用户没点名就全采，行自己的链接也要一列 | agent |
| 5 更多行 | 选 `next`（滚动的不用写），验证第 2 页 | agent |
| 6 预览 | `collect --max-pages 2` + `verify.mjs`，每条 WARN 修掉或解释 | 脚本执行 |
| 7 正式跑 | 去掉页数限制 | 脚本执行 |
| 8 判停 | 读 summary：真到底、撞上限（`NOT THE END`）、总数对不上（`totalCheck`）、被拦（`wall`） | agent |
| 9 汇报 | 文件、行数、列、怎么停的、保留意见 | agent |

agent 交给脚本的只有一份配置：

```json
{
  "url": "https://example.com/search?q=lamp",
  "rows": "main ul.results > li.result",
  "fields": {
    "title": { "css": "h3", "exclude": ".badge" },
    "link": { "css": "a", "attr": "href" },
    "price": { "css": ".price-now", "number": true }
  },
  "require": ["title"],
  "next": { "type": "click", "selector": ".pager a[rel=next]" },
  "expand": ["button.show-replies"]
}
```

引擎默认替 agent 做掉这些：没写 `next` 就自动滚动；DOM 静止 1.5 秒再读；展开后重读且不丢被翻走的行；去重时忽略跳动的计数和链接里的跟踪参数；多个匹配时点屏幕上那个；关掉大的固定弹窗（含数据行的除外）；open shadow root 里也能用选择器。完整语法见 `skill/SKILL.md` 的 `## Config`。

踩坑笔记在 `skill/references/`，SKILL.md 每一步写明了什么情况读哪篇：

| 笔记 | 管什么 |
|---|---|
| `rows.md` | 卡片里的多行、两份相似列表、表格分组行和合并单元格、拆成两个兄弟元素的记录 |
| `fields.md` | 可选项错位、多个字段同 class、值只在属性里、懒加载图片 |
| `pagination.md` | 选对点击目标、像翻页但不是的控件、第 1 页后外层变了、到底后的死控件 |
| `stop-signals.md` | 拦截页、总数对不上、中间短页、最终报告怎么写 |
| `encrypted-fonts.md` | 自定义字体打乱字码，屏幕上对、采下来是乱码 |
| `browser.md` | 什么时候切到用户自己的 Chrome、怎么连 |

## 测过哪些网站

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

### 在你自己的 Chrome 里跑（`--browser chrome`，11-09 / 11-10）

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

细节和逐站分析见 `docs/skill-real-site-eval-2026-11-09.md`、`docs/skill-haiku-eval-2026-11-09.md`、`docs/skill-browser-attach-spike-2026-11-09.md`。

## 评测体系

```bash
npm test               # skill 单测（node --test）+ 演练场 fixture 单测（vitest）
npm run serve          # 演练场服务，http://localhost:3031
npm run regress        # 另开终端：重跑存下来的配置并打分（盲测 14 份 + 开发 16 份）
```

- **演练场**（`eval/playground/`）：80 个 case，每个是一个本地 mock 页面（`fixtures/<name>/route.ts`）加场景说明（`case.json`）和标准答案（`expected.json`），覆盖晚渲染、虚拟列表、死分页控件、嵌套回复、shadow DOM、加密字体、拦截页等。分类见 `INDEX.md` 和 `PATTERNS.md`。
- **回归**（`eval/regress.sh`）：只测引擎。重跑盲测 agent 当初写的配置（`blind/`，按标准答案打分）和开发用配置（`dev/`，对行数）。
- **盲测**（`eval/BLIND.md`）：测 SKILL.md 本身。每次派一个独立 agent，只给短链 `/t/<token>`，看不到 case 名；改文档要跑改前 / 改后对比，至少 Sonnet 和 Haiku 各 2 次。
- **真站**（`eval/real-sites/`）：11-09 那轮的配置、核查脚本和 227 站注册表。

2026-11-21 基线：skill 单测 42/42；fixture 单测 38 个文件 / 486 条；回归盲测 14/14、开发 16/16。

## 还不支持

逐行打开详情页；iframe 里的列表；closed shadow root（部分嵌入式评论组件）；下载按钮后面的文件。

## 目录

```
skill/                    装给 agent 的目录
  SKILL.md                工作流 + 配置语法（## Config 段）
  references/             踩坑笔记
  scripts/                inspect / collect / verify；引擎在 scripts/lib/
eval/
  serve.mts               演练场服务（next/server 用 playground/fixtures/_lib/next-shim.ts 顶替）
  regress.sh · grade.mjs  回归
  blind/ · dev/ · aliases.json
  BLIND.md                盲测做法和提示词模板
  playground/             cases/ · fixtures/ · INDEX.md · PATTERNS.md
  real-sites/             configs/ · verify/ · registry.json
docs/                     11-09 的 spike 和评测报告（路径还是 monorepo 时代的）
CLAUDE.md                 在这个仓库里迭代的规则
```

## 来源

从 [weird94/general-scraping](https://github.com/weird94/general-scraping) 的 `packages/scrape-skill`、`test/playground`、`packages/backend/src/app/dev-fixtures/playground` 拆出，基线 origin/main `9c8a6d40`（2026-11-21）。之后两边各自演化：插件里那份不会自动同步过来，这边的改进也不会自动进插件。
