<template>
  <section class="page" data-module="pipeline">
    <header class="page-head">
      <div>
        <h2>入廊管线登记管理</h2>
        <p class="page-desc">
          按权属单位、所属舱室、管线类型收窄台账；迁出管线默认从在用结果收起，需要时可单独捞出。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记入廊管线</button>
        <button class="btn" type="button" @click="exportRows">导出台账</button>
        <button class="btn ghost" type="button" @click="resetAll">重置为初始台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload(1)">
      <label class="filter-item">
        <span>权属单位</span>
        <select v-model="filters.权属单位">
          <option value="">全部权属单位</option>
          <option v-for="value in page.options.权属单位" :key="value" :value="value">{{ value }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>所属舱室</span>
        <select v-model="filters.所属舱室">
          <option value="">全部舱室</option>
          <option v-for="value in page.options.所属舱室" :key="value" :value="value">{{ value }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>管线类型</span>
        <select v-model="filters.管线类型">
          <option value="">全部类型</option>
          <option v-for="value in page.options.管线类型" :key="value" :value="value">{{ value }}</option>
        </select>
      </label>
      <label class="filter-check">
        <input v-model="filters.含已迁出" type="checkbox" @change="reload(1)" />
        <span>含已迁出（默认收起）</span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in page.items"
          :key="String(row.id)"
          :class="{ 'row-focus': Number(row.id) === focusId }"
        >
          <td v-for="column in columns" :key="column" :title="column === '备注' ? String(row[column]) : ''">
            {{ column === '备注' ? briefNote(String(row[column] ?? '')) : (row[column] || '—') }}
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action.name"
              class="link"
              :class="{ danger: action.name === '办理迁出' }"
              type="button"
              @click="runAction(action.name, row)"
            >
              {{ action.name }}
            </button>
            <button class="link" type="button" @click="openIssue(row)">上报问题</button>
          </td>
        </tr>
        <tr v-if="!page.items.length">
          <td :colspan="columns.length + 2" class="empty-state">
            当前条件下没有管线{{ filters.含已迁出 ? '' : '（已迁出管线已默认收起，可勾选“含已迁出”捞出）' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>
        共 {{ page.total }} 条{{ filters.含已迁出 ? '（含已迁出）' : '在用' }}管线记录
        <template v-if="!filters.含已迁出 && page.exitedCount > 0">，另有已迁出 {{ page.exitedCount }} 条已收起</template>
      </span>
      <div v-if="page.pageCount > 1" class="pager">
        <button class="btn" type="button" :disabled="page.page <= 1" @click="reload(page.page - 1)">上一页</button>
        <span>第 {{ page.page }} / {{ page.pageCount }} 页</span>
        <button class="btn" type="button" :disabled="page.page >= page.pageCount" @click="reload(page.page + 1)">
          下一页
        </button>
      </div>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 登记弹窗 -->
    <div v-if="showCreate" class="modal-mask" @click.self="closeCreate">
      <div class="modal">
        <h3>登记入廊管线</h3>
        <p class="modal-tip">同一管线编号只认第一次落库，重复提交整笔退回。</p>
        <form @submit.prevent="submitCreate">
          <label v-for="field in createFields" :key="field.key" class="form-item">
            <span>{{ field.label }}</span>
            <input v-model="draft[field.key]" :placeholder="field.placeholder" />
          </label>
          <div class="modal-actions">
            <button class="btn primary" type="submit">提交登记</button>
            <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 上报问题弹窗 -->
    <div v-if="issueTarget" class="modal-mask" @click.self="issueTarget = null">
      <div class="modal">
        <h3>上报管线问题</h3>
        <p class="modal-tip">
          问题将落到「运维值班交接」的遗留清单：管线 {{ issueTarget['管线编号'] }}（{{ issueTarget['所属舱室'] }}）
        </p>
        <form @submit.prevent="submitIssue">
          <label class="form-item wide">
            <span>问题描述</span>
            <textarea v-model="issueText" rows="3" placeholder="写明现象、部位与紧急程度"></textarea>
          </label>
          <div class="modal-actions">
            <button class="btn primary" type="submit">上报并同步值班清单</button>
            <button class="btn ghost" type="button" @click="issueTarget = null">取消</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, listRows, moduleMeta, resetRows } from '@/api/local-service'
import {
  changePipelineStatus,
  EMPTY_FILTERS,
  pageOfPipeline,
  pendingIssueCount,
  queryPipelines,
  registerPipeline,
  reportPipelineIssue,
  type PipelineDraft,
  type PipelineFilters,
  type PipelinePage,
} from '@/api/pipeline-service'
import type { EntryRow } from '@/data/types'
import { loadViewState, saveViewState } from '@/stores/view-state'

const meta = moduleMeta('pipeline')
const STATE_KEY = 'pipeline:view'
const columns = [
  '管线编号',
  '所属舱室',
  '管线类型',
  '权属单位',
  '入廊日期',
  '设计容量',
  '对接联系人',
  '迁移批次',
  '迁出日期',
  '备注',
]

type SavedView = { filters: PipelineFilters; page: number; focusId: number | null }
const saved = loadViewState<SavedView>(STATE_KEY, { filters: { ...EMPTY_FILTERS }, page: 1, focusId: null })
const filters = reactive<PipelineFilters>({ ...saved.filters })
const focusId = ref<number | null>(saved.focusId)

const emptyPage: PipelinePage = {
  items: [],
  total: 0,
  page: 1,
  size: 8,
  pageCount: 1,
  inUseCount: 0,
  exitedCount: 0,
  statusCounts: {},
  options: { 权属单位: [], 所属舱室: [], 管线类型: [] },
}
const page = ref<PipelinePage>(emptyPage)
const currentPage = ref(saved.page)

const message = ref('')
const messageOk = ref(false)

const stats = computed(() => [
  { label: '在用管线', value: page.value.inUseCount },
  { label: '已迁出（已收起）', value: page.value.exitedCount },
  { label: '待登记管线', value: countStatus('待登记') },
  { label: '上报待处理问题', value: pendingIssueCount() },
])

const statusSummary = computed(() =>
  (['待登记', '已入廊', '运行中', '已迁出'] as string[]).map((status: string) => ({
    status,
    count: page.value.statusCounts[status] ?? 0,
  })),
)

function countStatus(status: string): number {
  // 统计口径始终是全量台账，与筛选无关。
  return listRows('pipeline').filter((row) => String(row.status) === status).length
}

function actionsFor(row: EntryRow): { name: '登记入廊' | '确认运行' | '办理迁出' }[] {
  switch (String(row.status)) {
    case '待登记':
      return [{ name: '登记入廊' }]
    case '已入廊':
      return [{ name: '确认运行' }, { name: '办理迁出' }]
    case '运行中':
      return [{ name: '办理迁出' }]
    default:
      return []
  }
}

function briefNote(note: string): string {
  return note.length > 14 ? `${note.slice(0, 14)}…` : note
}

function persistView() {
  saveViewState(STATE_KEY, { filters: { ...filters }, page: currentPage.value, focusId: focusId.value })
}

function reload(targetPage?: number) {
  message.value = ''
  const nextPage = targetPage ?? currentPage.value
  const payload = queryPipelines(filters, nextPage)
  page.value = payload
  currentPage.value = payload.page
  persistView()
}

function resetFilters() {
  Object.assign(filters, EMPTY_FILTERS)
  reload(1)
}

function exportRows() {
  downloadEntries(meta.key)
}

function resetAll() {
  resetRows('pipeline')
  Object.assign(filters, EMPTY_FILTERS)
  focusId.value = null
  message.value = '台账已重置为初始数据（含迁移、去重与回填结果）'
  messageOk.value = true
  reload(1)
}

// ---- 登记 ----
const showCreate = ref(false)
const createFields = [
  { key: '管线编号', label: '管线编号', placeholder: '如 PIPE-2026-101' },
  { key: '权属单位', label: '权属单位', placeholder: '如 市水务集团' },
  { key: '所属舱室', label: '所属舱室', placeholder: '如 综合舱A' },
  { key: '管线类型', label: '管线类型', placeholder: '给水管/燃气管/电力电缆/通信光缆/热力管/雨水管' },
  { key: '入廊日期', label: '入廊日期', placeholder: 'YYYY-MM-DD' },
  { key: '设计容量', label: '设计容量', placeholder: '如 DN300' },
  { key: '对接联系人', label: '对接联系人', placeholder: '联系人姓名' },
] as const

const draft = reactive<PipelineDraft>({
  管线编号: '',
  所属舱室: '',
  管线类型: '',
  权属单位: '',
  入廊日期: '',
  设计容量: '',
  对接联系人: '',
})

function openCreate() {
  Object.assign(draft, {
    管线编号: '',
    所属舱室: '',
    管线类型: '',
    权属单位: '',
    入廊日期: '',
    设计容量: '',
    对接联系人: '',
  })
  message.value = ''
  showCreate.value = true
}

function closeCreate() {
  showCreate.value = false
}

function submitCreate() {
  const result = registerPipeline({ ...draft })
  if (!result.ok) {
    message.value = result.message
    messageOk.value = false
    return
  }
  showCreate.value = false
  message.value = result.message
  messageOk.value = true
  focusId.value = result.id ?? null
  // 新登记的是待登记管线，放到未收窄的第一页即可定位到它。
  Object.assign(filters, EMPTY_FILTERS)
  currentPage.value = pageOfPipeline(focusId.value ?? 0, { ...filters })
  reload(currentPage.value)
}

// ---- 状态流转 ----
function runAction(action: '登记入廊' | '确认运行' | '办理迁出', row: EntryRow) {
  const result = changePipelineStatus(Number(row.id), action)
  message.value = result.message
  messageOk.value = result.ok
  if (!result.ok) {
    reload()
    return
  }
  focusId.value = Number(row.id)
  // 迁出后默认收起：若当前不含已迁出，自动跳到该管线迁出前所在页的相邻结果。
  if (action === '办理迁出' && !filters.含已迁出) {
    const payload = queryPipelines(filters, currentPage.value)
    currentPage.value = Math.min(payload.page, payload.pageCount)
  }
  reload(currentPage.value)
}

// ---- 上报问题 ----
const issueTarget = ref<EntryRow | null>(null)
const issueText = ref('')

function openIssue(row: EntryRow) {
  issueTarget.value = row
  issueText.value = ''
  message.value = ''
}

function submitIssue() {
  if (!issueTarget.value) {
    return
  }
  const result = reportPipelineIssue(Number(issueTarget.value.id), issueText.value)
  message.value = result.message
  messageOk.value = result.ok
  if (result.ok) {
    issueTarget.value = null
    reload()
  }
}

onMounted(() => {
  // 回到这页时定位到上次停留的那条所在页。
  if (focusId.value !== null) {
    currentPage.value = pageOfPipeline(focusId.value, { ...filters })
  }
  reload(currentPage.value)
})
</script>
