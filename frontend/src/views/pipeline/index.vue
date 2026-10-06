<template>
  <section class="page" data-module="pipeline">
    <header class="page-head">
      <div>
        <h2>入廊管线登记管理</h2>
        <p class="page-desc">
          按权属单位、所属舱室、管线类型收窄台账；过滤不改登记原次序。迁出管线默认从在用结果收起，可单独捞出查看。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记入廊管线</button>
        <button class="btn" type="button" @click="exportRows">导出入廊管线登记清单</button>
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
      <span class="legend-item">遗留待处理：{{ openIssues }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="applyFilters">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <select v-model="filters[field]">
          <option value="">全部{{ field }}</option>
          <option v-for="option in options[field]" :key="option" :value="option">{{ option }}</option>
        </select>
      </label>
      <label class="filter-item checkbox-item">
        <input v-model="includeMovedOut" type="checkbox" @change="applyFilters" />
        <span>含已迁出管线</span>
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
          v-for="row in rows"
          :key="String(row.id)"
          :class="{ 'focus-row': Number(row.id) === focusId }"
          @click="focusRow(row)"
        >
          <td v-for="column in columns" :key="column" :title="column === '备注' ? String(row[column]) : ''">
            {{ row[column] || '—' }}
          </td>
          <td>
            {{ row.status }}
            <em v-if="String(row.status) === '已迁出'" class="moved-tag">已收起</em>
          </td>
          <td class="row-actions" @click.stop>
            <button
              v-for="action in rowActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            {{ includeMovedOut ? '当前条件下暂无入廊管线' : '在用管线里没有命中条件的记录，可勾选「含已迁出管线」捞出历史记录' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>
        共 {{ total }} 条（{{ includeMovedOut ? '含已迁出' : '仅在用' }}），本页 {{ rows.length }} 条
      </span>
      <span class="pager">
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ pageCount }} 页</span>
        <button class="btn" type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <section v-if="migrationLog.length" class="migration-panel">
      <button class="link" type="button" @click="showMigration = !showMigration">
        {{ showMigration ? '收起' : '查看' }}存量台账迁移说明（去重 / 补缺 / 分批）
      </button>
      <div v-if="showMigration">
        <p class="page-desc">
          切换之日 {{ switchDate }}：老数据沿用原有结论不改写；迁出停计费等新口径自切换之日起算。
        </p>
        <ul class="migration-list">
          <li v-for="(log, index) in migrationLog" :key="index">
            迁移时间 {{ log.at.slice(0, 16).replace('T', ' ') }}：
            剔除重复登记 {{ log.removedDuplicates.length }} 条，回填入廊日期
            {{ log.backfilledEntryDates.length }} 条，保留既有结论 {{ log.preservedConclusions }} 条；
            按入廊月份分 {{ log.batches.length }} 批迁移。
            <ul>
              <li v-for="dup in log.removedDuplicates" :key="dup.droppedId">
                {{ dup.管线编号 }}：保留 #{{ dup.keptId }}，重复版 #{{ dup.droppedId }} 整笔剔除（{{ dup.reason }}）
              </li>
              <li v-for="fill in log.backfilledEntryDates" :key="fill.id">
                #{{ fill.id }} {{ fill.管线编号 }}：入廊日期回填为 {{ fill.入廊日期 }}（{{ fill.依据 }}）
              </li>
              <li v-for="batch in log.batches" :key="batch.批次">
                {{ batch.批次 }}：{{ batch.数量 }} 条
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </section>

    <!-- 登记弹窗 -->
    <div v-if="creating" class="modal-mask" @click.self="creating = false">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3>登记入廊管线</h3>
        <p class="page-desc">同管线编号重复登记按编号去重；同一笔重复提交只认第一次落库。</p>
        <label v-for="field in createFields" :key="field.prop" class="modal-field">
          <span>{{ field.label }}<i v-if="field.required">*</i></span>
          <input v-model="createForm[field.prop]" :placeholder="field.placeholder" />
        </label>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="creating = false">取消</button>
          <button class="btn primary" type="submit">提交登记</button>
        </div>
      </form>
    </div>

    <!-- 上报问题弹窗 -->
    <div v-if="issueTarget" class="modal-mask" @click.self="issueTarget = null">
      <form class="modal-card" @submit.prevent="submitIssue">
        <h3>上报遗留问题：{{ issueTarget['管线编号'] }}</h3>
        <p class="page-desc">问题会落到值班交接的遗留清单，管线台账与值班清单两处条数一致。</p>
        <label class="modal-field">
          <span>问题描述<i>*</i></span>
          <textarea v-model="issueContent" rows="3" placeholder="如：舱室支架锈蚀，需安排检修"></textarea>
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="issueTarget = null">取消</button>
          <button class="btn primary" type="submit">确认上报</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

