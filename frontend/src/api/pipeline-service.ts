import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, saveRows } from '@/data/local-store'
import {
  appendLedgerSync,
  findSubmission,
  rememberSubmission,
  addIssue,
} from '@/data/collab-store'
import { SWITCH_DATE } from '@/data/migration'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'

const KEY = 'pipeline'

export type PipelineFilters = {
  权属单位?: string
  所属舱室?: string
  管线类型?: string
}

export type PipelineListOptions = {
  /** 默认 false：已迁出的管线从在用结果里收起来；true 时单独捞出来看。 */
  includeMovedOut?: boolean
  page?: number
  size?: number
}

export const PAGE_SIZE = 8

export const FILTER_FIELDS = ['权属单位', '所属舱室', '管线类型'] as const

/** 收窄后的可选项直接取自现存台账，避免选了没有数据的组合。 */
export function pipelineOptions(field: (typeof FILTER_FIELDS)[number]): string[] {
  const values = new Set<string>()
  for (const row of listRows(KEY)) {
    const value = String(row[field] ?? '').trim()
    if (value) {
      values.add(value)
    }
  }
  return [...values].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

/**
 * 台账原次序：迁移、去重之后始终按登记落库的 id 升序，过滤只收窄不改次序。
 */
export function listPipelines(
  filters: PipelineFilters = {},
  options: PipelineListOptions = {},
): PageResult {
  const includeMovedOut = options.includeMovedOut ?? false
  const pairs = FILTER_FIELDS.map((field) => [field, String(filters[field] ?? '').trim()] as const)
  const matched = listRows(KEY)
    .slice()
    .sort((a, b) => Number(a.id) - Number(b.id))
    .filter((row) => (includeMovedOut ? true : String(row.status) !== '已迁出'))
    .filter((row) => pairs.every(([field, value]) => !value || String(row[field] ?? '').trim() === value))

  const total = matched.length
  const size = options.size ?? PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(total / size))
  const page = Math.min(Math.max(1, options.page ?? 1), pageCount)
  const items = matched.slice((page - 1) * size, page * size)
  return { items, total, page, size }
}

export type PipelineCreateInput = {
  token: string
  管线编号: string
  所属舱室: string
  管线类型: string
  权属单位: string
  入廊日期: string
  设计容量: string
  对接联系人: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function nowStamp(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

/**
 * 登记入廊管线：
 * - 同一笔重复提交（相同提交令牌）整笔按重复退回，只认第一次落库；
 * - 同管线编号已存在也不允许再建（存量重复已在迁移时按最早一版去重）。
 */
export function createPipeline(input: PipelineCreateInput): ActionResult & { id?: number } {
  const token = input.token.trim()
  if (!token) {
    return { ok: false, message: '缺少提交令牌，无法判定是否重复提交' }
  }
  const repeated = findSubmission(token)
  if (repeated) {
    return {
      ok: false,
      message: `同一笔登记重复提交，已按重复退回；首次提交已于 ${repeated.at} 落库（${repeated.pipelineNo}）`,
    }
  }
  const no = input.管线编号.trim()
  if (!no) {
    return { ok: false, message: '管线编号不能为空' }
  }
  const rows = listRows(KEY)
  if (rows.some((row) => String(row['管线编号'] ?? '').trim() === no)) {
    rememberSubmission(token, no)
    return {
      ok: false,
      message: `管线编号 ${no} 已登记，按管线编号去重，本笔整笔退回；存量重复只保留最早一版`,
    }
  }

  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const entryDate = input.入廊日期.trim()
  const row: EntryRow = {
    id,
    status: entryDate ? '已入廊' : '待登记',
    pending: true,
    abnormal: false,
    管线编号: no,
    所属舱室: input.所属舱室.trim(),
    管线类型: input.管线类型.trim(),
    权属单位: input.权属单位.trim(),
    入廊日期: entryDate,
    设计容量: input.设计容量.trim(),
    对接联系人: input.对接联系人.trim(),
    迁出日期: '',
    备注: '',
    登记时间: nowStamp(),
  }
  saveRows(KEY, [...rows, row])
  rememberSubmission(token, no)
  appendLedgerSync({
    kind: '管线登记',
    text: `新登记入廊管线 ${no}（${row['权属单位']}，${row['所属舱室']}），状态「${row.status}」`,
  })
  return { ok: true, message: `管线 ${no} 已登记落库`, id }
}

/**
 * 办理迁出：记迁出日期（默认今天，新口径从切换之日起算），
 * 结算联动与值班清单同步由 fee / collab 侧按台账状态派生。
 */
export function moveOutPipeline(id: number): ActionResult {
  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的入廊管线` }
  }
  const current = rows[index]
  if (String(current.status) === '已迁出') {
    return { ok: false, message: `管线 ${current['管线编号']} 已是「已迁出」，不用重复操作` }
  }
  const date = today()
  const next: EntryRow = {
    ...current,
    status: '已迁出',
    pending: false,
    迁出日期: date,
  }
  const all = [...rows]
  all[index] = next
  saveRows(KEY, all)
  appendLedgerSync({
    kind: '管线迁出',
    text:
      date >= SWITCH_DATE
        ? `管线 ${current['管线编号']} 办理迁出（${date}），按新口径自迁出当月停计入廊费/服务费，结算单已同步标记`
        : `管线 ${current['管线编号']} 办理迁出（${date}），沿用切换前历史结算结论`,
  })
  return {
    ok: true,
    message:
      date >= SWITCH_DATE
        ? `管线 ${current['管线编号']} 已迁出，权属单位结算单自 ${date} 起停计费`
        : `管线 ${current['管线编号']} 已迁出，结算沿用历史结论`,
  }
}

/** 管线页上报问题：落到与值班、巡检共用的遗留清单，两处条数同源。 */
export function reportPipelineIssue(
  id: number,
  content: string,
): ActionResult {
  const rows = listRows(KEY)
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的入廊管线` }
  }
  const text = content.trim()
  if (!text) {
    return { ok: false, message: '问题描述不能为空' }
  }
  addIssue({
    source: '入廊管线',
    sourceNo: String(row['管线编号'] ?? id),
    chamber: String(row['所属舱室'] ?? ''),
    content: text,
  })
  return { ok: true, message: `管线 ${row['管线编号']} 的问题已落入值班遗留清单` }
}

export { SWITCH_DATE }

export function pipelineMeta() {
  return MODULE_BY_KEY.get(KEY)!
}
