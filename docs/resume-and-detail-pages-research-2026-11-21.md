# 断点续采和详情页下钻：调研（2026-11-21）

两个功能都还没做。这份文档整理了三方面的材料：我们引擎的现状、同类 skill 和工具的做法、插件里那套下钻实现，最后给出建议方案和顺序。

## 1. 我们现在的情况

- **无论用哪种浏览器跑，CSV 都是整轮结束才写**：`skill/scripts/collect.mjs:66` 一次 `writeFileSync`。进程中途挂掉、被杀、Chrome 断开，已经采到的行全部丢失。
- 用户自己的 Chrome 那条路更麻烦：整个循环是一次 `playwright-cli run-code` 调用（`collect.mjs:48-55`），结果在调用结束时才以 JSON 返回，中途没有任何东西落盘。
- 引擎里现成可用的接口：
  - `lib.onRound(entry)`：每轮结束调用（`lib/collector.mjs:11, 590`），现在没人用。
  - `lib.shouldStop(rowCount)`：外部叫停。
  - `lib.seedRows`：用已有的行预填结果，并参与去重（`lib/collector.mjs:150-160`）。原本给插件的「预览→正式」用，正好可以当续采的种子。
  - 返回值里的 `lastUrl`：结束时所在的页面地址。
  - 行身份 `rowIdentity()` 会剥掉跳动的计数和跟踪参数，所以不同进程之间去重也成立。
- 详情页：SKILL.md 把它列在「Not supported」里（`skill/SKILL.md:123`），只要求把每行的详情链接采成一列（`fields.md:33`）。

## 2. 别人怎么做断点续采

| 做法 | 谁在用 | 怎么做 | 解决不了 |
|---|---|---|---|
| 以输出文件为准 | Murtadha-Najem/scraping-skill | `records.jsonl` 只追加、逐条 flush，重跑时从文件反推哪些做完了；`failures.jsonl` 记失败次数，超限就停放；重跑同一条命令就是续采 | 单位必须是一个 URL；同一页面里的滚动、点下一页没有覆盖 |
| 请求队列落盘 | Crawlee、Scrapy JOBDIR | 队列、已见集合、自定义状态存到磁盘，重启时不清空就接着跑 | 最小单位还是一个请求；点按钮翻页这种状态没法序列化 |
| 位置游标 + 去重锚点 | Sharan0516 | 每页写一次状态文件（页码、最后一条记录）；续采时 URL 分页直接跳页，按钮分页「尽量」跳回去；用 CSV 末尾 50 行去重 | 按钮翻页且 URL 不变、无限滚动都没办法；列表顺序一变锚点就失效 |
| 换成接口 | yfe404/web-scraper | 滚动时抓网络请求，有 API 就改走 API，进度变成可定位的 cursor | 没有接口，或 cursor 带签名、有时效 |

**结论：没有一家能在一次滚动或一串点击翻页的过程中间存档。** 大家都只把「能用 URL 定位的东西」当续采单位。托管平台（Apify、Firecrawl）的续采是平台替你跑，用户这边没有检查点。

插件里也没有：`ExecutionController.resume()` 只在内存里重跑，service worker 一重启，正在跑的任务就直接标为失败，行数据只存在内存里。`docs/ai-scrape-tool-design-2026-10-19.md` 原话是「引擎目前没有接着上次的页继续的语义」。

## 3. 别人怎么做详情页

| 做法 | 谁在用 | 怎么做 | 问题 |
|---|---|---|---|
| 分两遍跑 | Murtadha | 先采列表，从列表里拿到详情 URL 清单，再用同一个 runner 跑清单，按 id 合并；全局限速，遇到 429 所有线程一起停 | 合并要手工做；两层就要跑三遍 |
| 同一个爬虫里按 label 分流 | Crawlee / Apify / yfe404 | 列表页把链接以 `label:'DETAIL'` 入队，详情处理函数取字段后写出整行；有并发、每分钟请求数、重试次数这些设置 | 详情页失败时这一行默认就丢了；只能靠点击进入的详情页不支持 |
| 嵌套选择器树 | webscraper.io | 链接选择器下面挂子选择器，子选择器在打开的页面上执行，输出时父级字段复制到每条子记录 | 文档里没写失败、重试和续采怎么办 |
| 串联两个采集器 | Browse AI、Apify、Octoparse | A 采列表并带出 URL 字段，交给 B 采详情 | 合并回列表行要靠用户自己 |
| 交给 AI 逐页抽取 | Firecrawl `/extract`、crawl4ai | 每页按 schema 或 prompt 抽；crawl4ai 的折中是用 AI 生成一次选择器，之后批量跑时不再调模型 | 不稳定、贵；Firecrawl extract 将于 2026-12-10 下线，官方承认「大站全量还不支持」 |

