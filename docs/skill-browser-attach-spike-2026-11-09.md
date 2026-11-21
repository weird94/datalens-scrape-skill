# 薄 skill 接用户浏览器：spike（2026-11-09）

接 [skill-real-site-eval-2026-11-09.md](skill-real-site-eval-2026-11-09.md)。那一轮有 1/3 的真站第一页就被拦，本次验证一条路：skill 的采集器不再自己起无头浏览器，而是通过 Playwright 扩展接管用户自己的 Chrome。

## 结论

**可行。** 采集循环原样搬进 `playwright-cli run-code`，在用户的 Chrome 里跑通了翻页跳转、滚动加载和单页三种情况。上一轮被拦的 5 个站在用户 Chrome 里全部能打开，其中 Reddit 和 Product Hunt 完整采到了数据。

| 检查 | 结果 |
|---|---|
| `playwright-cli attach --extension` 连上用户 Chrome | 能，但要满足三个条件（见「安装上的坑」） |
| `run-code` 能跑多久 | 跑满 180 秒没有被中断（更长的没测） |
| `run-code` 能返回多大的结果 | 690 KB、3000 行 JSON 完整返回 |
| `run-code` 里有什么 | 有 `fetch`、`setTimeout`、`Buffer`；**没有 `require`、`process`、`fs`** |
| 指纹 | Chrome 156，`navigator.webdriver` 为 false |
| Hacker News，2 页，点「More」跳转翻页 | 60 行，7 秒，与自带浏览器的 60 行逐条一致 |
| Reddit r/all（上一轮被拦），滚动 | 80 行，23 秒，标题、板块、作者、分数、评论数、链接都对 |
| Product Hunt 月榜（上一轮被拦），单页 | 18 行，5 秒（主文档返回 403，但内容正常渲染） |
| Udemy 课程页、同花顺大宗交易、雪球搜索（上一轮被拦） | 都能打开、正文正常（只看了能否打开，没有采） |

## 纠正：同花顺不是按 IP 拦的

上一轮报告写的是「同花顺明确是按出口 IP 拦的（新西兰）」，这是错的。同一台机器、同一个出口 IP（49.225.19.209）：
- 自带的无头浏览器访问 → 403「Nginx forbidden」，页面里写着这个 IP；
- 用户的 Chrome 访问 → 200，大宗交易表正常显示。

所以拦截的依据是浏览器特征，不是 IP。页面上印出 IP 只是拦截页的格式，不能当成「按 IP 拦」的证据。

## 做法

1. 把 `collect.mjs` 的采集循环抽成 `lib/collector.mjs` 里的 `collectOnPage(page, config, lib)`。它只调用 Playwright 的 `page` 和 `lib` 传进来的 `settle` / `gotoAndSettle` / `runSetup` / `IN_PAGE`，不 import 任何模块，也不引用模块级变量。
2. `collect.mjs` 加一个 `--browser chrome --session NAME` 参数：
   - 用 `Function.prototype.toString()` 把 `collectOnPage` 和这几个辅助函数拼进一个 `async page => {...}` 文件，配置和 in-page.js 以 JSON 字面量内联进去；
   - 调用 `playwright-cli -s=NAME --raw run-code --filename=...`，从标准输出读回 `{rows, rounds, stopReason, ...}`，CSV 和摘要仍在 Node 这边写。
3. `inPage()` 改成每次先检查 `window.__dlk`，没有就用 `page.evaluate(IN_PAGE)` 注入，不再依赖 `addInitScript`（接管来的页面不一定能加初始化脚本）。
4. 默认模式（自带浏览器）也走同一个 `collectOnPage`，HN 2 页结果不变。

对 agent 来说接口不变：同一份 `cfg.json`，多加一个 `--browser chrome`。

代码：`.codex-tmp/skill-spike/browser-attach/`（`scripts/collect.mjs`、`scripts/lib/collector.mjs`，以及 `runs/` 里的配置、CSV 和探测脚本）。**还没并进 `.codex-tmp/datalens-skill/`**，因为另一个会话正在用那个目录跑 Haiku 评测。

## 安装上的坑（都踩到了）

1. **CLI 版本必须够新。** 本机全局的 `playwright-cli` 是 0.1.7，内置的扩展协议是第 1 版；商店里的扩展和 Playwright MCP 0.0.84 已经是第 2 版。旧 CLI 只会打开 connect 页，然后报「Extension connection timeout」，看上去像没装扩展。用 `npx -y @playwright/cli@0.1.23` 就连上了。没有改全局安装。
2. **macOS 上要设 `PLAYWRIGHT_MCP_EXECUTABLE_PATH`。** 新版 CLI 会先扫描 `~/Library/Application Support/Google/Chrome` 找装了扩展的个人资料，Claude 的进程读不了这个目录，于是报「Playwright Extension not found」。设成 Chrome 的可执行文件路径就跳过扫描。这和 memory 里 MCP 的坑是同一个。
3. **token。** 设了 `PLAYWRIGHT_MCP_EXTENSION_TOKEN` 就不用每次在 Chrome 里点授权。本次复用了 MCP 那份（在 `~/Library/LaunchAgents/com.zw.playwright-mcp.plist`）。不设 token 时要用户手动点授权，旧版 CLI 只等 5 秒；新版等多久没测。

## 还没验证 / 已知限制

