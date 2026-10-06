import type { EntryRow } from './types'

/**
 * 台账切换（新口径）之日。
 * - 此日之前已经形成的结论（状态、是否迁出、结算口径）一律沿用，不回改；
 * - 此日起办理迁出的管线，结算按新口径：入廊费结清/确认，服务费自迁出当月停计。
 */
export const SWITCH_DATE = '2026-10-06'

/** localStorage 里业务数据的结构版本：版本落后就先跑迁移再用。 */
export const SCHEMA_VERSION = 2

export type MigrationLog = {
  at: string
  removedDuplicates: { 管线编号: string; keptId: number; droppedId: number; reason: string }[]
  backfilledEntryDates: { id: number; 管线编号: string; 入廊日期: string; 依据: string }[]
  batches: { 批次: string; 数量: number }[]
  preservedConclusions: number
}

const BATCH_BASE_MONTH = '2024-01'
const EARLIEST_FALLBACK_MONTH = '2025-01'

function text(value: unknown): string {
  return String(value ?? '').trim()
}

/** 把 YYYY-MM 或 YYYY-MM-DD 折算成自 0 年起的月份序号，便于按月顺推。 */
function monthIndex(yyyyMm: string): number {
  const [year, month] = yyyyMm.split('-').map((part) => Number(part))
  return (year || 0) * 12 + (month || 1) - 1
}

function monthLabel(index: number): string {
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

function shiftMonth(yyyyMm: string, delta: number): string {
  return monthLabel(monthIndex(yyyyMm) + delta)
}

/** 入廊日期落在哪个迁移批次：上线前的台账按月份分批迁移。 */
export function migrationBatchOf(entryDate: string): string {
  const month = (entryDate || '').slice(0, 7)
  if (!month) {
    return `待补日期批次（基准月${EARLIEST_FALLBACK_MONTH}）`
  }
  return `${month}月台账批次（基准自${BATCH_BASE_MONTH}起）`
}

/**
 * 管线存量迁移：
 * 1. 同管线编号重复登记，只留最早一版（登记时间最早，时间相同留 id 最小）；
 * 2. 早年缺入廊日期的，按「同舱室最早已知入廊月」为锚点、编号升序逐月回填，
 *    同舱室没有任何日期可参考时，以 2025-01 为锚点；回填值在备注里写清出处；
 * 3. 全部存量按入廊日期归到月份批次；
 * 4. 既有状态、迁出标记等结论一律不改写。
 */
export function migratePipelines(rows: EntryRow[], log: MigrationLog): EntryRow[] {
  const order = new Map<string, number>()
  rows.forEach((row, index) => order.set(String(row.id), index))

  const earliest = new Map<string, EntryRow>()
  for (const row of rows) {
    const no = text(row['管线编号'])
    if (!no) {
      continue
    }
    const kept = earliest.get(no)
    if (!kept) {
      earliest.set(no, row)
      continue
    }
    const registeredA = text(kept['登记时间'])
    const registeredB = text(row['登记时间'])
    const takeNew =
      registeredB < registeredA ||
      (registeredB === registeredA && Number(row.id) < Number(kept.id))
    const winner = takeNew ? row : kept
    const loser = takeNew ? kept : row
    earliest.set(no, winner)
    log.removedDuplicates.push({
      管线编号: no,
      keptId: Number(winner.id),
      droppedId: Number(loser.id),
      reason: '同一管线编号重复登记，按登记时间最早保留，重复版整笔剔除',
    })
  }

  const deduped = [...earliest.values()].sort(
    (a, b) =>
      (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0),
  )

  // 每个舱室的锚点月：取该舱室已知最早入廊月；没有则用兜底锚点月。
  const anchorByChamber = new Map<string, string>()
  for (const row of deduped) {
    const chamber = text(row['所属舱室'])
    const month = text(row['入廊日期']).slice(0, 7)
    if (!chamber || !month) {
      continue
    }
    const prev = anchorByChamber.get(chamber)
    if (!prev || month < prev) {
      anchorByChamber.set(chamber, month)
    }
  }

  // 缺日期的按编号升序，从锚点月次月开始逐月补，备注写明出处。
  // 「待登记」管线尚未实际入廊，入廊日期留空是业务真实状态，不在回填范围。
  const missingByChamber = new Map<string, EntryRow[]>()
  for (const row of deduped) {
    if (!text(row['入廊日期']) && String(row.status) !== '待登记') {
      const chamber = text(row['所属舱室'])
      const list = missingByChamber.get(chamber) ?? []
      list.push(row)
      missingByChamber.set(chamber, list)
    }
  }
  const filledDate = new Map<number, string>()
  for (const [chamber, list] of missingByChamber) {
    const anchor = anchorByChamber.get(chamber) ?? EARLIEST_FALLBACK_MONTH
    list.sort((a, b) => text(a['管线编号']).localeCompare(text(b['管线编号']), 'zh-Hans-CN'))
    list.forEach((row, index) => {
      const month = shiftMonth(anchor, index + 1)
      const date = `${month}-01`
      filledDate.set(Number(row.id), date)
      log.backfilledEntryDates.push({
        id: Number(row.id),
        管线编号: text(row['管线编号']),
        入廊日期: date,
        依据: anchorByChamber.get(chamber)
          ? `早年台账缺入廊日期，按同舱室「${chamber}」最早已知入廊月 ${anchor} 起、管线编号升序逐月补录`
          : `早年台账缺入廊日期，「${chamber}」无日期可参考，按兜底锚点月 ${anchor} 起、管线编号升序逐月补录`,
      })
    })
  }

  const migrated = deduped.map((row) => {
    const next: EntryRow = { ...row }
    const filled = filledDate.get(Number(row.id))
    if (filled) {
      next['入廊日期'] = filled
      const basis = log.backfilledEntryDates.find((item) => item.id === Number(row.id))?.依据 ?? ''
      const note = `迁移补录：入廊日期${filled}，${basis}`
      next['备注'] = text(next['备注']) ? `${text(next['备注'])}；${note}` : note
    }
    const batch = migrationBatchOf(text(next['入廊日期']))
    const originNote = text(next['备注'])
    next['备注'] = originNote
      ? `${originNote}；迁移批次：${batch}`
      : `迁移批次：${batch}`
    return next
  })

  const counters = new Map<string, number>()
  for (const row of migrated) {
    const batch = migrationBatchOf(text(row['入廊日期']))
    counters.set(batch, (counters.get(batch) ?? 0) + 1)
  }
  log.batches = [...counters.entries()]
    .map(([批次, 数量]) => ({ 批次, 数量 }))
    .sort((a, b) => a.批次.localeCompare(b.批次, 'zh-Hans-CN'))
  log.preservedConclusions = migrated.length

  return migrated
}

type StorageBundle = Record<string, EntryRow[]>

/**
 * 对整包数据跑版本迁移。只处理管线台账：去重、补缺、分批；
 * 其它模块与既有状态结论保持原样。
 */
export function migrateBundle(
  bundle: StorageBundle,
  version: number,
): { data: StorageBundle; log: MigrationLog | null } {
  const log: MigrationLog = {
    at: new Date().toISOString(),
    removedDuplicates: [],
    backfilledEntryDates: [],
    batches: [],
    preservedConclusions: 0,
  }
  let changed = false
  const data: StorageBundle = { ...bundle }

  if (version < 2 && Array.isArray(data['pipeline'])) {
    data['pipeline'] = migratePipelines(data['pipeline'], log)
    changed = true
  }

  return { data, log: changed ? log : null }
}
