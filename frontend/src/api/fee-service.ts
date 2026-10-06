import { listRows } from '@/data/local-store'
import { SWITCH_DATE } from '@/data/migration'
import type { PipelineFeeRow } from '@/data/types'

/**
 * 费用结算单完全由管线台账派生：台账一变，结算这边就能看到，
 * 不存在两边对不上的情况（条数恒等于管线台账条数）。
 */
export function listFeeSettlements(owner = ''): PipelineFeeRow[] {
  return listRows('pipeline')
    .slice()
    .sort((a, b) => Number(a.id) - Number(b.id))
    .filter((row) => !owner.trim() || String(row['权属单位'] ?? '') === owner.trim())
    .map((row) => {
      const status = String(row.status)
      const movedOut = status === '已迁出'
      const moveDate = String(row['迁出日期'] ?? '')
      // 新口径从切换之日起算：切换当日及以后迁出的按新口径停计；此前的迁出沿用老结论。
      const newScope = movedOut && moveDate && moveDate >= SWITCH_DATE
      const no = String(row['管线编号'] ?? '')
      return {
        settleNo: `FEE-${String(row.id).padStart(4, '0')}`,
        pipelineId: Number(row.id),
        pipelineNo: no,
        chamber: String(row['所属舱室'] ?? ''),
        pipelineType: String(row['管线类型'] ?? ''),
        owner: String(row['权属单位'] ?? ''),
        entryDate: String(row['入廊日期'] ?? ''),
        moveOutDate: moveDate,
        entryFeeStatus: movedOut
          ? newScope
            ? '入廊费已结清（迁出核销）'
            : '入廊费历史结论保留'
          : '入廊费已计收',
        serviceFeeStatus: movedOut
          ? newScope
            ? `服务费已停计（自${moveDate}迁出当月）`
            : '服务费历史停计，沿用原结论'
          : '服务费计费中',
        ruleScope: !movedOut
          ? `现行口径（${SWITCH_DATE} 切换后）`
          : newScope
            ? `新口径（${SWITCH_DATE} 起迁出停计）`
            : '老口径，沿用既有结论不改写',
        pipelineStatus: status,
      }
    })
}

export function feeOwners(): string[] {
  const owners = new Set<string>()
  for (const row of listRows('pipeline')) {
    const owner = String(row['权属单位'] ?? '').trim()
    if (owner) {
      owners.add(owner)
    }
  }
  return [...owners].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

export function feeStats(owner = '') {
  const rows = listFeeSettlements(owner)
  return {
    total: rows.length,
    billing: rows.filter((row) => row.pipelineStatus !== '已迁出').length,
    stopped: rows.filter((row) => row.serviceFeeStatus.startsWith('服务费已停计')).length,
    historical: rows.filter((row) => row.ruleScope.startsWith('老口径')).length,
  }
}

export { SWITCH_DATE }