- **跑在用户看得见的标签页里。** 采集会导航扩展接管的那个标签页，用户在采集期间不能动它。多个采集能不能并行（多个 session）没测。
- **超过 3 分钟的采集**没测；Spotify 那种 200 秒以上的虚拟列表需要确认。
- **`inspect.mjs` 还没改。** 本次的列表识别是临时写的 run-code 脚本，正式做时按同样办法改 inspect。
- **拦截页识别还没做。** 这是什么时候提示用户切到 `--browser chrome` 的前提。
- **`setup` 步骤**在 chrome 模式下理论上能用（`runSetup` 一起内联了），没有专门测。
- 每次失败的 attach 都会在用户 Chrome 里留下一个 connect 标签页（本次留了 2 个）。

## 下一步建议

1. 等 Haiku 评测结束后，把 `collector.mjs` 拆分并进 skill；inspect 也改成两种接法。
2. inspect / collect 识别拦截页（403、验证页、拦截文案）时返回 `blocked`，并在 SKILL.md 里写清楚：遇到 `blocked` 就停下来，引导用户装 Playwright 扩展和 `@playwright/cli`，然后用 `--browser chrome` 重跑。
3. 在没有 token 的干净环境里走一遍首次安装，量一下用户要点几下、等多久。

## 后续：并入 skill + 拦截页识别（11-10）

Haiku 评测用的是自己的快照（`.codex-tmp/skill-eval/haiku2/skill-snapshot`），所以直接改了正式版 `.codex-tmp/datalens-skill/`。改之前的版本另存在 `.codex-tmp/skill-snapshots-2026-11-09-pre-browser/`。skill 共 1644 行。

### 改了什么

- **两种接法**：`inspect.mjs` 和 `collect.mjs` 都支持 `--browser chrome`。
  - 判断逻辑抽成只依赖 `page` 的 `lib/inspector.mjs` 和 `lib/collector.mjs`。
  - `lib/chrome.mjs` 负责自动连接（会话 `scrape`，没连上就 `attach --extension=chrome`）、在 run-code 里执行、取回结果。
  - 默认用 `npx -y @playwright/cli@latest`，可以用 `PLAYWRIGHT_CLI` 覆盖。
  - macOS 上自动设置 `PLAYWRIGHT_MCP_EXECUTABLE_PATH`。
- **拦截页识别**：in-page 新增 `wall(status)`，只用通用信号：验证码或挑战组件、拦截文案（中英日）、HTTP 状态码、页面剩余文字量。
  - inspect 顶部打印 `BLOCKED` 或 `LOGIN?`。
  - collect 在「一行都没采到」时把停止原因改成 `blocked` / `login-wall`。
  - 采集中途停滞或滚到底时，停止原因不变，只在摘要里附 `wall`。原因是可以关掉的「登录后查看」弹窗看起来也像墙，比如 D11 那个 case。
- **标签页不绘制检测**：采集开始时用 `requestAnimationFrame` 检查标签页有没有在被绘制。
  - 没在绘制，就先 `bringToFront`，把标签页切到前台。
  - 还是不绘制（窗口被最小化或被别的程序挡住），就以 `tab-not-rendering` 停下。
  - 不加这个检查的话，滚动和点击会无限期卡住，实测卡过 5 分钟以上。
- **文档**：新增 `references/browser.md`（什么时候切换、要先问用户、用户要装什么、怎么运行、连接失败时怎么办）；SKILL.md、stop-signals.md 也同步更新了。

### 验证

| 检查 | 结果 |
|---|---|
| 拦截识别：5 个会被拦的真站，用自带浏览器打开 | 5/5 判为 `blocked`（Reddit「You've been blocked」、Udemy 和 PH「Just a moment...」+403、同花顺 forbidden+403、雪球「请求异常」） |
| 拦截识别：7 个正常真站（HN、豆瓣、百度、Nature、维基、YouTube、Google Play） | 0 误报 |
| 演练场 57 个 case 的首页和墙页（共 60 页） | 标出 8 页，都是本来就设计成墙的（A05 两个、F02、F03、F04 三种语言的验证码页），唯一例外是 D11 的可关弹窗 |
| 纯墙 case 走 collect | A05-003 → `login-wall`；A05-004、F02-001 → `blocked`；F03-001 有 5 行，停止原因是 `scroll-end` 并附 `wall: login` |
| 演练场回归（14 个盲测配置 + 8 个开发集配置） | 22/22。F04 两个验证码 case 的停止原因变成 `blocked` |
| 字段清洗单元检查 | 全过 |
| Reddit，自带浏览器 | inspect 打印 BLOCKED；collect 停在 `blocked`，note 给出证据 |
| Reddit，`--browser chrome`（自动连接） | inspect 显示 HTTP 200、4391 字；collect 采到 28 行（小步滚动） |

### 新发现

- **标签页隐藏时页面会停**：之前 spike 那次能采 80 行，是因为当时窗口在前台。这次标签页在后台（`visibilityState` 为 hidden），`requestAnimationFrame` 不触发，懒加载停住，鼠标滚轮卡死。把标签页切到前台就恢复了。
- **会话断开**：会话空闲 70 秒、采集结束后都还在线；但同一晚出现过两次莫名断开，原因没查清。断开后脚本会自动重连，代价是你的 Chrome 里多一个连接页。
- **Reddit 跳转**：本次 /r/all 被跳到了首页，首页一屏只渲染 3 个帖子，后面的要滚到附近才加载，整页一下滚到底不会触发加载，要配 `step`。这是网站本身的行为，和接法无关。

### 还没做

- 没有 token 时的首次安装体验（要点几下、等多久）。
- 超过 3 分钟的采集。
- 让 agent 盲测「被拦 → 问用户 → 切到 Chrome」这条完整流程。
