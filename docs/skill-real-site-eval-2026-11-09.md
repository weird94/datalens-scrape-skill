# 薄 skill 真实网站盲测（2026-11-09）

接 [skill-prototype-eval-2026-11-09.md](skill-prototype-eval-2026-11-09.md)。上一轮的演练场 14/14 是同分布成绩；这一轮在 15 个真实公开网站上盲测同一个原型（`.codex-tmp/datalens-skill/`）。

## 做法

- **选站**：从真站走查注册表（`test/sites/sites.json`，227 站）选 15 个。不选 10-13 全量走查里就被拦截或要登录的站。
  - 插件当时 PASS 的 7 个：Hacker News、豆瓣 Top250、维基百科最大公司表、百度热搜、YouTube 搜索、Product Hunt 月榜、Reddit r/all。
  - 插件没过或有已知问题的 8 个：YouTube 视频评论（插件采成了推荐视频却判 PASS）、Spotify 专辑页、Nature 参考文献、同花顺大宗交易、腾讯新闻评论、Google Play 评论、Udemy 课程评价、雪球讨论。
- **采集**：每站一个独立 agent（Opus），只给 skill 路径、一句中文请求和 URL。只能用 skill 的脚本，不准用 curl 和其他浏览器工具，遇墙就停。结尾要写一行 `SKILL GAP:`。
- **核查**：每个产出数据的站再派一个独立 agent（Sonnet）。它不能用 skill 的脚本和配置，而是自己写 Playwright 脚本打开页面、截图，按五项打分：列表对不对、覆盖、逐列字段、非数据行、报告是否如实。最后给出 PASS / PARTIAL / FAIL。
- 开测前给采集器补了一个通用能力：字段 `sibling: n`，用于一条记录跨两个兄弟元素的情况（两行一条的表格、`dt`/`dd`）。这是 `inspect` 在 Hacker News 上暴露的、演练场没覆盖的通用结构。

## 结果

能打开的 10 个站：**9 PASS、1 PARTIAL**。另外 5 个站被反爬拦在第一页，agent 全部如实停下、没有造假数据。

| 站点 | 请求 | skill 结果 | 核查 | 插件上次（10-13，rows 10） |
|---|---|---|---|---|
| Hacker News | 前 3 页 | 90 行 · 11 列 · 8s | PASS：第 2 页 5 行逐字段对上 | PASS |
| 豆瓣 Top250 | 全部 | 250 行 · 11 列 · 31s | PASS：实时 75 部 0 处不符 | PASS |
| 维基百科营收表 | 主表 | 50 行 · 10 列 · 5s | **PARTIAL**：250 格错 3 格，都在 Meta/Chevron 共用合并单元格那两行 | PASS（但已知第 5–6 行错位） |
| 百度热搜 | 全部 | 51 行 · 7 列 · 12s | PASS：51 条齐，49 条在榜的字段全对 | PASS |
| YouTube 搜索 | ~100 条 | 100 行 · 8 列 · 59s | PASS：排除了 Shorts 和广告 | PASS |
| YouTube 视频评论 | ~50 条 | 50 行 · 7 列 · 15s | PASS：真是评论，2 条与实时逐字一致 | 判 PASS，实际采成了推荐视频 |
| Nature 参考文献 | 全部 | 62 行 · 7 列 · 8s | PASS：62 条齐，DOI 抽查全对 | WARN |
| 腾讯新闻评论 | 全部 | 160 行 · 9 列 · 58s | PASS：核查独立数出 123+37=160，逐行一致 | WARN（19 行） |
| Google Play 评论 | ~50 条 | 50 行 · 6 列 · 13s | PASS：实时前 10 条逐条对上 | 采集超时 |
| Spotify 专辑页 | 全部 | 84 行 · 6 列 · 214s | PASS：核查独立收集 84 个链接，集合完全一致 | WARN（10 行） |
| Reddit r/all | ~100 条 | 被拦（network security / js_challenge） | — | PASS |
| Product Hunt 月榜 | 全部 | 被拦（Cloudflare 机器人验证） | — | PASS |
| Udemy 评价 | ~50 条 | 被拦（Cloudflare 机器人验证） | — | 采集超时 |
| 同花顺大宗交易 | 前 3 页 | 被拦（Nginx forbidden，出口 IP 在新西兰） | — | WARN |
| 雪球讨论 | 前 50 条 | 被拦（「请求异常已被安全策略拦截」） | — | LOW_ROWS（3 行） |

和插件对比时注意三点：插件那轮是一个月前；插件按 rows 10 上限跑，范围不同；插件用的是自己的自动判卷（已知会假 PASS），这次用的是独立 agent 逐字段核对。所以只能看方向：插件没采好的 5 个能打开的站（YouTube 评论、Nature、腾讯评论、Google Play、Spotify），skill 全部通过；插件有已知错位的维基表，skill 错位范围更小，但也没完全对。

### 成本

- 采集：每站 46–478 秒（Spotify 最长，因为虚拟列表要小步滚动），6–21 次工具调用，约 10–15 万 token。
- 采集器本身的运行时间：5–214 秒。
- 核查：每站约 9–10 万 token。核查是评测成本，用户实际使用时不会有。

