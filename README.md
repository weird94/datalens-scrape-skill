# datalens-scrape

一个给 AI agent（Claude Code 等）用的 skill：你说想要页面上的哪些数据，它把整份列表采下来存成 CSV。

适合的内容：搜索结果、商品列表、评论和回复、榜单、名录、表格。分页、无限滚动、「加载更多」、「展开回复」它都会自己处理，不会只交回第一屏。

```
你：把这个视频下面的评论都导出成 CSV，回复也要 https://www.youtube.com/watch?v=...
agent：已保存 comments.csv，共 213 行（主评论 160 + 回复 53），
       列：作者、时间、内容、点赞数、回复给谁、链接。
       评论区已经滚到底，页面显示的评论数和采到的一致。
```

## 安装

把下面这段话发给你的 agent，让它替你装：

```text
帮我把 https://github.com/weird94/scrape-skill 里的 skill（在 skill/ 目录）装上，装完试一下能不能用。
```

## 怎么用

装好后直接跟 agent 说要什么，带上网址：

- 「把这个搜索结果前 5 页的商品采下来，要标题、价格、店铺、链接：<url>」
- 「这个榜单全部导出成表格：<url>」
- 「这篇文章的参考文献整理成 CSV：<url>」
- 「采 100 条评论就行：<url>」

agent 会先看一眼页面，确定哪一块是你要的列表、每行读哪些字段、下一页怎么来，先试采两页检查，没问题再采全部。最后告诉你：

- 文件存在哪、多少行、有哪些列；
- **怎么停的**：真的到底了、采到你要的数量了、撞上页数上限（会明说「还没采完」）、页面写的总数和采到的对不上，或者被网站拦了；
- 哪些字段缺了、为什么。

没指定字段时它会把每行能看到的信息都采上，包括每行自己的链接。说清楚「要哪几列」「要多少条」结果会更贴近你要的。

## 网站拦住了怎么办

skill 默认在后台开一个看不见的浏览器。很多网站会拦这种浏览器，有些内容要登录才看得到。这时 agent 会**先问你**，同意后改用你自己的 Chrome 来采，带着你的登录状态。

第一次要做的准备：按 [Playwright Chrome Extension 的设置文档](https://github.com/microsoft/playwright/tree/main/packages/extension#readme) 装好扩展。

采的过程中：

- 不要动那个正在被操作的标签页；
- **别把 Chrome 窗口最小化或被别的窗口完全挡住**，不然页面不渲染、滚动和加载都会卡住，脚本会停下提示你；
- 碰到验证码或登录页，agent 不会替你处理，你在那个标签页里自己过一下，它再继续。

连不上时的报错和处理办法见 [`skill/references/browser.md`](skill/references/browser.md)。

## 在哪些网站上试过

2026 年 11 月测过，结果由另一个 agent 打开页面逐字段核对：

| 网站 | 采的内容 | 结果 |
|---|---|---|
| Hacker News | 首页前 3 页 | 90 行，全对 |
| 豆瓣电影 Top250 | 全部 | 250 行，全对 |
| 百度热搜 | 全部 | 51 行，全对 |
| YouTube | 搜索结果 | 100 行，全对（自动排除了 Shorts 和广告） |
| YouTube | 视频评论 | 50 行，全对 |
| Nature | 文章参考文献 | 62 行，全对 |
| 腾讯新闻 | 文章评论（含回复） | 160 行，全对 |
| Google Play | 应用评论 | 50 行，全对 |
| Spotify | 专辑曲目 | 84 行，全对 |
| 维基百科 | 「最大公司」营收表 | 50 行，合并单元格那两行错了 3 格 |

**要用你自己的 Chrome 才能采**：Reddit、Product Hunt（各试过一次，都采到了）。Udemy、同花顺、雪球也会拦后台浏览器，在自己的 Chrome 里能打开，但还没完整采过。

网站改版后选择器可能失效。agent 每次都是现场看页面、重新写配置，不依赖存好的模板，所以一般不受影响；但如果你发现哪个站采得不对，欢迎反馈。

## 用什么模型

Opus 和 Sonnet 测下来效果最好。Haiku 也能用，在上面 10 个站上 7 个全对、3 个差一点，差在两种地方：

- 容易提前收工，比如只采了一部分就说完成了；
- 数据分散在页面的其他视图或标签页里时，它不太会主动去找。

用小模型时，留意它报告里的「怎么停的」：写着「还没采完」或者总数对不上，就让它接着采。

## 还不支持

- 逐行点进详情页采数据（只采列表本身能看到的内容）
- iframe 里的列表
- 某些嵌入式评论组件（closed shadow root）
- 点下载按钮才拿到的文件

## 数据去了哪里

脚本只在你的电脑上跑，只依赖 Playwright，不调用任何模型或外部服务。页面内容只交给你正在用的 agent，CSV 存在你指定的位置。

## 手动使用

不经过 agent 也能直接跑脚本：

```bash
cd skill
node scripts/inspect.mjs "https://news.ycombinator.com/news"          # 看页面：有哪些列表、翻页控件、弹窗
node scripts/collect.mjs cfg.json --out /tmp/p.csv --max-pages 2      # 按配置试采两页
node scripts/verify.mjs /tmp/p.csv                                    # 检查结果
node scripts/collect.mjs cfg.json --out hn.csv                        # 采全部
```

配置是一份很小的 JSON：

```json
{
  "url": "https://example.com/search?q=lamp",
  "rows": "main ul.results > li.result",
  "fields": {
    "title": { "css": "h3" },
    "link": { "css": "a", "attr": "href" },
    "price": { "css": ".price-now", "number": true }
  },
  "next": { "type": "click", "selector": ".pager a[rel=next]" }
}
```

没写 `next` 的话会自动滚动。完整语法见 [`skill/SKILL.md`](skill/SKILL.md) 的 `## Config` 一节，各种疑难页面的处理在 [`skill/references/`](skill/references/)。

## 仓库里还有什么

`skill/` 是装给 agent 用的，只需要它。`eval/` 和 `docs/` 是开发和评测这个 skill 用的，包括 80 个本地模拟页面、回归测试和盲测方法，见 [`eval/README.md`](eval/README.md)。
