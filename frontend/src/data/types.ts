/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 派生模块（如费用结算由管线台账生成），不计入看板登记总量。 */
  derived?: boolean
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 跨模块共用的遗留问题：巡检上报、管线页上报、值班登记遗留都落到这同一份清单。 */
export type IssueSource = '入廊管线' | '廊内巡检' | '值班交接'

export type IssueRow = {
  id: number
  source: IssueSource
  sourceNo: string
  chamber: string
  content: string
  status: '待处理' | '已核销'
  createdAt: string
}

/** 台账变更同步到值班清单的事项（新登记、办理迁出等）。 */
export type LedgerSyncRow = {
  id: number
  at: string
  kind: '管线登记' | '管线迁出' | '问题上报'
  text: string
}

/** 登记提交的幂等留痕：同一笔重复提交只认第一次落库。 */
export type SubmissionRecord = {
  token: string
  pipelineNo: string
  at: string
}

/** 管线台账在本页的视图状态：筛选条件、页码、停留条目，离开再回来原样恢复。 */
export type PipelineViewState = {
  filters: { 权属单位: string; 所属舱室: string; 管线类型: string }
  includeMovedOut: boolean
  page: number
  focusId: number | null
}

export type PipelineFeeRow = {
  settleNo: string
  pipelineId: number
  pipelineNo: string
  chamber: string
  pipelineType: string
  owner: string
  entryDate: string
  moveOutDate: string
  entryFeeStatus: string
  serviceFeeStatus: string
  ruleScope: string
  pipelineStatus: string
}