**插件里那套**（`packages/copilot-services/src/execution/drilldown-executor.ts`）：

- 边采列表边进详情。每个详情页在 Chrome 里开一个新的可见窗口，因为后台标签页会被限速，懒加载内容出不来。
- 最多同时开 3 个窗口，两次开窗至少间隔 5 秒。
- 配置挂在链接字段上：`drillDowns: [{ mode: 'detail'|'list', fields | list }]`，最深两层。
- `list` 模式下，详情页里的列表输出成单独的子表，用 `parent_row_index` 关联主表。
- 失败处理没有设重试次数：失败了不写结果，下一轮发现这一行还没有详情就重新排队，是有意这样设计的。
- 踩过的坑：
  - 小屏上窗口位置出界，开窗被拒，10 行里有 4 行没有详情；
  - 选择器把样本页的具体值写了进去，后来加了跨页校验（`drill-selector-cross-check.ts`）；
  - 一列挂 N 个下钻配置，就要加载 N 遍详情页；
  - 已经采完的任务不能事后补详情，只能整表重采。

## 4. 建议方案

两个功能的关键在同一处：**把进度落到磁盘上，并以 URL 为单位**。详情页本来就是一页一个 URL，天然适合续采；列表页能用 URL 定位的部分就定位，定位不了的部分如实告诉用户。

### 4.1 列表采集：先做到「挂了不丢」，再做「接着采」

**第一步：边采边写（小改动，收益最大）**

- `onRound` 每轮把当前全部行原子写一次 CSV（先写临时文件再 rename）。
  - 不用追加写，因为展开后重读会原地更新已有的行。
  - 几万行以内整个重写的开销可以忽略；行数更多时改成每 N 轮写一次。
- summary 同步写当前状态：`stopReason` 先记为 `running`，被杀后留下的文件就能看出是中途断的。
- 用户自己的 Chrome：把一次 `run-code` 拆成多段，每段跑 K 轮就返回，由宿主写盘后再发下一段。
  - 因为标签页在调用之间一直开着，下一段不重新打开 URL，带上 `seedRows` 接着翻。
  - 这样 Chrome 模式也有了中间结果，还顺带避免了 `run-code` 单次调用太长的风险。

**第二步：`--resume`（中等改动）**

`collect.mjs cfg.json --out x.csv --resume` 读回已有的 CSV 当 `seedRows`，再按翻页方式决定从哪里接：

| 翻页方式 | 从哪里接 |
|---|---|
| `url`（页码在地址里） | 直接打开下一页的地址 |
| `click`，翻页时地址会变 | 打开上次的 `lastUrl` |
| Chrome 模式，标签页还开着 | 不重新打开，在原地继续。最常见的中断（窗口被最小化、单次调用超时）都属于这种 |
| 无限滚动、加载更多、点下一页但地址不变 | 只能从头重放。已采的行靠去重跳过，展开按钮也不会再点（评论类页面主要的时间都花在展开上），但滚动和翻页本身省不掉。在 summary 里如实写「从头重放了 N 页」 |

**不做的**：抓网络请求改走接口。这条路效果最好，但等于另做一个采集器，和「脚本只依赖 DOM」的定位冲突。可以留作以后单独评估。

### 4.2 详情页：独立脚本，分两遍跑

```
collect.mjs list.json --out list.csv                  # 第一遍：列表，必须有链接列
detail.mjs list.csv detail.json --out full.csv        # 第二遍：逐个打开链接
```

`detail.json`：

```json
{
  "link": "link",
  "fields": { "sku": { "css": ".sku" }, "desc": { "css": "#description" } },
  "require": ["sku"],
  "waitFor": "#description",
  "delayMs": 1500,
  "concurrency": 1
}
```

- **配置单独一份**，和列表配置用同一套字段语法（`css` / `attr` / `number` / `split`…），不新增语法。`setup` 和 `expand` 也沿用，用来处理详情页里的「展开全文」或切换标签。
- **一个 URL 是一个单元，每个都落盘**：`full.detail.jsonl` 每行记 `{url, status: ok|empty|failed|blocked, fields, attempts, error}`。
  - 重跑同一条命令就是续采：`ok` 和 `empty` 跳过，`failed` 重试，超过上限就停放。
  - 这是 Murtadha 的做法，比插件那种失败了就无限重新排队可控。
