/**
 * 演练场 optional-perk-slots 的标准答案：第 n 张卡片带哪些可选条目、剩几间。
 *
 * 单独成文件而不是写在 route.ts 里：Next.js 的 route 模块只允许导出 GET / POST /
 * dynamic 这类固定名字，多导出一个函数 `next build` 的类型检查就会失败（本地 tsgo 查不出），
 * 2026-11-13 main 上的 Cloudflare 构建就是这样连续失败、生产停在旧版本的。
 */
export interface PerkSlots {
  meal: boolean
  refund: boolean
  payLater: boolean
  scarcity: boolean
}

/** 第 n 张卡片（从 1 起）有哪些可选条目。导出给测试用，标准答案由它算出。 */
export function perkSlotsFor(n: number): PerkSlots {
  return {
    meal: n % 4 !== 0,
    refund: n % 5 !== 0,
    payLater: n % 3 !== 0,
    scarcity: n % 2 === 1,
  }
}

/** 第 n 张卡片的剩余间数（1–6）。 */
export function roomsLeftFor(n: number): number {
  return (n % 6) + 1
}
