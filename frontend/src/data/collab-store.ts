import type {
  IssueRow,
  IssueSource,
  LedgerSyncRow,
  PipelineViewState,
  SubmissionRecord,
} from './types'

/**
 * 跨模块协作数据：遗留问题清单、台账同步事项、提交幂等留痕、管线页视图状态。
 * 与业务台账分开存，模块各取各的，但来源是同一份，保证两处条数天然一致。
 */
const ISSUES_KEY = 'urban-utility-tunnel:issues'
const SYNC_KEY = 'urban-utility-tunnel:ledger-sync'
const SUBMISSIONS_KEY = 'urban-utility-tunnel:submissions'
const VIEW_KEY = 'urban-utility-tunnel:pipeline-view'

export const DEFAULT_PIPELINE_VIEW: PipelineViewState = {
  filters: { 权属单位: '', 所属舱室: '', 管线类型: '' },
  includeMovedOut: false,
  page: 1,
  focusId: null,
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/* ---------------- 遗留问题：管线/巡检/值班三处入口共用同一份清单 ---------------- */

export function listIssues(): IssueRow[] {
  return read<IssueRow[]>(ISSUES_KEY, [])
}

export function openIssueCount(source?: IssueSource): number {
  const rows = listIssues()
  return rows.filter(
    (row) => row.status === '待处理' && (!source || row.source === source),
  ).length
}

export function addIssue(input: {
  source: IssueSource
  sourceNo: string
  chamber: string
  content: string
  createdAt?: string
}): IssueRow {
  const rows = listIssues()
  const row: IssueRow = {
    id: nextId(rows),
    source: input.source,
    sourceNo: input.sourceNo,
    chamber: input.chamber,
    content: input.content,
    status: '待处理',
    createdAt: input.createdAt ?? new Date().toISOString().slice(0, 10),
  }
  write(ISSUES_KEY, [...rows, row])
  appendLedgerSync({
    kind: '问题上报',
    text: `${input.source}（${input.sourceNo}）上报遗留问题：${input.content}`,
  })
  return row
}

export function resolveIssue(id: number): boolean {
  const rows = listIssues()
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) {
    return false
  }
  rows[index] = { ...rows[index], status: '已核销' }
  write(ISSUES_KEY, rows)
  return true
}

/* ---------------- 台账变更同步给值班清单 ---------------- */

export function listLedgerSync(): LedgerSyncRow[] {
  return read<LedgerSyncRow[]>(SYNC_KEY, [])
}

export function appendLedgerSync(input: {
  kind: LedgerSyncRow['kind']
  text: string
  at?: string
}): LedgerSyncRow {
  const rows = listLedgerSync()
  const row: LedgerSyncRow = {
    id: nextId(rows),
    at: input.at ?? new Date().toISOString().slice(0, 16).replace('T', ' '),
    kind: input.kind,
    text: input.text,
  }
  write(SYNC_KEY, [row, ...rows])
  return row
}

/* ---------------- 登记提交幂等：同一笔重复提交只认第一次 ---------------- */

export function listSubmissions(): SubmissionRecord[] {
  return read<SubmissionRecord[]>(SUBMISSIONS_KEY, [])
}

export function rememberSubmission(token: string, pipelineNo: string): void {
  const rows = listSubmissions()
  rows.push({ token, pipelineNo, at: new Date().toISOString().slice(0, 16).replace('T', ' ') })
  write(SUBMISSIONS_KEY, rows)
}

export function findSubmission(token: string): SubmissionRecord | undefined {
  return listSubmissions().find((row) => row.token === token)
}

/* ---------------- 管线页视图状态：再打开还停在原来那条 ---------------- */

export function loadPipelineView(): PipelineViewState {
  const saved = read<PipelineViewState | null>(VIEW_KEY, null)
  if (!saved) {
    return { ...DEFAULT_PIPELINE_VIEW, filters: { ...DEFAULT_PIPELINE_VIEW.filters } }
  }
  return {
    filters: { ...DEFAULT_PIPELINE_VIEW.filters, ...(saved.filters ?? {}) },
    includeMovedOut: saved.includeMovedOut ?? false,
    page: saved.page ?? 1,
    focusId: saved.focusId ?? null,
  }
}

export function savePipelineView(state: PipelineViewState): void {
  write(VIEW_KEY, state)
}