## 被拦截的 5 个站

Reddit 和 Product Hunt 在插件 10-13 那轮还能进，这次被拦，说明这台机器出口的无头浏览器现在被盯上了。同花顺明确是按出口 IP 拦的（新西兰）。（**更正**：同日 spike 证明不是按 IP 拦的。同一 IP 下，用户自己的 Chrome 能正常打开，拦截看的是浏览器特征，见 [skill-browser-attach-spike-2026-11-09.md](skill-browser-attach-spike-2026-11-09.md)。）5 个 agent 都做对了三件事：认出是墙而不是渲染慢；没有用有界面模式或其他手段绕过；没有导出空表或拦截页文字冒充数据。有两个 agent 注意到 `browser.mjs` 里有一个没写进文档的 `HEADFUL` 开关，都明确选择了不用它来过机器人验证。

**结论：真实网站上 1/3 打不开，接上用户自己的浏览器是必须的，不是可选项。**

## agent 汇报的 skill 缺口（按出现次数）

| 缺口 | 提到的站 | 说明 |
|---|---|---|
| 字段没有后处理 | HN、豆瓣、Nature、百度、YouTube 搜索、Google Play、腾讯 | 不能正则提取 / 替换、去前后缀、排除子元素文字、转数字、按 `<br>` 拆分。百度那个 agent 只能导出后自己写脚本删「查看更多>」 |
| 打不开时只能用全新无头浏览器 | Reddit、Product Hunt、Udemy、同花顺、雪球 | 需要接用户已登录、已过验证的浏览器（CDP 连接本机 Chrome，或者走插件的 MCP bridge） |
| 不识别拦截页 | 同上 5 个 | `inspect` 把拦截页文字排成第 1 名列表，403 页上还提示「试试 --wait」；`collect` 只有笼统的 `no-rows-on-first-page`，没有 `blocked`；不报 HTTP 状态码 |
| 没有「开始采集前先操作一下」的步骤 | Google Play（先打开评论弹窗）、Spotify（深链接 404，要从歌手页点进去）、雪球（切标签、改排序）、YouTube 评论（改排序） | agent 只能借 `waitFor` + `expand` 绕过，而且要读源码才知道 `expand` 每个元素只点一次 |
| `inspect` 的启发式不够 | YouTube 搜索、腾讯、豆瓣、维基 | 认不出自定义元素名（`ytd-video-renderer`）作为行；没有 role 的 div 按钮不进 CONTROLS；豆瓣的「后页>」没列出；推荐了维基自动生成、每次编辑都会变的 id |
| `inspect` 不能在容器里滚动 | Spotify、Google Play | `--scroll` 只能滚整个窗口，虚拟列表和弹窗里的列表没法在预览前验证 |
| 表格模式 | 维基 | 没有把 rowspan/colspan 展开成规整网格、按表头命名列。**references/rows.md 建议的「按位置选 + fillDown」在真表上会静默串列**：错位时读到的是别的格子，值不为空，fillDown 就不会补 |
| 自动关弹窗和「列表就在弹窗里」冲突 | Google Play | 必须手动设 `autoDismiss: false`，否则采集器会把评论弹窗关掉 |
| 懒加载字段补不上 | YouTube 搜索 | 缩略图要滚进视口才加载，去重保留的是第一次抓到的空值 |
| 嵌套层级 | 腾讯 | 回复和主评论 class 相同，无法输出「属于哪条主评论」；没有「元素是否存在」这种是/否字段 |
| 文档 | 多个 | `HEADFUL`、`SCRAPE_LOCALE` 没写；`expand` 只点一次没写；`roundLog` 里的 `skipped` 没解释；正好翻完最后一页时报 `max-pages` 而不是到底 |

## 结论

1. **薄 skill 在能打开的真实网站上成立**：10 个里 9 个 PASS、1 个 PARTIAL。插件采不好的评论区、弹窗里的评论、虚拟列表、递归嵌套专辑页、参考文献，都采对了。字段经独立核查逐列对过，不只是看行数。
2. **最大的问题不在采集能力，而在能不能打开页面**：1/3 的站在第一页就被拦。这部分插件反而占优，因为插件跑在用户自己的浏览器里。
3. **第二大的问题是字段后处理**：7/10 的成功站点都希望能清洗字段。现在要么原样导出，要么 agent 自己在导出后写脚本。
4. **agent 的诚实度很好**：被拦截的站全部如实停下；成功的站里，有 1 份报告把合并单元格的错位误判成了维基原文的错误（维基那份），其余报告与 CSV 一致。

## 建议的下一步（按价值排序）

1. **接用户的浏览器 + 识别拦截页**：给 `browser.mjs` 加通过 CDP 连接本机已开 Chrome 的模式（或者走插件的 MCP bridge）；`inspect` / `collect` 遇到 403、验证页、拦截文案时直接标 `blocked`，并给出建议。
2. **配置里加 `setup` 步骤**：采集前按顺序执行的点击、等待、跳转。
3. **字段后处理**：`regex` / `replace` / `exclude`（排除子元素）/ `split` / `number`，以及「元素是否存在」的布尔字段。
4. **表格模式**：`rows` 指向 `table` 时自动展开 rowspan/colspan、按表头命名列；同时改掉 references 里错误的「按位置 + fillDown」建议。
5. `inspect` 小修：识别自定义元素、普通 div 按钮、容器内滚动预览。