import {
  createPipeline,
  FILTER_FIELDS,
  listPipelines,
  moveOutPipeline,
  PAGE_SIZE,
  pipelineOptions,
  reportPipelineIssue,
  SWITCH_DATE,
} from '@/api/pipeline-service'
import { downloadEntries, runAction as genericAction } from '@/api/local-service'
import {
  listIssues,
  loadPipelineView,
  openIssueCount,
  savePipelineView,
} from '@/data/collab-store'
import { readMigrationLog } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import type { MigrationLog } from '@/data/migration'

const columns = ["管线编号", "所属舱室", "管线类型", "权属单位", "入廊日期", "设计容量", "对接联系人", "迁出日期", "备注"]
const filterFields = [...FILTER_FIELDS]
const switchDate = SWITCH_DATE

const savedView = loadPipelineView()
const filters = reactive<Record<string, string>>({ ...savedView.filters })
const includeMovedOut = ref(savedView.includeMovedOut)
const page = ref(savedView.page)
const focusId = ref<number | null>(savedView.focusId)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const showMigration = ref(false)
const migrationLog = ref<MigrationLog[]>(readMigrationLog())

const options = computed(() => ({
  权属单位: pipelineOptions('权属单位'),
  所属舱室: pipelineOptions('所属舱室'),
  管线类型: pipelineOptions('管线类型'),
}))

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const openIssues = computed(() => openIssueCount('入廊管线'))
const issuesVersion = ref(0)

function fullFiltered(): EntryRow[] {
  const payload = listPipelines(
    { 权属单位: filters['权属单位'], 所属舱室: filters['所属舱室'], 管线类型: filters['管线类型'] },
    { includeMovedOut: includeMovedOut.value, page: 1, size: 9999 },
  )
  return payload.items
}

const statusSummary = computed(() => {
  void issuesVersion.value
  const scoped = fullFiltered()
  return ['待登记', '已入廊', '运行中', '已迁出'].map((status) => ({
    status,
    count: scoped.filter((row) => String(row.status) === status).length,
  }))
})

const stats = computed(() => {
  const scoped = fullFiltered()
  return [
    { label: includeMovedOut.value ? '管线总数（含迁出）' : '在用管线', value: scoped.filter((row) => row.status !== '已迁出').length },
    { label: '已迁出管线', value: scoped.filter((row) => row.status === '已迁出').length },
    { label: '待登记管线', value: scoped.filter((row) => row.status === '待登记').length },
  ]
})

function persistView() {
  savePipelineView({
    filters: {
      权属单位: filters['权属单位'] ?? '',
      所属舱室: filters['所属舱室'] ?? '',
      管线类型: filters['管线类型'] ?? '',
    },
    includeMovedOut: includeMovedOut.value,
    page: page.value,
    focusId: focusId.value,
  })
}

function reload() {
  errorMessage.value = ''
  const scoped = fullFiltered()
  // 记住了停留条目时，先定位到它在当前过滤结果中的页；条目已不在结果里则停在原页。
  if (focusId.value !== null) {
    const index = scoped.findIndex((row) => Number(row.id) === focusId.value)
    if (index >= 0) {
      page.value = Math.floor(index / PAGE_SIZE) + 1
    }
  }
  if (page.value > Math.max(1, Math.ceil(scoped.length / PAGE_SIZE))) {
    page.value = 1
  }
  const payload = listPipelines(
    { 权属单位: filters['权属单位'], 所属舱室: filters['所属舱室'], 管线类型: filters['管线类型'] },
    { includeMovedOut: includeMovedOut.value, page: page.value, size: PAGE_SIZE },
  )
  rows.value = payload.items
  total.value = payload.total
  page.value = payload.page
  persistView()
}

