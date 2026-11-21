# 薄 skill 换 Haiku 跑真站（2026-11-09）

接 [skill-real-site-eval-2026-11-09.md](skill-real-site-eval-2026-11-09.md)。那一轮的采集 agent 用的是 Opus，插件对照用的是 DeepSeek/Gemini 便宜档，「skill 比插件好」里混着模型差异。这一轮把采集 agent 换成 Haiku，看 skill 对模型强弱有多敏感。

## 做法

- 站点、用户请求、规则、提示词跟 Opus 那轮逐字相同，只换采集 agent 的模型（Haiku），用上一轮能打开的 10 个站。
- 核查仍用 Sonnet、同一套五项打分（列表对不对、覆盖、逐列字段、非数据行、报告是否如实）。核查提示词里「采集方汇报」一行换成 Haiku 自己的汇报。
- 跑了两轮：
  - **H1（混合版本）**：开跑时主会话正在给 skill 加 setup 和字段清洗（23:20–23:26），配置和 CSV 落在改动窗口里，新旧版本混用。只作参考。
  - **H2（定版）**：主会话 23:45 后停改，skill 整份复制成快照 `.codex-tmp/skill-eval/haiku2/skill-snapshot/`，agent 只读快照。**这是正式成绩。** 之后主会话按本轮发现修的三处（regex 捕获组、number 去小数、截断值 NOTE）不在快照里。

## 结果

| 站点 | Opus（旧版 skill） | Haiku H1（混合） | Haiku H2（定版） |
|---|---|---|---|
| Hacker News | PASS | PASS | PASS |
| 豆瓣 Top250 | PASS | PASS | **PARTIAL**：13/250 行导演格混进年份国家 |
| 维基营收表 | PARTIAL（250 格错 3） | PASS（450 格全对） | PASS（250 格全对） |
| 百度热搜 | PASS | PASS | PASS |
| YouTube 搜索 | PASS | PARTIAL：5 个视频重复、混进 Shorts/直播 | **PARTIAL**：1 个视频重复 |
| YouTube 评论 | PASS | PASS | PASS |
| Nature 参考文献 | PASS | PASS | PASS |
| 腾讯新闻评论 | PASS（160） | PARTIAL：122，回复全缺 | **FAIL**：69/160，自设 maxPages=5 就停 |
| Google Play 评论 | PASS | PASS | PASS |
| Spotify 专辑页 | PASS（84） | FAIL：5，滚错容器 | PASS（84/84） |
| **合计** | 9 PASS / 1 PARTIAL | 7 / 2 / 1 FAIL | **7 PASS / 2 PARTIAL / 1 FAIL** |

成本（H2 每站平均）：约 12 万 token、14 次工具调用、177 秒，跟 Opus 那轮的 10–15 万 token 同一量级；按单价算 Haiku 便宜得多。最费劲的是 Spotify（39 次调用、12 分钟）和维基（15.6 万 token）。

## Haiku 的四类错误

都不是「选错列表」——10 站 × 2 轮里 Haiku 一次都没选错列表。错在下面几处：

1. **信了工具的「无重复」**（YouTube 搜索，两轮都中）：按完整链接去重，链接带 `&pp=` 跟踪参数，同一视频算成两条，汇报还写「100 个链接全部唯一」。Opus 按视频 id 去重。
2. **自设上限就交差**（腾讯 H2）：用户要全部，它设 maxPages=5，停在 `max-pages` 时「加载更多」还能点。Spotify H2 也停在 `max-pages`，只是恰好已经采全。
3. **清洗规则在没预览到的行上静默出错**（豆瓣 H2）：`导演:(.+?)(?:主演:|$)` 碰到页面把「主演」截成「主...」就一路吃到行尾；预览只看了 2 页没碰上，`verify.mjs` 也看不出（格子都有值）。
4. **范围理解偏窄**（腾讯 H1、HN H1、YouTube 评论 H1）：评论只取顶层、不采讨论链接/评论链接。按评分标准多数不算错，但用户拿到的数据少一截。

另有一类在 H1 出现、H2 消失：**滚错容器**（Spotify H1 滚父层，滚动位置在变但不加载，Haiku 换参数没换层）。H2 找对了里层，可能是运气，也可能是新版 SKILL.md 的提示起了作用，单次样本分不清。