## 后续：补上 setup 和字段清洗（同日）

按上面第 2、3 条建议改了原型（skill 总行数 1123 → 1370）。

**setup**：配置里加 `setup` 数组，在页面加载后、第一次采集前按顺序执行。支持 click、goto、gotoHref、fill、select、press、hover、scrollTo、waitFor、wait。
- 选择器用 Playwright 语法，可以按按钮文字找（`button:has-text("Newest")`）。
- 每一步可以设 `optional`（失败就跳过）和 `timeoutMs`。
- 必需的一步失败时，以 `setup-failed` 停止，`note` 里写明是哪一步。
- `inspect.mjs --setup` 执行同样的步骤，方便在写配置前先看结果。

**字段清洗**：字段对象新增以下选项。
- `exclude`：排除子元素的文字。
- `all` + `join`：取所有匹配并拼接。
- 负数 `index`：从末尾数。
- `split` + `part`：拆分后取第几段；按 `<br>` 拆分时保留换行。
- `regex`：正则提取。
- `replace`：替换。
- `number`：转数字，去掉千分位，识别 k/M/B、千/万/亿。
- `default`：结果为空时的默认值。
- `exists`：行内有没有某元素。
- `matches`：行本身是否匹配某选择器，可用来区分回复和主评论。

**顺手修的**
- autoDismiss 不再关闭包含 `rows` 的弹窗。Google Play 不用再手动设 `autoDismiss: false`。
- 正好翻到最后一页时报 `next-control-gone` / `load-more-gone`，不再报 `max-pages`。
- `cfg.json --out cfg.csv` 不会再用摘要覆盖配置文件。
- references/rows.md 删掉了「按位置选 + fillDown」的错误建议，改为说明合并单元格为什么会静默串列，以及如何分形状处理。
- SKILL.md 补写了 `HEADFUL`（只用于调试，不许用来过机器人验证）、`SCRAPE_LOCALE`、`expand` 每个元素只点一次、`roundLog` 里 `skipped` 的含义。

**验证**
- 浏览器内单元检查：19 个字段断言、10 个数字解析样例，全部通过。
- 演练场回归：用 run1 里 14 个盲测 agent 写的配置和 8 个开发集配置原样重跑，22/22 通过，行为没有退化。
- 真站：每个站各验一项新能力。

| 站点 | 验什么 | 结果 |
|---|---|---|
| Google Play | 用 `setup` 打开评论弹窗（替代 waitFor + expand 的绕法），同时开着 autoDismiss | 30 行，11 秒，弹窗没被关；`stars` 用正则从 aria-label 取出 1–5，`helpful` 转成数字 |
| Hacker News | `number` + `default`，`index: -1` | 「discuss」变成 0；评论数、分数都是纯数字 |
| 百度热搜 | `exclude: "a"` | 51 条描述末尾的「查看更多>」全部去掉（原始列 51/51 都带） |
| 豆瓣 Top250 | `split: "\n"` + `part` + `regex` | 50 行的年份、地区、类型三列全部拆出，无空值；`max-pages` 时下一页还在，报告正确 |
| Nature 参考文献 | `all` + `join` | 修好了被截一半的期刊名（只有 1 行受影响）；年份用正则提取，62/62 |
| 演练场 | `setup` 失败 / optional / 末页 | 必需的一步失败报 `setup-failed` 并写明哪一步；optional 的一步跳过后继续；`--max-pages 3` 正好翻完时报 `next-control-gone` |

Haiku 评测会话随后报了三处问题，已修：
- 正则有捕获组但组 1 没参与匹配时，原来会返回整段匹配，现在返回空。
- `number` 原来会把 9.0 变成 9，现在不带单位时保留原写法。
- 豆瓣「导演」正则在页面把「主演」截成「主...」时一路吃到行尾：`verify.mjs` 对以「…」结尾的值加了 NOTE。

试过「长度超过列中位数 3 倍就警告」，在已核查为 PASS 的真站数据上误报很多（长片名、长评论），也抓不到这个例子，没有保留。

真站验证是我写的配置，不是盲测，只能证明「功能能用」，不能证明「agent 会用」。

**注意**：这次改动期间，另一个会话正在用同一个 skill 目录跑 Haiku 真站评测（`.codex-tmp/skill-eval/haiku1/`）。至少 gplay 那个 agent 已经用上了新的 `setup`。所以 Haiku 那一轮跑的是新旧混合的版本，和 Opus 那轮不严格可比。skill 目录没有 git 提交，切不回旧版。

## 文件

- 本轮产出：`.codex-tmp/skill-eval/real1/`（`out/` 每站 CSV + 摘要、`work/` 每个 agent 写的配置、`verify/` 核查脚本与实时数据）
