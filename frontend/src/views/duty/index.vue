<template>
  <section class="page" data-module="duty">
    <header class="page-head">
      <div>
        <h2>运维值班交接管理</h2>
        <p class="page-desc">维护值班交接记录；管线登记/迁出与各入口上报的问题都会同步到本页遗留清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记值班交接记录</button>
        <button class="btn" type="button" @click="exportRows">导出运维值班交接清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statsCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
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
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无运维值班交接数据，可先登记值班交接记录</td>
        </tr>
      </tbody>
    </table>

    <section class="issue-panel">
      <h3>遗留清单（巡检 / 管线 / 值班共用，共 {{ issues.length }} 条，待处理 {{ openIssues }} 条）</h3>
      <form class="filter-bar" @submit.prevent>
        <label class="filter-item">
          <span>来源</span>
          <select v-model="issueSource" @change="reload">
            <option value="">全部入口</option>
            <option value="入廊管线">入廊管线登记</option>
            <option value="廊内巡检">廊内巡检任务</option>
            <option value="值班交接">运维值班交接</option>
          </select>
        </label>
        <label class="filter-item checkbox-item">
          <input v-model="onlyOpen" type="checkbox" @change="reload" />
          <span>只看待处理</span>
        </label>
        <span class="page-desc">管线登记页看到的待处理条数与本页同一份数据，始终一致。</span>
      </form>
      <table class="data-table">
        <thead>
          <tr><th>来源入口</th><th>来源编号</th><th>舱室/路线</th><th>问题内容</th><th>登记日期</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="issue in shownIssues" :key="issue.id">
            <td>{{ issue.source }}</td>
            <td>{{ issue.sourceNo }}</td>
            <td>{{ issue.chamber || '—' }}</td>
            <td>{{ issue.content }}</td>
            <td>{{ issue.createdAt }}</td>
            <td>{{ issue.status }}</td>
            <td>
              <button v-if="issue.status === '待处理'" class="link" type="button" @click="closeIssue(issue.id)">核销</button>
              <span v-else class="page-desc">已处理</span>
            </td>
          </tr>
          <tr v-if="!shownIssues.length">
            <td colspan="7" class="empty-state">遗留清单为空</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="issue-panel">
      <h3>台账同步动态（管线登记 / 迁出 / 问题上报）</h3>
      <ul class="sync-list">
        <li v-for="item in syncRows" :key="item.id">
          <span class="sync-at">{{ item.at }}</span>
          <span class="legend-item">{{ item.kind }}</span>
          <span>{{ item.text }}</span>
        </li>
        <li v-if="!syncRows.length" class="page-desc">暂无同步事项</li>
      </ul>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条运维值班交接记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  listIssues,
  listLedgerSync,
  openIssueCount,
  resolveIssue,
} from '@/data/collab-store'
import type { EntryRow, IssueRow, IssueSource, LedgerSyncRow } from '@/data/types'

const meta = moduleMeta('duty')
const columns = ["交接编号", "值班班组", "值班日期", "班次", "值班人员", "交接事项", "交接人员", "交接状态"]
const actions = ["发起交接", "确认交接", "登记遗留"]
const statuses = ["待交接", "交接中", "已交接", "有遗留"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const issues = ref<IssueRow[]>([])
const syncRows = ref<LedgerSyncRow[]>([])
const issueSource = ref<'' | IssueSource>('')
const onlyOpen = ref(true)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const openIssues = computed(() => openIssueCount())
const statsCards = computed(() => [
  { label: "待交接班次", value: rows.value.filter((row) => row.status === '待交接').length },
  { label: "已交接班次", value: rows.value.filter((row) => row.status === '已交接').length },
  { label: "有遗留事项（共用清单待处理）", value: openIssues.value },
])

const shownIssues = computed(() =>
  issues.value.filter(
    (issue) =>
      (!issueSource.value || issue.source === issueSource.value) &&
      (!onlyOpen.value || issue.status === '待处理'),
  ),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '值班交接记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function closeIssue(id: number) {
  resolveIssue(id)
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    issues.value = listIssues()
    syncRows.value = listLedgerSync()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '运维值班交接列表读取失败'
  }
}

onMounted(reload)
</script>
