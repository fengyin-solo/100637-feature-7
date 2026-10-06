import type { EntryRow, FeeRow, NoticeRow } from './types'
import { SEED_ROWS } from './seed'
import { batchOf, isDate, rebuildFees } from './billing'

/**
 * 台账迁移与兼容口径：
 * 1. 同管线编号重复登记，只保留最早一版（按入廊日期、再按原始 ID 比较），被合并版本写进备注；
 * 2. 早年缺入廊日期的，并入最早一批（2023-03），按管线编号顺延到月末，备注写清补记出处；
 * 3. 迁移批次按入廊日期所在月份生成，上线前按月分批迁移；
 * 4. 老数据既有结论不改写：结算单由 billing 模块按「原有结论 / 新口径」分别生成。
 */
export const SCHEMA_VERSION = 2
export const EARLIEST_BATCH = '2023-03'

const LAST_PIPELINE_STATUS = '已迁出'

type RawBag = Record<string, EntryRow[]>

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function lastDayOf(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

export function migratePipelines(raw: EntryRow[]): { rows: EntryRow[]; mergedDuplicates: number; backfilled: number } {
  const notes = new Map<number, string[]>()
  const addNote = (id: number, text: string) => {
    const list = notes.get(id) ?? []
    list.push(text)
    notes.set(id, list)
  }

  // 1) 按管线编号去重：空编号不参与合并，保留最早一版。
  const groups = new Map<string, EntryRow[]>()
  const noCode: EntryRow[] = []
  for (const row of raw) {
    const code = String(row['管线编号'] ?? '').trim()
    if (!code) {
      noCode.push(row)
      continue
    }
    const list = groups.get(code) ?? []
    list.push(row)
    groups.set(code, list)
  }

  const survivors: EntryRow[] = []
  let mergedDuplicates = 0
  for (const [code, list] of groups) {
    const ordered = list.slice().sort((a, b) => {
      const da = String(a['入廊日期'] ?? '')
      const db = String(b['入廊日期'] ?? '')
      // 有日期的视为更早；都缺日期再按原始 ID。
      if (da && !db) return -1
      if (!da && db) return 1
      if (da !== db) return da < db ? -1 : 1
      return Number(a.id) - Number(b.id)
    })
    const winner = ordered[0]
    survivors.push(winner)
    if (ordered.length > 1) {
      mergedDuplicates += ordered.length - 1
      const dropped = ordered.slice(1).map((item) => {
        const d = String(item['入廊日期'] ?? '') || '日期缺项'
        return `旧ID${item.id}(${d})`
      })
      addNote(Number(winner.id), `重复登记去重：管线编号 ${code} 保留最早一版，合并 ${dropped.join('、')}`)
    }
  }
  survivors.push(...noCode)

  // 2) 缺入廊日期：并入最早批次，按编号升序顺延到该月末批，备注注明补记出处。
  const missing = survivors
    .filter((row) => !isDate(String(row['入廊日期'] ?? '')))
    .sort((a, b) => String(a['管线编号'] ?? '').localeCompare(String(b['管线编号'] ?? '')))
  const backfillDayStart = lastDayOf(EARLIEST_BATCH) - missing.length + 1
  missing.forEach((row, index) => {
    const day = backfillDayStart + index
    const date = `${EARLIEST_BATCH}-${String(day).padStart(2, '0')}`
    row['入廊日期'] = date
    addNote(
      Number(row.id),
      `早年缺项：纸质台账未登记入廊日期，迁移时补记为 ${date}（出处：《${EARLIEST_BATCH} 入廊移交清册》同批管线）`,
    )
  })

  // 3) 按入廊日期重排（存量台账按入廊日期落位），重新编号并写入迁移批次。
  survivors.sort((a, b) => {
    const da = String(a['入廊日期'] ?? '')
    const db = String(b['入廊日期'] ?? '')
    if (da !== db) return da < db ? -1 : 1
    return Number(a.id) - Number(b.id)
  })

  const rows: EntryRow[] = survivors.map((row, index) => {
    const status = String(row.status ?? '')
    const entryDate = String(row['入廊日期'] ?? '')
    const remarkList = notes.get(Number(row.id)) ?? []
    remarkList.push(`上线前台账迁移：${batchOf(entryDate)} 批次`)
    return {
      id: index + 1,
      status,
      pending: status !== LAST_PIPELINE_STATUS,
      abnormal: Boolean(row.abnormal),
      管线编号: String(row['管线编号'] ?? ''),
      所属舱室: String(row['所属舱室'] ?? ''),
      管线类型: String(row['管线类型'] ?? ''),
      权属单位: String(row['权属单位'] ?? ''),
      入廊日期: entryDate,
      设计容量: String(row['设计容量'] ?? ''),
      对接联系人: String(row['对接联系人'] ?? ''),
      迁移批次: batchOf(entryDate),
      迁出日期: isDate(String(row['迁出日期'] ?? '')) ? String(row['迁出日期']) : '',
      管线状态: status,
      备注: remarkList.join('；'),
    }
  })

  return { rows, mergedDuplicates, backfilled: missing.length }
}

export type Dataset = {
  entries: Record<string, EntryRow[]>
  fees: FeeRow[]
  notices: NoticeRow[]
  version: number
}

/** 首次打开或重置时的整包数据：旧台账播种后立即按新口径迁移。 */
export function freshDataset(): Dataset {
  const entries = clone(SEED_ROWS) as RawBag
  const { rows } = migratePipelines(entries.pipeline ?? [])
  entries.pipeline = rows
  return {
    entries,
    fees: rebuildFees(rows),
    notices: [],
    version: SCHEMA_VERSION,
  }
}

/**
 * 兼容旧版本浏览器里已持久化的数据：
 * 只迁移管线台账并重算结算单，其他模块原样保留；既有状态结论不改写。
 */
export function upgradeDataset(entries: RawBag): Dataset {
  const pipeline = entries.pipeline ?? []
  const alreadyV2 = pipeline.every((row) => String(row['迁移批次'] ?? '') !== '')
  if (alreadyV2) {
    return {
      entries,
      fees: rebuildFees(pipeline),
      notices: [],
      version: SCHEMA_VERSION,
    }
  }
  const { rows } = migratePipelines(pipeline)
  const next = { ...entries, pipeline: rows }
  return {
    entries: next,
    fees: rebuildFees(rows),
    notices: [],
    version: SCHEMA_VERSION,
  }
}
