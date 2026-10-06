import { SEED_ROWS } from './seed'
import { migrateBundle, SCHEMA_VERSION, type MigrationLog } from './migration'
import type { EntryRow } from './types'

// 本地持久化：台账数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'urban-utility-tunnel:entries'
const VERSION_KEY = 'urban-utility-tunnel:schema-version'
const MIGRATION_LOG_KEY = 'urban-utility-tunnel:migration-log'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function write(data: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    window.localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const initialized = { ...fallback }
    const { data, log } = runMigration(initialized, 0)
    write(data)
    if (log) {
      window.localStorage.setItem(MIGRATION_LOG_KEY, JSON.stringify([log]))
    }
    return data
  }
  let parsed: Record<string, EntryRow[]>
  try {
    parsed = JSON.parse(raw) as Record<string, EntryRow[]>
  } catch {
    const repaired = { ...fallback }
    write(repaired)
    return repaired
  }

  // 新模块、新种子键补齐到存量包里，但不覆盖用户已有数据。
  const merged: Record<string, EntryRow[]> = { ...fallback, ...parsed }

  const version = Number(window.localStorage.getItem(VERSION_KEY) ?? '1')
  if (version < SCHEMA_VERSION) {
    const { data, log } = runMigration(merged, version)
    write(data)
    if (log) {
      const prev = readMigrationLog()
      window.localStorage.setItem(MIGRATION_LOG_KEY, JSON.stringify([...prev, log]))
    }
    return data
  }
  return merged
}

function runMigration(
  bundle: Record<string, EntryRow[]>,
  version: number,
): { data: Record<string, EntryRow[]>; log: MigrationLog | null } {
  return migrateBundle(bundle, version)
}

export function readMigrationLog(): MigrationLog[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  try {
    const raw = window.localStorage.getItem(MIGRATION_LOG_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as MigrationLog[] | MigrationLog
    // 兼容早期误写成单对象的日志，读的时候顺手修成数组。
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 管线台账重置后按同一套迁移规则重放（去重、补缺、分批），保证演示数据口径一致。 */
export function resetPipelinesWithMigration(): EntryRow[] {
  const fresh = clone(SEED_ROWS['pipeline'] ?? [])
  const { data } = migrateBundle({ pipeline: fresh }, 0)
  saveRows('pipeline', data['pipeline'] ?? [])
  return data['pipeline'] ?? []
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function schemaVersion(): number {
  return SCHEMA_VERSION
}
