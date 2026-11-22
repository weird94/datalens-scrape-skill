/**
 * 演练场 · 列表 → 详情页（pattern H1）共用的数据和规则，列表页 route.ts 与详情页 [id]/route.ts 都从这里取。
 *
 * 每件商品由编号 id 决定：
 * - id % 9 === 0：列表里有链接，但详情页 404（死链）
 * - id % 10 === 7：列表里没有链接（「Coming soon」，只有标题和价格）
 * - id % 4 === 0：详情页用另一套模板（品牌不在规格表里，而在标题下的「by 品牌」链接里）
 * - id % 5 === 0：flaky=1 时，这件商品详情页的第一次请求返回 503
 * - id % 3 === 0：warranty=1 时，这件商品没有保修（规格表里没有 Warranty 行，页面别处也没有）
 * 详情页的完整描述藏在「Read more」后面，点了才插入 .full-text。
 *
 * reviews=1 时详情页主记录里有一个评价列表（reviewCount：按 id % 8 取 3/0/5/1/4/0/6/2 条，有 0 条的），
 * 前 REVIEWS_INLINE 条直接显示，其余点「Show all N reviews」才插入。
 */

export const BASE = '/dev-fixtures/playground/detail-links'

/** 列表页带给详情链接的 query（只带出现过的）：详情页的行为由它们调节。 */
export const CARRIED_PARAMS = ['lateMs', 'blockAfter', 'softBlockAfter', 'run', 'flaky', 'related', 'warranty', 'reviews', 'reviewPager', 'reviewStep', 'reviewsLateMs'] as const

const BRANDS = ['Northwind', 'Acme', 'Globex', 'Initech', 'Umbrella', 'Stark']

export const isDeadLink = (id: number): boolean => id % 9 === 0
export const hasNoLink = (id: number): boolean => id % 10 === 7
export const isCompactTemplate = (id: number): boolean => id % 4 === 0
export const isFlaky = (id: number): boolean => id % 5 === 0
export const hasWarranty = (id: number): boolean => id % 3 !== 0

export interface Product {
  id: number
  name: string
  price: string
  brand: string
  sku: string
  summary: string
  fullText: string
  /** warranty=1 时才显示；hasWarranty 为 false 的商品是空串。 */
  warranty: string
}

export function product(id: number): Product {
  return {
    id,
    name: `Product ${id}`,
    price: `$${(10 + id * 3).toFixed(2)}`,
    brand: BRANDS[id % BRANDS.length],
    sku: `SKU-${String(id).padStart(4, '0')}`,
    summary: `A short note about product ${id}…`,
    fullText: `Full description of product ${id}: made to last, tested for ${id + 2} months, ships in a recycled box.`,
    warranty: hasWarranty(id) ? `${1 + (id % 3)} years` : '',
  }
}

/** 详情页链接：列表页 query 里出现过的 CARRIED_PARAMS 原样带上。 */
export function detailHref(id: number, query: URLSearchParams): string {
  const carried = new URLSearchParams()
  for (const name of CARRIED_PARAMS) {
    const value = query.get(name)
    if (value !== null) carried.set(name, value)
  }
  const qs = carried.toString()
  return `${BASE}/${id}${qs ? `?${qs}` : ''}`
}

/** reviews=1：每件商品的评价条数（按 id % 8），有 0 条的。 */
const REVIEW_COUNTS = [3, 0, 5, 1, 4, 0, 6, 2]
/** 页面先显示的条数，其余在「Show all N reviews」后面（reviewPager=1 时在第 2 页的链接后面）。 */
export const REVIEWS_INLINE = 2
const REVIEWERS = ['Mia K.', 'Noah P.', 'Ava R.', 'Liam S.', 'Zoe T.', 'Omar V.', 'Lena W.']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const reviewCount = (id: number): number => REVIEW_COUNTS[id % REVIEW_COUNTS.length]

export interface Review {
  author: string
  /** 1–5 */
  rating: number
  /** ISO 日期（time 的 datetime） */
  date: string
  /** 页面上显示的日期 */
  dateText: string
  text: string
}

/** 商品 id 的第 k 条评价（k 从 0 起）。 */
export function review(id: number, k: number): Review {
  const month = (id + k) % 12
  const day = 1 + ((id * 3 + k * 5) % 28)
  return {
    author: REVIEWERS[(id + k) % REVIEWERS.length],
    rating: 1 + ((id + 2 * k) % 5),
    date: `2026-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    dateText: `${day} ${MONTHS[month]} 2026`,
    text: `Review ${k + 1} of product ${id}: ${k % 2 ? 'works as described, would buy again' : 'arrived quickly, solid build'}.`,
  }
}

export function reviews(id: number): Review[] {
  return Array.from({ length: reviewCount(id) }, (_, k) => review(id, k))
}
