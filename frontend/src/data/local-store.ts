import type { EntryRow, FeeRow, NoticeRow } from './types'
import { freshDataset, SCHEMA_VERSION, upgradeDataset, type Dataset } from './migrate'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'urban-utility-tunnel:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type Persisted = {
  version: number
  entries: Record<string, EntryRow[]>
  fees: FeeRow[]
  notices: NoticeRow[]
}

function readStorage(): Dataset {
  const fallback = freshDataset()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Persisted | Record<string, EntryRow[]>
    // v2：整包带 version 与 entries；v1：直接是「模块 -> 行」的平铺旧结构，走一次迁移。
    const isV2 = typeof (parsed as Persisted).version === 'number' && (parsed as Persisted).entries
    const dataset: Dataset = isV2
      ? (parsed as Persisted).version === SCHEMA_VERSION
        ? (parsed as Dataset)
        : upgradeDataset((parsed as Persisted).entries ?? {})
      : upgradeDataset(parsed as Record<string, EntryRow[]>)
    persist(dataset)
    return dataset
  } catch {
    persist(fallback)
    return fallback
  }
}

function persist(dataset: Dataset): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset))
  }
}

let cache: Dataset | null = null

export function dataset(): Dataset {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return dataset().entries
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next: Dataset = { ...dataset(), entries: { ...dataset().entries, [key]: rows } }
  cache = next
  persist(next)
}

export function listFees(): FeeRow[] {
  return dataset().fees
}

export function saveFees(rows: FeeRow[]): void {
  const next: Dataset = { ...dataset(), fees: rows }
  cache = next
  persist(next)
}

export function listNotices(): NoticeRow[] {
  return dataset().notices
}

export function saveNotices(rows: NoticeRow[]): void {
  const next: Dataset = { ...dataset(), notices: rows }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const fresh = freshDataset()
  const rows = clone(fresh.entries[key] ?? [])
  // 重置管线台账：回到迁移后的初始台账（重复去重、缺项回填、按月分批都已落好），
  // 结算单与值班同步事项一并回到初始包；想看迁移前的原始数据请清 localStorage。
  if (key === 'pipeline') {
    const next: Dataset = {
      ...dataset(),
      entries: { ...dataset().entries, pipeline: clone(fresh.entries.pipeline) },
      fees: clone(fresh.fees),
      notices: [],
    }
    cache = next
    persist(next)
    return rows
  }
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