Haiku 的诚实度：没有编数据；但 3 次把问题说轻了（YouTube「全部唯一」、腾讯 H1 没提被过滤的那条和 @提及截断、Nature H1 说缺 DOI 的行页面上没链接）。Spotify H1、腾讯 H2 的没采完都如实写了。

## skill 改版的效果（H1 → H2，同为 Haiku）

- 变好：百度摘要去掉「查看更多>」、Google Play 评分转数字并补上「有用数」、豆瓣拆出导演/年份/国家、腾讯能展开回复并标出是否回复、维基合并格从串列到全对（rows.md 那条错误建议删掉后）。
- 变坏：豆瓣从 PASS 掉到 PARTIAL——字段清洗给了弱模型一个新的静默出错口子。

## 结论

1. **Haiku 能用，但比 Opus 差一档**：定版 skill 上 7/10 PASS，Opus 旧版 9/10。差距不在识别页面，而在「对结果多看一眼」：去重键稳不稳、停下时是不是真到底、清洗规则在全部行上对不对。
2. **这些差距适合交给脚本兜，不靠写更长的文档**。弱模型不会主动去读、也不会照做的提醒，没有用。优先级：
   - `collect` 去重时默认剥 URL 查询参数（或识别 `v=`/`id=` 这类 id 参数）再比较。
   - `collect` 停在 `max-pages` 而下一页/加载更多/滚动仍在增长时，摘要里写明「未到底」并给出调高 maxPages 的建议；`verify.mjs` 把页面声明的总数（「评论 160」「共 250 条」）和实际行数对一下。
   - `verify.mjs` 对清洗字段给 NOTE（主会话已加「以…结尾」提示；长度离群检查试过误报太多没保留）。
   - 滚动多轮行数不涨时，`collect` 列出同区域其他可滚动的候选容器。
3. **开源默认模型**：Opus/Sonnet 级可以直接用；Haiku 级建议在 SKILL.md 里写明「交付前必须对照页面总数和 roundLog 自查」，并靠上面的脚本兜底。下一步可以补一轮 Sonnet，以及在修完上面几条后再跑一次 Haiku 看差距收窄多少。

## 文件

- H1：`.codex-tmp/skill-eval/haiku1/`（`out/` CSV，`work/` 配置，`verify/` 核查脚本，`verdicts.tsv`、`usage.tsv`）
- H2：`.codex-tmp/skill-eval/haiku2/`（同上，另有 `skill-snapshot/` 定版 skill）

## 后续：脚本兜底已做（11-10，主会话）

改前快照：`.codex-tmp/skill-snapshots-2026-11-10-pre-haiku-fixes/`（重跑 Haiku 时可以拿它对比）。

| 兜底 | 做法 | 用 Haiku 原配置复测 |
|---|---|---|
| 去重 | collect 比较去重键时，链接去掉跟踪参数（`utm_*`、`pp`、`si`、`feature`、`ref`、`spm` 等）和 `#fragment`，CSV 里保留原链接；摘要里写 `duplicatesMergedByLink`。verify 对「只差跟踪参数」的链接 WARN | YouTube 搜索：3 行因为 `&pp=` 不同被合并 |
| 未到底 | 停在 `max-pages` 而下一页 / 加载更多还在、滚动还在新增、或停在 `max-rows` 时，摘要写 `warning: NOT THE END …`，给出调高 maxPages 的建议；verify 把它升成 WARN | 腾讯（maxPages=5）、YouTube 都报了 |
| 对总数 | 第一页采完和结束时各读一次页面上声明的数量（「评论 160」「共 250 条」「of 300 results」），跳过行内文字、「第 N 页」，以及同一种说法出现 3 个以上不同数字的（每行自带的计数）。结果写进摘要 `totalCheck`；行数不到声明数的 80% 时 verify WARN | 腾讯：「全部160条」对 69 行；豆瓣 2 页：「共250条」对 50 行；HN、Nature 不误报 |
| 滚动不涨 | 滚动模式最后两轮都没新增、或滚不动时，列出包住这些行、能滚的元素（排除已配置的那个）；verify WARN | Spotify H1（滚了外层）：5 行就停，并指出真正能滚的内层 `> div`（41883px，一次都没滚过） |