function applyFilters() {
  page.value = 1
  focusId.value = null
  reload()
}

function resetFilters() {
  filters['权属单位'] = ''
  filters['所属舱室'] = ''
  filters['管线类型'] = ''
  includeMovedOut.value = false
  page.value = 1
  focusId.value = null
  reload()
}

function goPage(target: number) {
  page.value = target
  reload()
}

function focusRow(row: EntryRow) {
  focusId.value = Number(row.id)
  persistView()
}

function rowActions(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待登记':
      return ['登记入廊', '上报问题']
    case '已入廊':
      return ['确认运行', '办理迁出', '上报问题']
    case '运行中':
      return ['办理迁出', '上报问题']
    default:
      return []
  }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  if (action === '办理迁出') {
    const result = moveOutPipeline(Number(row.id))
    if (result.ok && focusId.value === Number(row.id) && !includeMovedOut.value) {
      // 迁出后默认从在用结果收起，原停留条目已不在列表里，清掉高亮焦点。
      focusId.value = null
    }
    finishAction(result)
    return
  }
  if (action === '上报问题') {
    issueTarget.value = row
    return
  }
  // 登记入廊 / 确认运行仍走通用动作流转
  const result = genericAction('pipeline', Number(row.id), action)
  finishAction(result)
}

function finishAction(result: { ok: boolean; message: string }) {
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

function exportRows() {
  downloadEntries('pipeline')
}

/* ---------------- 登记弹窗 ---------------- */

const createFields = [
  { prop: '管线编号', label: '管线编号', required: true, placeholder: '如 PIPE-2026-006' },
  { prop: '所属舱室', label: '所属舱室', required: true, placeholder: '如 综合舱A段' },
  { prop: '管线类型', label: '管线类型', required: true, placeholder: '如 电力 / 通信 / 燃气' },
  { prop: '权属单位', label: '权属单位', required: true, placeholder: '如 市供电公司' },
  { prop: '入廊日期', label: '入廊日期', required: false, placeholder: 'YYYY-MM-DD，可登记后补' },
  { prop: '设计容量', label: '设计容量', required: false, placeholder: '如 10kV 2回路' },
  { prop: '对接联系人', label: '对接联系人', required: false, placeholder: '姓名与联系电话' },
] as const

const creating = ref(false)
const createError = ref('')
const createToken = ref('')
const createForm = reactive<Record<string, string>>({
  管线编号: '',
  所属舱室: '',
  管线类型: '',
  权属单位: '',
  入廊日期: '',
  设计容量: '',
  对接联系人: '',
})

function openCreate() {
  createError.value = ''
  Object.keys(createForm).forEach((key) => {
    createForm[key] = ''
  })
  // 每次打开都是一笔新提交；同一笔用同一令牌，重复点提交会被按重复退回。
  createToken.value = `PIPE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  creating.value = true
}

function submitCreate() {
  const result = createPipeline({
    token: createToken.value,
    管线编号: createForm['管线编号'],
    所属舱室: createForm['所属舱室'],
    管线类型: createForm['管线类型'],
    权属单位: createForm['权属单位'],
    入廊日期: createForm['入廊日期'],
    设计容量: createForm['设计容量'],
    对接联系人: createForm['对接联系人'],
  })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  creating.value = false
  successMessage.value = result.message
  focusId.value = result.id ?? null
  migrationLog.value = readMigrationLog()
  // reload 会按 focusId 在过滤结果中的位置自动落到新条目所在页。
  reload()
}

/* ---------------- 上报问题弹窗 ---------------- */

const issueTarget = ref<EntryRow | null>(null)
const issueContent = ref('')

function submitIssue() {
  if (!issueTarget.value) {
    return
  }
  const result = reportPipelineIssue(Number(issueTarget.value.id), issueContent.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  issueTarget.value = null
  issueContent.value = ''
  issuesVersion.value += 1
}

// 遗留清单在别处核销后，回到本页数字也要跟上：切回本页时刷新一次本地数据。
function refreshIssues() {
  listIssues()
  issuesVersion.value += 1
}

onMounted(() => {
  reload()
  refreshIssues()
  window.addEventListener('focus', refreshIssues)
})

onUnmounted(() => {
  window.removeEventListener('focus', refreshIssues)
})
</script>
