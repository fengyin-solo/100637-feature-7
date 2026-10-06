import type { EntryRow, FeeRow } from './types'

/**
 * 计费规则集中在这里，页面和数据迁移都引用同一份。
 *
 * 切换日（口径分界）：老数据沿用原有结论，不重算、不改写；
 * 自切换日起的新登记、新月份、新迁出一律走新口径。
 */
export const CUTOVER_DATE = '2026-10-01'

export type FeeStandard = { 入廊费: number; 月服务费: number }

// 新口径收费标准（元）：入廊费一次性收取，服务费按在廊月份计。
const FEE_STANDARDS: Record<string, FeeStandard> = {
  给水管: { 入廊费: 12000, 月服务费: 800 },
  燃气管: { 入廊费: 15000, 月服务费: 900 },
  电力电缆: { 入廊费: 18000, 月服务费: 1100 },
  通信光缆: { 入廊费: 8000, 月服务费: 500 },
  热力管: { 入廊费: 16000, 月服务费: 1000 },
  雨水管: { 入廊费: 14000, 月服务费: 850 },
}

const FALLBACK_STANDARD: FeeStandard = { 入廊费: 12000, 月服务费: 800 }

export function feeStandard(type: string): FeeStandard {
  return FEE_STANDARDS[String(type ?? '').trim()] ?? FALLBACK_STANDARD
}

export function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** 相差整月数：含入廊当月；迁出当月起停计（即计到迁出月的上一月）。 */
export function billedMonths(entryDate: string, endDate: string): number {
  if (!isDate(entryDate) || !isDate(endDate) || endDate < entryDate) {
    return 0
  }
  const start = new Date(`${entryDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  return Math.max(0, months)
}

/** 服务费计到哪个月：迁出管线计到迁出月上一月，在用管线计到当前月。 */
export function feeAsOfDate(row: EntryRow, today: string = todayString()): string {
  const exit = String(row['迁出日期'] ?? '')
  if (isDate(exit)) {
    return exit
  }
  return today
}

/**
 * 早年结算单的账面结论：这些管线在切换日前已迁出、费用早已结清，
 * 迁移时只誊抄旧账，不按新标准重算，结算单上标「原有结论」。
 */
const LEGACY_BILLED: Record<string, { 入廊费: number; 月服务费: number; 月数: number; 备注: string }> = {
  'PIPE-2023-005': { 入廊费: 14000, 月服务费: 900, 月数: 30, 备注: '2025-12 迁出，按旧标准已结清（旧台账誊抄，未重算）' },
  'PIPE-2024-003': { 入廊费: 13000, 月服务费: 800, 月数: 23, 备注: '2026-03 迁出，按旧标准已结清（旧台账誊抄，未重算）' },
}

/**
 * 由一条管线台账生成结算单。
 * - 待登记：占位结算单，费用为 0；
 * - 切换日前已迁出：誊抄旧账（原有结论）；
 * - 其他：按收费标准与在廊月份走新口径。
 */
export function buildFeeRow(row: EntryRow, seq: number, today: string = todayString()): FeeRow {
  const code = String(row['管线编号'] ?? '')
  const entryDate = String(row['入廊日期'] ?? '')
  const exitDate = String(row['迁出日期'] ?? '')
  const status = String(row.status ?? '')
  const legacy = LEGACY_BILLED[code]
  const isExited = status === '已迁出' && isDate(exitDate)

  const base = {
    id: seq,
    pipelineId: Number(row.id),
    管线编号: code,
    权属单位: String(row['权属单位'] ?? ''),
    所属舱室: String(row['所属舱室'] ?? ''),
    管线类型: String(row['管线类型'] ?? ''),
    入廊日期: entryDate,
    迁出日期: isDate(exitDate) ? exitDate : '',
  }

  if (status === '待登记' || !isDate(entryDate)) {
    return {
      ...base,
      入廊费金额: 0,
      计费月数: 0,
      服务费金额: 0,
      合计金额: 0,
      计费状态: '计费中',
      计费口径: '新口径',
      备注: '尚未完成入廊登记，入廊费与服务费暂未起计',
    }
  }

  if (isExited && legacy && exitDate < CUTOVER_DATE) {
    const serviceFee = legacy.月服务费 * legacy.月数
    return {
      ...base,
      入廊费金额: legacy.入廊费,
      计费月数: legacy.月数,
      服务费金额: serviceFee,
      合计金额: legacy.入廊费 + serviceFee,
      计费状态: '已停计',
      计费口径: '原有结论',
      备注: legacy.备注,
    }
  }

  const standard = feeStandard(base.管线类型)
  const asOf = isExited ? exitDate : today
  const months = billedMonths(entryDate, asOf)
  const serviceFee = standard.月服务费 * months
  return {
    ...base,
    入廊费金额: standard.入廊费,
    计费月数: months,
    服务费金额: serviceFee,
    合计金额: standard.入廊费 + serviceFee,
    计费状态: isExited ? '已停计' : '计费中',
    计费口径: '新口径',
    备注: isExited
      ? `${exitDate.slice(0, 7)} 迁出，服务费计至迁出上月，此后停计`
      : `入廊费一次性计收，服务费计至 ${asOf.slice(0, 7)}`,
  }
}

export function rebuildFees(rows: EntryRow[], today: string = todayString()): FeeRow[] {
  return rows
    .slice()
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((row, index) => buildFeeRow(row, index + 1, today))
}

/** 月份批次：用于上线前按月份分批迁移。 */
export function batchOf(entryDate: string): string {
  return isDate(entryDate) ? entryDate.slice(0, 7) : '2023-03'
}

export function todayString(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