SKILL.md 第 7、8 步写明：交付前每条 verify 的 WARN 都要么修掉、要么在报告里说明。演练场回归 22/22；E03 正确报出「共 160 条」对 123 行（这个 case 本来就要 agent 解释这个差距）。

## H3：兜底之后再跑 Haiku（11-10）

skill 取兜底四项做完后的版本，开跑前复制成快照 `.codex-tmp/skill-eval/haiku3/skill-snapshot/`；站点、请求、提示词跟 H2 逐字相同，核查仍用 Sonnet 同一套五项打分。

| 站点 | H2（兜底前） | H3（兜底后） |
|---|---|---|
| Hacker News | PASS | PASS |
| 豆瓣 Top250 | PARTIAL（导演格串列） | PASS（这次没拆 info，等于绕开了，不是兜底的功劳） |
| 维基营收表 | PASS | PASS |
| 百度热搜 | PASS | PASS |
| YouTube 搜索 | PARTIAL（1 个重复） | PARTIAL：**0 重复**，但混进 4 条行内 Shorts，报告还写「Shorts 已排除」 |
| YouTube 评论 | PASS | PASS |
| Nature | PASS | PASS（第 62 条的说法这次对了） |
| 腾讯评论 | FAIL（69/160） | PARTIAL：**155/160**（缺 5 条纯图片评论），回复和 is_reply 全对；约 6 行正文只取了第一个文本块（`index: 0`），@提及/后半句丢失 |
| Google Play | PASS | PASS |
| Spotify | PASS（84） | PARTIAL：82/84 链接（与 H2 核查过的全集比对），只有标题和链接两列；停在 maxPages=60 并自称未完成 |
| **合计** | 7 / 2 / 1 FAIL | **7 PASS / 3 PARTIAL / 0 FAIL** |

成本（H3 每站平均）：约 12.1 万 token、13 次工具调用、216 秒（Spotify 一站 29 次调用、12.7 分钟拉高了均值）。

**兜底效果**

- 「未到底」最有效：YouTube 搜索 15 页→67 行时 Haiku 看到 NOT THE END 调到 25 页拿满 100；腾讯 12 页→147 行调到 16 页采到底。H2 那种「到自设上限就交差」这轮一次没出现。
- 去重：YouTube 搜索三轮重复数 5 → 1 → 0。
- 对总数：腾讯「全部160条」起了作用；但出两次误报——维基把标题里的「2025 Results」当总数、YouTube 评论「4,129 Comments」含回复。Haiku 两次都在报告里解释了，没被带偏。建议 totalCheck 跳过像年份的数。
- 滚动不涨：Spotify 这轮滚对了里层，但最后几轮每轮只增 0–2 条，60 页仍差 2 条；Haiku 只采了标题和链接（副标题不在同一子元素，`sibling` 读不到）。

**仍然漏网的（兜底管不到的判断）**

1. 「哪些行算用户要的」：YouTube 行内 Shorts 跟普通视频同一元素，Opus 会按 `/shorts/` 过滤，Haiku 不会。
2. 「只取第一个匹配」：腾讯正文被 @提及/表情拆成多段，`index: 0` 只拿到第一段；skill 已有 `all + join` 但 Haiku 没用。可加一条 verify NOTE：字段在同一行匹配到多个元素却只取了一个。
3. 报告里多余或错误的提醒（YouTube 评论说有「…」截断、腾讯说「…」是折叠，核查都不成立）——比 H2 的把问题说轻好，但仍不准。

**结论更新**：兜底把 Haiku 的硬失败清零（FAIL 1→0），覆盖类问题基本靠脚本拦住；剩下的差距集中在「行的口径」和「字段取全」两类语义判断上，Opus 级模型自然会做，Haiku 需要再加 verify 层的提示或 references 里的硬规则。三轮里同一站 Haiku 的做法常常不同（豆瓣拆/不拆、Spotify 列数），单轮成绩有波动，比较版本时最好每站跑 2–3 次。

- H3 产物：`.codex-tmp/skill-eval/haiku3/`（`verdicts.tsv`、`usage.tsv`、`out/`、`work/`、`verify/`、`skill-snapshot/`）
