import { listFees } from '@/data/local-store'
import type { FeeRow } from '@/data/types'
import { CUTOVER_DATE } from '@/data/billing'

export { CUTOVER_DATE }

export type FeeFilters = {
  权属单位: string
  计费状态: string
}

export type FeeSummary = {
  items: FeeRow[]
  total: number
  billingCount: number
  stoppedCount: number
  receivableTotal: number
  options: { 权属单位: string[] }
}

export function queryFees(filters: FeeFilters): FeeSummary {
  const items = listFees().filter((row) => {
    if (filters.权属单位 && row.权属单位 !== filters.权属单位) {
      return false
    }
    if (filters.计费状态 && row.计费状态 !== filters.计费状态) {
      return false
    }
    return true
  })
  const all = listFees()
  return {
    items,
    total: items.length,
    billingCount: all.filter((row) => row.计费状态 === '计费中').length,
    stoppedCount: all.filter((row) => row.计费状态 === '已停计').length,
    // 在廊应收：计费中管线的入廊费与服务费合计
    receivableTotal: all
      .filter((row) => row.计费状态 === '计费中')
      .reduce((sum, row) => sum + row.合计金额, 0),
    options: {
      权属单位: [...new Set(all.map((row) => row.权属单位).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'zh-Hans-CN'),
      ),
    },
  }
}
