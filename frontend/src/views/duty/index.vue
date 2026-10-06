<template>
  <section class="page" data-module="duty">
    <header class="page-head">
      <div>
        <h2>运维值班交接管理</h2>
        <p class="page-desc">
          维护值班交接记录；管线登记、迁出与上报问题实时同步到下方值班清单，上报问题落入遗留清单，两处条数一致。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出值班交接清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待交接班次</span>
        <strong class="stat-value">{{ countStatus('待交接') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已交接班次</span>
        <strong class="stat-value">{{ countStatus('已交接') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">管线遗留问题待处理</span>
        <strong class="stat-value">{{ pendingIssues }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">台账同步待办</span>
        <strong class="stat-value">{{ pendingNotices }}</strong>
      </article>
    </div>

    <h3 class="block-title">管线台账同步清单</h3>
    <p class="status-legend">
      <span class="legend-item">待处理：{{ pendingNotices }}</span>
      <span class="legend-item">已关闭：{{ closedNotices }}</span>
      <span class="legend-item">其中上报问题（遗留清单）：{{ pendingIssues }} 条待处理</span>
    </p>
    <table class="data-table sync-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>管线编号</th>
          <th>权属单位</th>
          <th>类别</th>
          <th>同步内容</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="notice in notices" :key="notice.id" :class="{ issue: notice.类别 === '上报问题' }">
          <td>{{ notice.时间 }}</td>
          <td>{{ notice.管线编号 }}</td>
          <td>{{ notice.权属单位 }}</td>
          <td>
            <span :class="noticeClass(notice.类别)">{{ notice.类别 }}</span>
          </td>
          <td>{{ notice.内容 }}</td>
          <td>{{ notice.处理状态 }}</td>
          <td class="row-actions">
            <button v-if="notice.处理状态 === '待处理'" class="link" type="button" @click="closeOne(notice.id)">
              关闭
            </button>
            <span v-else class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!notices.length">
          <td colspan="7" class="empty-state">暂无台账同步事项；管线登记、迁出或上报问题后会实时出现在这里</td>
        </tr>
      </tbody>
    </table>

    <h3 class="block-title">遗留问题清单（来源：入廊管线登记页上报）</h3>
    <table class="data-table sync-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>管线编号</th>
          <th>权属单位</th>
          <th>问题内容</th>
          <th>处理状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="notice in issueNotices" :key="notice.id">
          <td>{{ notice.时间 }}</td>
          <td>{{ notice.管线编号 }}</td>
          <td>{{ notice.权属单位 }}</td>
          <td>{{ notice.内容 }}</td>
          <td>{{ notice.处理状态 }}</td>
        </tr>
        <tr v-if="!issueNotices.length">
          <td colspan="5" class="empty-state">暂无遗留问题</td>
        </tr>
      </tbody>
    </table>
    <p class="page-foot">待处理遗留 {{ pendingIssues }} 条，与管线登记页「上报待处理问题」统计同源、条数一致；本清单共 {{ issueNotices.length }} 条（含已关闭）。</p>

    <h3 class="block-title">值班交接记录</h3>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无值班交接数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条值班交接记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listSyncedNotices,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { closeNotice } from '@/api/pipeline-service'
import { listRows } from '@/data/local-store'
import type { EntryRow, NoticeRow } from '@/data/types'

const meta = moduleMeta('duty')
const columns = ['交接编号', '值班班组', '值班日期', '班次', '值班人员', '交接事项', '交接人员', '交接状态']
const actions = ['发起交接', '确认交接', '登记遗留']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['值班班组', '值班日期', '班次']
const notices = ref<NoticeRow[]>([])

const issueNotices = computed(() => notices.value.filter((item) => item.类别 === '上报问题'))
const pendingIssues = computed(
  () => notices.value.filter((item) => item.类别 === '上报问题' && item.处理状态 === '待处理').length,
)
const pendingNotices = computed(() => notices.value.filter((item) => item.处理状态 === '待处理').length)
const closedNotices = computed(() => notices.value.filter((item) => item.处理状态 === '已关闭').length)

const statusSummary = computed(() =>
  ['待交接', '交接中', '已交接', '有遗留'].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function countStatus(status: string): number {
  return listRows('duty').filter((row) => String(row.status) === status).length
}

function noticeClass(category: NoticeRow['类别']): string {
  return category === '上报问题' ? 'tag stopped' : category === '办理迁出' ? 'tag legacy' : 'tag billing'
}

function loadNotices() {
  notices.value = listSyncedNotices().slice().sort((a, b) => (a.时间 < b.时间 ? 1 : -1))
}

function closeOne(id: number) {
  closeNotice(id)
  loadNotices()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
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

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    loadNotices()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '值班交接列表读取失败'
  }
}

onMounted(reload)
</script>
