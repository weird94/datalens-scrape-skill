import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, itemRow, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · 弹窗锁滚动（pattern D11）。
 *
 * query：
 * - rows：正确采集应得的总行数（默认 40，1–100）
 * - popupAfterMs：墙钟延迟毫秒数（默认 2000，0–10000）。到点即弹窗，不需要任何滚动。
 * - popupAfterBatch：累计加载到第几批之后弹窗（默认 2，1–10；1 即首屏就弹）。与墙钟无关。
 *
 * 形状：
 * - 列表 ul#list 在 window 滚动中。服务端只渲染首批 10 行，之后每次滚动到接近底部追加 10 行，直到 rows。
 * - 遮罩弹窗（.popup，内含 button.popup-close「关闭」）在下面两者先到者出现，且只出现一次：
 *   1. popupAfterMs 毫秒后；
 *   2. 已加载行数达到 popupAfterBatch 批（默认即 20 行）时，在追加那一刻同步弹出。
 *   只在仍有未加载行时弹出：行数已全部加载就没有需要锁住的续载，不弹窗。
 * - 弹窗出现时给 body 设 overflow:hidden，弹窗期间滚动事件不追加行。
 * - 点关闭：移除遮罩、恢复 body 的 overflow，之后滚动恢复续载；弹窗不会再次出现。
 *
 * 陷阱：弹窗期间滚动完全无效。第 2 条保证：无论采集器多快，到第 popupAfterBatch 批就被挡住，
 * 不会因为墙钟时间没到而在弹窗出现前拿满 rows 行。第 1 条保证：不滚动的流程（例如先等弹窗出现再点关闭）
 * 也能在约 popupAfterMs 毫秒内看见弹窗。
 *
 * 弹窗模板放在 <template> 里，弹出时才挂到 DOM，所以「等弹窗出现」有明确的时机。
 */

const BATCH = 10

const POPUP_TEMPLATE = `<template id="popup-tpl"><div class="popup"><div class="popup-card"><p>登录后查看全部内容</p><button class="popup-close" type="button">关闭</button></div></div></template>`

function clientScript(rows: number, initial: number, popupAfterMs: number, popupAt: number): string {
  // 脚本里不用反引号和 ${}，避免和外层模板字符串混淆。
  return `
(function () {
  var TOTAL = ${rows};
  var BATCH = ${BATCH};
  var POPUP_AFTER = ${popupAfterMs};
  var POPUP_AT = ${popupAt};
  var loaded = ${initial};
  var locked = false;
  var popupShown = false;
  var list = document.getElementById('list');

  function appendBatch() {
    if (locked || loaded >= TOTAL) return;
    var end = Math.min(TOTAL, loaded + BATCH);
    var html = '';
    for (var n = loaded + 1; n <= end; n++) {
      html += '<li class="item"><span class="title">商品 ' + n + '</span><span class="price">¥' + (100 + n) + '</span></li>';
    }
    list.insertAdjacentHTML('beforeend', html);
    loaded = end;
    if (loaded >= POPUP_AT) showPopup();
  }

  function showPopup() {
    if (popupShown || loaded >= TOTAL) return;
    popupShown = true;
    locked = true;
    document.body.appendChild(document.getElementById('popup-tpl').content.cloneNode(true));
    document.body.style.overflow = 'hidden';
    document.querySelector('.popup-close').addEventListener('click', closePopup);
  }

  function closePopup() {
    var popup = document.querySelector('.popup');
    if (popup) popup.remove();
    locked = false;
    document.body.style.overflow = '';
  }

  window.addEventListener('scroll', function () {
    var nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 200;
    if (nearBottom) appendBatch();
  });

  if (loaded >= POPUP_AT) showPopup();
  setTimeout(showPopup, POPUP_AFTER);
})();`
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const query = request.nextUrl.searchParams
  const rows = intParam(query.get('rows'), 40, 1, 100)
  const popupAfterMs = intParam(query.get('popupAfterMs'), 2000, 0, 10000)
  const popupAfterBatch = intParam(query.get('popupAfterBatch'), 2, 1, 10)
  const initial = Math.min(BATCH, rows)
  const popupAt = BATCH * popupAfterBatch

  const firstBatch = Array.from({ length: initial }, (_, index) => itemRow(index + 1)).join('\n')
  // 页面高度至少两个视口，保证小视口下首批 10 行也能滚动、触发续载（否则是「页面不可滚」的假象，不是 D11 的陷阱）。
  const style = '.item { padding: 32px 0; } body { min-height: 200vh; } .popup { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; justify-content: center; } .popup-card { background: #fff; padding: 24px; border-radius: 8px; min-width: 260px; } .popup-close { margin-top: 12px; padding: 6px 16px; }'

  const body = `<h1>商品列表</h1>
<ul id="list">
${firstBatch}
</ul>
${POPUP_TEMPLATE}`

  return htmlResponse(
    renderShell('商品列表 弹窗锁滚动', body, {
      style,
      script: clientScript(rows, initial, popupAfterMs, popupAt),
    })
  )
}
