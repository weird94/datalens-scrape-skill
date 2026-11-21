import { NextRequest, NextResponse } from '../_lib/next-shim'

import { htmlResponse, intParam, playgroundBlocked, renderShell } from '../_lib/shell'

/**
 * 演练场 · ERP 订单表：订单头 + 每单几行商品（pattern G3：连续调工具长时间不说话）。
 *
 * 形状来自 2026-11-18 一次真实的侧栏 AI 采集（跨境电商 ERP 的订单列表）：用户要「商品信息和 1688 商品信息两列」，
 * 两列都在列表的单元格里、不用下钻，agent 第 0 步说了一句「我先看一下页面结构」，之后 14 步、2 分半没再对用户
 * 说话，用户断开。这个夹具考的是 agent 在摸清页面的那几步里有没有跟用户说话，不是采集本身。
 *
 * 页面：筛选栏、状态页签、批量操作条，然后一张大表。每个订单是一个 tbody：第一行是订单头（订单号、店铺、
 * 下单时间、买家、状态，整行一个 colspan 单元格），下面每个商品一行：
 * - 「商品信息」：缩略图、标题链接、SKU、单价 × 数量
 * - 「1688 商品信息」：已关联的有 1688 标题链接、供应商、采购价；未关联的只有「未关联 · 去关联」按钮
 * - 「订单金额」「操作」两格用 rowspan 跨该单所有商品行
 * class 是哈希式的，表头只有一行。
 *
 * 一行数据 = 一个商品行（用户要的两列都是商品级的）。每单商品数按 1、2、3 循环。
 *
 * query：
 * - orders：订单数（默认 15，1–50）
 */

const SHOPS = ['Shopee 越南站', 'Lazada 泰国站', 'TikTok Shop 马来站'] as const
const BUYERS = ['nguyen.t***', 'somchai.k***', 'aisyah.r***', 'tran.v***', 'lim.w***'] as const
const ITEMS = [
  { title: '夏季冰丝阔腿裤 女 高腰垂感', sku: 'KZ-2301', price: 9.9, src: '冰丝阔腿裤高腰垂感显瘦', supplier: '义乌市晨曦服饰厂', cost: 18.5 },
  { title: '便携式迷你风扇 USB 充电 静音', sku: 'FS-0417', price: 6.5, src: 'USB充电迷你手持风扇', supplier: '深圳市凉风电子有限公司', cost: 11.2 },
  { title: '不锈钢保温杯 500ml 316 内胆', sku: 'BW-5502', price: 12.8, src: '316不锈钢保温杯500ml', supplier: '永康市佳美杯业', cost: 21.0 },
  { title: '儿童卡通雨衣 带书包位', sku: 'YY-1188', price: 7.2, src: null, supplier: null, cost: null },
  { title: '硅胶厨房锅铲五件套', sku: 'CJ-0905', price: 10.4, src: '食品级硅胶厨具五件套', supplier: '阳江市厨友五金制品厂', cost: 16.8 },
  { title: '蓝牙耳机 入耳式 降噪 长续航', sku: 'EJ-7712', price: 15.6, src: '入耳式蓝牙耳机降噪', supplier: '东莞市声悦科技', cost: 28.9 },
  { title: '宠物自动饮水机 2L 静音', sku: 'CW-3320', price: 13.3, src: null, supplier: null, cost: null },
] as const

const STYLE = `
.f9a { display: flex; gap: 8px; margin: 8px 0; } .f9a input, .f9a select { padding: 4px 8px; }
.t2c { display: flex; gap: 16px; border-bottom: 1px solid #ddd; margin: 8px 0; } .t2c span { padding: 6px 0; cursor: pointer; } .t2c .on { border-bottom: 2px solid #1677ff; color: #1677ff; }
.b7e { display: flex; gap: 8px; margin: 8px 0; }
table.k3x { border-collapse: collapse; width: 100%; font-size: 13px; }
.k3x th, .k3x td { border: 1px solid #e5e5e5; padding: 6px 8px; vertical-align: top; text-align: left; }
.k3x tr.h1q td { background: #f5f7fa; color: #555; }
.p4m { display: flex; gap: 8px; } .p4m img { width: 48px; height: 48px; background: #eee; }
.s8u { color: #888; font-size: 12px; }
.n0d { color: #aaa; }
`

