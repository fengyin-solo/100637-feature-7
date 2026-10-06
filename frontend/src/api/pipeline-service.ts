import {
  listFees,
  listNotices,
  listRows,
  saveFees,
  saveNotices,
  saveRows,
} from '@/data/local-store'
import { buildFeeRow, todayString } from '@/data/billing'
import type { ActionResult, EntryRow, FeeRow, NoticeRow } from '@/data/types'

export const PIPELINE_KEY = 'pipeline'
const PAGE_SIZE = 8

export type PipelineFilters = {
  权属单位: string
  所属舱室: string
  管线类型: string
  /** 默认只看在用（非已迁出）；勾选后把已迁出的一并捞出 */
  含已迁出: boolean
}

export const EMPTY_FILTERS: PipelineFilters = {
  权属单位: '',
  所属舱室: '',
  管线类型: '',
  含已迁出: false,
}

export type PipelinePage = {
  items: EntryRow[]
  total: number
  page: number
  size: number
  pageCount: number
  /** 过滤后的全部在用/含迁出条数，页脚总条数与表格同源 */
  inUseCount: number
  exitedCount: number
  /** 当前过滤结果里各状态条数（图例与总条数同源） */
  statusCounts: Record<string, number>
  options: { 权属单位: string[]; 所属舱室: string[]; 管线类型: string[] }
}

export function distinctField(field: keyof PipelineFilters): string[] {
  const values = listRows(PIPELINE_KEY)
    .map((row) => String(row[field as string] ?? '').trim())
    .filter(Boolean)
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

/** 过滤只负责收窄，不重排：保持台账原次序（按入廊日期落位的顺序）。 */
export function applyPipelineFilters(rows: EntryRow[], filters: PipelineFilters): EntryRow[] {
  return rows.filter((row) => {
    if (!filters.含已迁出 && String(row.status) === '已迁出') {
      return false
    }
    if (filters.权属单位 && String(row['权属单位'] ?? '') !== filters.权属单位) {
      return false
    }
    if (filters.所属舱室 && String(row['所属舱室'] ?? '') !== filters.所属舱室) {
      return false
    }
    if (filters.管线类型 && String(row['管线类型'] ?? '') !== filters.管线类型) {
      return false
    }
    return true
  })
}

export function queryPipelines(filters: PipelineFilters, page = 1): PipelinePage {
  const all = listRows(PIPELINE_KEY)
  const matched = applyPipelineFilters(all, filters)
  const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE))
  const safePage = Math.min(Math.max(1, page), pageCount)
  const start = (safePage - 1) * PAGE_SIZE
  return {
    items: matched.slice(start, start + PAGE_SIZE),
    total: matched.length,
    page: safePage,
    size: PAGE_SIZE,
    pageCount,
    inUseCount: all.filter((row) => String(row.status) !== '已迁出').length,
    exitedCount: all.filter((row) => String(row.status) === '已迁出').length,
    statusCounts: ['待登记', '已入廊', '运行中', '已迁出'].reduce<Record<string, number>>(
      (acc, status) => {
        acc[status] = matched.filter((row) => String(row.status) === status).length
        return acc
      },
      {},
    ),
    options: {
      权属单位: distinctField('权属单位'),
      所属舱室: distinctField('所属舱室'),
      管线类型: distinctField('管线类型'),
    },
  }
}

/** 某条管线在当前过滤结果里的页码：回到这页还停在那一条。 */
export function pageOfPipeline(pipelineId: number, filters: PipelineFilters): number {
  const matched = applyPipelineFilters(listRows(PIPELINE_KEY), filters)
  const index = matched.findIndex((row) => Number(row.id) === pipelineId)
  if (index < 0) {
    return 1
  }
  return Math.floor(index / PAGE_SIZE) + 1
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) ?? 0), 0) + 1
}

function nextNoticeId(rows: NoticeRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) ?? 0), 0) + 1
}

function nextFeeId(rows: FeeRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) ?? 0), 0) + 1
}

export type PipelineDraft = {
  管线编号: string
  所属舱室: string
  管线类型: string
  权属单位: string
  入廊日期: string
  设计容量: string
  对接联系人: string
}

function pushNotice(notice: Omit<NoticeRow, 'id' | '时间' | '来源' | '处理状态'>): void {
  const notices = listNotices()
  const row: NoticeRow = {
    id: nextNoticeId(notices),
    时间: new Date().toISOString().slice(0, 16).replace('T', ' '),
    来源: '管线台账',
    处理状态: '待处理',
    ...notice,
  }
  saveNotices([...notices, row])
}

function syncFee(row: EntryRow): void {
  const fees = listFees()
  const index = fees.findIndex((fee) => fee.pipelineId === Number(row.id))
  const nextFee = buildFeeRow(row, index >= 0 ? fees[index].id : nextFeeId(fees))
  if (index >= 0) {
    const next = [...fees]
    next[index] = nextFee
    saveFees(next)
  } else {
    saveFees([...fees, nextFee])
  }
}

