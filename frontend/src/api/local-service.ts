import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { addIssue } from '@/data/collab-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 动作成功后的跨模块联动：巡检「上报问题」落到值班那边的遗留清单，两处共用同一份数据。
const AFTER_ACTION: Record<string, (row: EntryRow) => void> = {
  'patrol:上报问题': (row) =>
    addIssue({
      source: '廊内巡检',
      sourceNo: String(row['巡检编号'] ?? row.id),
      chamber: String(row['巡检路线'] ?? ''),
      content: `巡检任务 ${row['巡检编号'] ?? row.id} 上报问题，待值班跟进`,
    }),
  'duty:登记遗留': (row) =>
    addIssue({
      source: '值班交接',
      sourceNo: String(row['交接编号'] ?? row.id),
      chamber: '',
      content: `值班交接 ${row['交接编号'] ?? row.id} 登记遗留：${row['交接事项'] ?? ''}`,
    }),
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export type ListOptions = {
  /** 这些字段按全等收窄（下拉选择），其余字段仍走包含匹配。 */
  exact?: string[]
  page?: number
  size?: number
}

export function listEntries(
  key: string,
  filters: Record<string, string> = {},
  options: ListOptions = {},
): PageResult {
  const exactFields = new Set(options.exact ?? [])
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  let matched = listRows(key)
  if (pairs.length > 0) {
    matched = matched.filter((row) =>
      pairs.every(([field, value]) => {
        const cell = String(row[field] ?? '').trim()
        const wanted = value.trim()
        return exactFields.has(field) ? cell === wanted : cell.includes(wanted)
      }),
    )
  }
  const size = options.size && options.size > 0 ? options.size : matched.length
  const pageCount = Math.max(1, Math.ceil(matched.length / size))
  const page = Math.min(Math.max(1, options.page ?? 1), pageCount)
  const items = matched.slice((page - 1) * size, page * size)
  return { items, total: matched.length, page, size: options.size && options.size > 0 ? size : matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  AFTER_ACTION[`${key}:${action}`]?.(updated)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()]
    .filter((meta) => !meta.derived)
    .map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