- **合并**：输出 = 列表的所有列 + 详情列 + `detail_status`。详情失败的行**保留列表数据**，详情列留空，并写明原因，不丢行（Crawlee 默认会丢）。
- **详情页本身是个列表时**（比如商品的评论）：`detail.json` 里写 `rows` 和 `next`，就是一份完整的列表配置，输出成子表 `full.children.csv`，带 `parent_link` 列。
  - 用链接而不是行号关联，因为链接在续采和重跑之后不会变，行号会变。
  - 两层就对子表再跑一次 `detail.mjs`，不做配置嵌套。
- **限速和拦截**：
  - 默认串行，每页间隔 1–3 秒随机抖动。并发只开放给无头浏览器，上限 3。
  - 连续 K 页被判为拦截或要登录，就整轮停下，记为 `blocked`，检查点保留，提示用户切到自己的 Chrome 再跑同一条命令。
  - 连续 K 页拿到空数据，就回去重开一个之前成功过的 URL：还能取到数据，说明是这些页确实没有内容；取不到，说明是页面或网络出了问题（借鉴 Murtadha 的 canary）。
- **Chrome 模式**：固定用同一个标签页依次打开，不开新窗口。插件开窗口是为了绕开后台标签页被限速，我们的 Chrome 模式本来就要求窗口可见。

**SKILL.md 工作流要加的步骤**：

1. 用户要的字段只在详情页上：先采列表，确保有链接列。
2. 拿**首、中、尾三个不同的**详情 URL 跑 `inspect`。模板可能不一样，也能防止把样本页的具体值写进选择器，插件踩过这个坑。
3. 写 `detail.json`，用 `--max-rows 5` 预览。
4. 用 `verify.mjs` 看每列填了多少，对照列表里两边都有的字段（比如标题），确认取的是同一条记录。
5. 跑全部，汇报 `detail_status` 的分布。

**为什么不像插件那样边采边钻**：

- 分开跑天然能续采；
- 用户看到列表的行数后，可以先决定值不值得打开几千个详情页；
- 列表采集的逻辑一点不用动。

代价是要跑两条命令，但这正好由 agent 来做，不需要用户操心。

## 5. 顺序和验证

| 顺序 | 内容 | 规模 | 验证 |
|---|---|---|---|
| 1 | 列表边采边写 + Chrome 分段运行 | 小 | 跑到一半 SIGKILL，看 CSV 里是否已有前几轮的行；Chrome 模式下中途最小化窗口，看是否留有部分结果 |
| 2 | `detail.mjs` + jsonl 检查点 + 合并 | 中 | 新增演练场 case：列表→详情，含模板不同的详情页、几个 404、第 N 页开始被拦截。杀掉再重跑，看总数是否对上、有没有重复行、失败行是否保留 |
| 3 | `--resume` | 中 | 四种翻页方式各一个 case，测「杀掉 → 续采」，结果和一次跑完逐行一致 |
| 4 | 详情页里的列表 → 子表 | 中 | 商品→评论 case，检查 `parent_link` 关联是否正确 |
| 5 | SKILL.md 工作流 | 文档 | 按 `eval/BLIND.md`：改前 / 改后，Sonnet 和 Haiku 各跑 2 次 |

1 和 2 互不依赖，可以并行。2 对用户最有用：现在「要详情页里的字段」只能回答「不支持」。

## 来源

- 同类做法：[Murtadha-Najem/scraping-skill](https://github.com/Murtadha-Najem/scraping-skill)（`reference/durability.md`、`scripts/runner_template.py`、`scripts/scrapekit.py`）、[Sharan0516/claude-skill-web-scraper](https://github.com/Sharan0516/claude-skill-web-scraper)、[yfe404/web-scraper](https://github.com/yfe404/web-scraper)、[brettdavies/crawl4ai-skill](https://github.com/brettdavies/crawl4ai-skill)、[apify/agent-skills](https://github.com/apify/agent-skills)、[firecrawl/cli](https://github.com/firecrawl/cli)、[Crawlee request storage](https://crawlee.dev/js/docs/guides/request-storage)、[Scrapy jobs](https://docs.scrapy.org/en/latest/topics/jobs.html)、[webscraper.io link selector](https://webscraper.io/documentation/selectors/link-selector)、[Browse AI deep scraping](https://help.browse.ai/en/articles/10553465-how-to-extract-data-across-multiple-pages-deep-scraping)、[Firecrawl extract](https://docs.firecrawl.dev/features/extract)
- 插件：general-scraping 里的 `packages/copilot-services/src/execution/drilldown-executor.ts`、`packages/api-types/src/agent-drill-down.ts`、`docs/multi-drill-design.md`、`docs/drill-down-missing-detail-values-2026-10-25.md`、`docs/ai-scrape-tool-design-2026-10-19.md`