function orderHtml(order: number, productOffset: number): { html: string; products: number } {
  const products = ((order - 1) % 3) + 1
  const shop = SHOPS[(order - 1) % SHOPS.length]
  const buyer = BUYERS[(order - 1) % BUYERS.length]
  const orderNo = `25111${String(800000 + order * 137).padStart(7, '0')}`
  const day = String(1 + ((order * 3) % 18)).padStart(2, '0')
  const status = order % 4 === 0 ? '已发货' : '待处理'
  let total = 0
  const lines: string[] = []
  for (let index = 0; index < products; index += 1) {
    const item = ITEMS[(productOffset + index) % ITEMS.length]
    const qty = 1 + ((order + index) % 3)
    total += item.price * qty
    const productCell = `<td class="c1v"><div class="p4m"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><div><a class="a6w" href="/dev-fixtures/playground/order-table?item=${item.sku}">${item.title}</a><div class="s8u">SKU: ${item.sku}-${order}</div><div class="s8u">$${item.price.toFixed(2)} × ${qty}</div></div></div></td>`
    const sourceCell = item.src
      ? `<td class="c2v"><a class="a6w" href="https://detail.1688.example/offer/${6000000 + order * 10 + index}.html">${item.src}</a><div class="s8u">${item.supplier}</div><div class="s8u">采购价 ¥${item.cost!.toFixed(2)}</div></td>`
      : `<td class="c2v"><span class="n0d">未关联</span> · <button type="button" class="l2k">去关联</button></td>`
    const spanned =
      index === 0
        ? `<td class="c3v" rowspan="${products}">{{TOTAL}}</td><td class="c4v" rowspan="${products}"><button type="button">打印面单</button><button type="button">备注</button></td>`
        : ''
    lines.push(`<tr class="r5z">${productCell}${sourceCell}${spanned}</tr>`)
  }
  const header = `<tr class="h1q"><td colspan="4"><input type="checkbox"> 订单号 ${orderNo}　店铺：${shop}　下单时间 2025-11-${day} 10:${String(order % 60).padStart(2, '0')}　买家：${buyer}　状态：${status}</td></tr>`
  const html = `<tbody class="o8j">${header}${lines.join('')}</tbody>`.replace('{{TOTAL}}', `$${total.toFixed(2)}`)
  return { html, products }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = playgroundBlocked()
  if (blocked) return blocked

  const orders = intParam(request.nextUrl.searchParams.get('orders'), 15, 1, 50)
  const bodies: string[] = []
  let productOffset = 0
  for (let order = 1; order <= orders; order += 1) {
    const { html, products } = orderHtml(order, productOffset)
    bodies.push(html)
    productOffset += products
  }

  const body = `<h1>订单管理</h1>
<div class="f9a"><input placeholder="订单号 / SKU / 买家"><select><option>全部店铺</option></select><select><option>下单时间</option></select><button type="button">搜索</button><button type="button">重置</button></div>
<div class="t2c"><span class="on">全部（${orders}）</span><span>待处理</span><span>已发货</span><span>已取消</span></div>
<div class="b7e"><button type="button">批量打印</button><button type="button">批量关联 1688</button><button type="button">导出订单</button></div>
<table class="k3x">
<thead><tr><th>商品信息</th><th>1688 商品信息</th><th>订单金额</th><th>操作</th></tr></thead>
${bodies.join('\n')}
</table>`

  return htmlResponse(renderShell('订单管理', body, { style: STYLE }))
}
