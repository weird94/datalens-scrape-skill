import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 续载挂起（pattern F5）。
 *
 * 列表首屏 batchSize 行，下方是「加载更多」按钮。每点一次追加 batchSize 行；首屏那一批也算第 1 批，
 * 累计到 hangAfter 批之后，按钮文案变为「加载中…」（其他语言见 TEXT），之后的点击不再追加任何行，按钮也不消失。
 * 这是限流后续载接口挂起不返回的形状：转圈不停，既没有新行，也没有「到底」文案。
 *
 * 陷阱：页面没有任何结束信号，按钮也不会被移除。把「点击后行数不变」当成到底（end-of-list）会把挂起
 * 误判成正常结束；正确的停机原因是 stuck。
 *
 * 挂起状态的可观察签名：挂起后 #load-more 仍然存在，文案为 loading 文案，页面不出现任何结束文案。
 * 判卷要区分 stuck 与 end-of-list，应检查这个签名（见 __test__/hang-after.test.ts 的签名用例）。
 *
 * query：
 * - batchSize：每批行数（默认 10，1–50）
 * - hangAfter：累计到第几批之后挂起（默认 3，1–20）。hangAfter=1 时首屏就是挂起状态。
 * - lang：文案语言 zh / en / ja（默认 zh，非法值回落到 zh）
 * - classes：class 风格，semantic = item / title / price / load-more，hash = 哈希式 class（默认 semantic，非法值回落到 semantic）
 *
 * 没有页码参数，因此没有 404 分支；越界的数值参数按 intParam 夹到范围内。
 * 同一 pattern 的变体见 eval/playground/cases/F05-*（中 / 英 / 日文案，两种 class 风格，其中一个为留出集）。
 */

type Lang = 'zh' | 'en' | 'ja'
type ClassStyle = 'semantic' | 'hash'

const LANGS: readonly Lang[] = ['zh', 'en', 'ja']
const CLASS_STYLES: readonly ClassStyle[] = ['semantic', 'hash']

interface LangText {
  title: string
  heading: string
  itemPrefix: string
  currency: string
  button: string
  loading: string
}

const TEXT: Record<Lang, LangText> = {
  zh: {
    title: '商品列表（续载）',
    heading: '商品列表',
    itemPrefix: '商品 ',
    currency: '¥',
    button: '加载更多',
    loading: '加载中…',
  },
  en: {
    title: 'Product list (load more)',
    heading: 'Product list',
    itemPrefix: 'Item ',
    currency: '$',
    button: 'Load more',
    loading: 'Loading…',
  },
  ja: {
    title: '商品一覧（続き読み込み）',
    heading: '商品一覧',
    itemPrefix: 'アイテム ',
    currency: '¥',
    button: 'さらに読み込む',
    loading: '読み込み中…',
  },
}

interface ClassNames {
  row: string
  title: string
  price: string
  button: string
}

const CLASS_NAMES: Record<ClassStyle, ClassNames> = {
  semantic: { row: 'item', title: 'title', price: 'price', button: 'load-more' },
  hash: { row: 'k3d8a1', title: 't7e2c0', price: 'p4b9f6', button: 'm1c5e8' },
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback
}

function rowHtml(index: number, text: LangText, names: ClassNames): string {
  return `<li class="${names.row}"><span class="${names.title}">${text.itemPrefix}${index}</span><span class="${names.price}">${text.currency}${100 + index}</span></li>`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const batchSize = intParam(query.get('batchSize'), 10, 1, 50)
  const hangAfter = intParam(query.get('hangAfter'), 3, 1, 20)
  const lang = pick(query.get('lang'), LANGS, 'zh')
  const classStyle = pick(query.get('classes'), CLASS_STYLES, 'semantic')
  const text = TEXT[lang]
  const names = CLASS_NAMES[classStyle]

  // 首屏就是第 1 批；若 hangAfter 不大于 1，首屏即挂起
  const initialBatches = 1
  const hung = initialBatches >= hangAfter
  const buttonText = hung ? text.loading : text.button

  const rows = Array.from({ length: batchSize }, (_, index) => rowHtml(index + 1, text, names)).join('\n')
  const body = `<h1>${text.heading}</h1>
<ul id="list">
${rows}
</ul>
<button id="load-more" class="${names.button}" type="button">${buttonText}</button>`

  const script = `
(function () {
  var batchSize = ${batchSize};
  var hangAfter = ${hangAfter};
  var loadedBatches = ${initialBatches};
  var nextNumber = batchSize + 1;
  var itemPrefix = ${JSON.stringify(text.itemPrefix)};
  var currency = ${JSON.stringify(text.currency)};
  var loadingText = ${JSON.stringify(text.loading)};
  var rowClass = ${JSON.stringify(names.row)};
  var titleClass = ${JSON.stringify(names.title)};
  var priceClass = ${JSON.stringify(names.price)};
  var list = document.getElementById('list');
  var button = document.getElementById('load-more');

  function rowHtml(n) {
    return '<li class="' + rowClass + '"><span class="' + titleClass + '">' + itemPrefix + n + '</span><span class="' + priceClass + '">' + currency + (100 + n) + '</span></li>';
  }

  button.addEventListener('click', function () {
    // 挂起之后的点击：请求永远不返回，既不追加行，也不移除按钮
    if (loadedBatches >= hangAfter) return;
    var html = '';
    for (var i = 0; i < batchSize; i++) html += rowHtml(nextNumber++);
    list.insertAdjacentHTML('beforeend', html);
    loadedBatches++;
    if (loadedBatches >= hangAfter) button.textContent = loadingText;
  });
})();
`

  return htmlResponse(
    renderShell(text.title, body, {
      script,
      style: `.${names.button} { margin-top: 12px; padding: 6px 14px; }`,
    })
  )
}