/**
 * 登记入廊管线：同一管线编号只认第一次落库，之后整笔按重复退回。
 * 同一笔重复提交（编号已存在）不会产生第二条数据。
 */
export function registerPipeline(draft: PipelineDraft): ActionResult & { id?: number } {
  const code = draft.管线编号.trim()
  const rows = listRows(PIPELINE_KEY)
  if (!code) {
    return { ok: false, message: '管线编号不能为空' }
  }
  if (rows.some((row) => String(row['管线编号'] ?? '') === code)) {
    return { ok: false, message: `管线编号 ${code} 已登记过，本次提交按重复整笔退回，只保留第一次落库的记录` }
  }
  for (const field of ['所属舱室', '管线类型', '权属单位', '入廊日期'] as const) {
    if (!draft[field].trim()) {
      return { ok: false, message: `${field}不能为空` }
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.入廊日期)) {
    return { ok: false, message: '入廊日期格式应为 YYYY-MM-DD' }
  }

  const row: EntryRow = {
    id: nextId(rows),
    status: '待登记',
    pending: true,
    abnormal: false,
    管线编号: code,
    所属舱室: draft.所属舱室.trim(),
    管线类型: draft.管线类型.trim(),
    权属单位: draft.权属单位.trim(),
    入廊日期: draft.入廊日期.trim(),
    设计容量: draft.设计容量.trim(),
    对接联系人: draft.对接联系人.trim(),
    迁移批次: draft.入廊日期.slice(0, 7),
    迁出日期: '',
    管线状态: '待登记',
    备注: '切换日后新登记',
  }
  saveRows(PIPELINE_KEY, [...rows, row])
  syncFee(row)
  pushNotice({
    管线编号: code,
    权属单位: draft.权属单位.trim(),
    类别: '登记入廊',
    内容: `管线 ${code}（${draft.管线类型.trim()}，${draft.所属舱室.trim()}）完成登记，待入廊确认`,
  })
  return { ok: true, message: `管线 ${code} 登记成功`, id: Number(row.id) }
}

/** 管线状态流转（登记入廊 / 确认运行 / 办理迁出），迁出联动结算停计与值班清单。 */
export function changePipelineStatus(id: number, action: '登记入廊' | '确认运行' | '办理迁出'): ActionResult & { id?: number } {
  const rows = listRows(PIPELINE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的入廊管线` }
  }
  const current = rows[index]
  const flow: Record<string, { from: string[]; to: string }> = {
    登记入廊: { from: ['待登记'], to: '已入廊' },
    确认运行: { from: ['已入廊'], to: '运行中' },
    办理迁出: { from: ['已入廊', '运行中'], to: '已迁出' },
  }
  const step = flow[action]
  if (!step.from.includes(String(current.status))) {
    return { ok: false, message: `管线当前为「${current.status}」，不能执行「${action}」` }
  }

  const updated: EntryRow = {
    ...current,
    status: step.to,
    pending: step.to !== '已迁出',
    管线状态: step.to,
  }
  if (action === '办理迁出') {
    updated['迁出日期'] = todayString()
    updated['备注'] = `${String(current['备注'] ?? '').replace(/；?$/, '')}；${updated['迁出日期']} 办理迁出，默认从在用结果收起`
  }

  const next = [...rows]
  next[index] = updated
  saveRows(PIPELINE_KEY, next)
  syncFee(updated)

  if (action === '办理迁出') {
    pushNotice({
      管线编号: String(updated['管线编号'] ?? ''),
      权属单位: String(updated['权属单位'] ?? ''),
      类别: '办理迁出',
      内容: `管线 ${String(updated['管线编号'] ?? '')} 于 ${updated['迁出日期']} 迁出，入廊费与服务费自迁出当月起停计`,
    })
  }
  return { ok: true, message: `管线已${action}，当前状态「${step.to}」`, id }
}

/** 上报管线问题：落到值班清单的遗留事项，两处条数取同一来源。 */
export function reportPipelineIssue(id: number, description: string): ActionResult {
  const text = description.trim()
  if (!text) {
    return { ok: false, message: '问题描述不能为空' }
  }
  const row = listRows(PIPELINE_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的入廊管线` }
  }
  pushNotice({
    管线编号: String(row['管线编号'] ?? ''),
    权属单位: String(row['权属单位'] ?? ''),
    类别: '上报问题',
    内容: `管线 ${String(row['管线编号'] ?? '')}（${String(row['所属舱室'] ?? '')}）：${text}`,
  })
  return { ok: true, message: '问题已上报并同步到运维值班遗留清单' }
}

/** 值班侧关闭遗留事项后同步状态。 */
export function closeNotice(id: number): ActionResult {
  const notices = listNotices()
  const index = notices.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条同步事项' }
  }
  const next = [...notices]
  next[index] = { ...next[index], 处理状态: '已关闭' }
  saveNotices(next)
  return { ok: true, message: '遗留事项已关闭' }
}

export function pendingIssueCount(): number {
  return listNotices().filter((item) => item.类别 === '上报问题' && item.处理状态 === '待处理').length
}
