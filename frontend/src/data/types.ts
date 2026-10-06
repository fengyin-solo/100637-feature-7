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

/** 结算单：一条管线对应一张结算单，入廊费一次性，服务费按在廊月份累计。 */
export type FeeRow = {
  id: number
  pipelineId: number
  管线编号: string
  权属单位: string
  所属舱室: string
  管线类型: string
  入廊日期: string
  迁出日期: string
  /** 入廊费（一次性，元） */
  入廊费金额: number
  /** 已计服务费月份数 */
  计费月数: number
  /** 服务费（按月单价 × 已计月数，元） */
  服务费金额: number
  合计金额: number
  /** 计费中 / 已停计（迁出即停） */
  计费状态: '计费中' | '已停计'
  /** 老数据沿用原有结论；切换日起的新流水走新口径 */
  计费口径: '原有结论' | '新口径'
  备注: string
}

/** 值班清单同步事项：管线登记、迁出、上报的问题都在这里留痕。 */
export type NoticeRow = {
  id: number
  时间: string
  管线编号: string
  权属单位: string
  类别: '登记入廊' | '办理迁出' | '上报问题'
  内容: string
  来源: '管线台账'
  处理状态: '待处理' | '已关闭'
}
