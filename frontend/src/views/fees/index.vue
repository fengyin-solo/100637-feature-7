<template>
  <section class="page" data-module="fees">
    <header class="page-head">
      <div>
        <h2>入廊费与服务费结算</h2>
        <p class="page-desc">
          一条管线一张结算单：入廊费一次性计收，服务费按在廊月份累计；管线办理迁出后自迁出当月起停计，
          本页可直接看到「已停计」与迁出日期。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportFees">导出结算单</button>
      </div>
    </header>

    <p class="cutover-banner">
      口径分界：{{ cutover }} 前已结清的老账沿用原有结论（不重算、不改写）；自 {{ cutover }} 起的新登记、
      新月服务费与迁出停计一律按新口径收费标准执行。
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span class="legend-item">计费中：{{ summary.billingCount }}</span>
      <span class="legend-item">已停计（管线已迁出）：{{ summary.stoppedCount }}</span>
      <span class="legend-item">当前筛选：{{ summary.total }} 张</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>权属单位</span>
        <select v-model="filters.权属单位">
          <option value="">全部权属单位</option>
          <option v-for="value in summary.options.权属单位" :key="value" :value="value">{{ value }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>计费状态</span>
        <select v-model="filters.计费状态">
          <option value="">全部状态</option>
          <option value="计费中">计费中</option>
          <option value="已停计">已停计（已迁出）</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in summary.items" :key="row.id" :class="{ stopped: row.计费状态 === '已停计' }">
          <td>{{ row.管线编号 }}</td>
          <td>{{ row.权属单位 }}</td>
          <td>{{ row.所属舱室 }}</td>
          <td>{{ row.管线类型 }}</td>
          <td>{{ row.入廊日期 || '—' }}</td>
          <td>{{ row.迁出日期 || '—' }}</td>
          <td class="num">{{ formatMoney(row.入廊费金额) }}</td>
          <td class="num">{{ row.计费月数 }}</td>
          <td class="num">{{ formatMoney(row.服务费金额) }}</td>
          <td class="num strong">{{ formatMoney(row.合计金额) }}</td>
          <td>
            <span :class="row.计费状态 === '已停计' ? 'tag stopped' : 'tag billing'">{{ row.计费状态 }}</span>
            <div v-if="row.计费状态 === '已停计'" class="cell-sub">管线已迁出，停计</div>
          </td>
          <td>
            <span :class="row.计费口径 === '原有结论' ? 'tag legacy' : 'tag new'">{{ row.计费口径 }}</span>
          </td>
          <td class="note-cell" :title="row.备注">{{ row.备注 }}</td>
        </tr>
        <tr v-if="!summary.items.length">
          <td :colspan="columns.length" class="empty-state">当前条件下没有结算单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ summary.total }} 张结算单（与在廊/已迁出管线一一对应）</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import { listFees } from '@/api/local-service'
import { CUTOVER_DATE, queryFees, type FeeFilters, type FeeSummary } from '@/api/fee-service'

const cutover = CUTOVER_DATE
const columns = [
  '管线编号',
  '权属单位',
  '所属舱室',
  '管线类型',
  '入廊日期',
  '迁出日期',
  '入廊费金额(元)',
  '计费月数',
  '服务费金额(元)',
  '合计金额(元)',
  '计费状态',
  '计费口径',
  '备注',
]

const filters = reactive<FeeFilters>({ 权属单位: '', 计费状态: '' })
const summary = ref<FeeSummary>({
  items: [],
  total: 0,
  billingCount: 0,
  stoppedCount: 0,
  receivableTotal: 0,
  options: { 权属单位: [] },
})

const stats = ref([
  { label: '计费中结算单', value: 0 },
  { label: '已停计（已迁出）', value: 0 },
  { label: '在廊应收合计(元)', value: '0' },
  { label: '结算单总数', value: 0 },
])

function formatMoney(value: number): string {
  return value.toLocaleString('zh-CN')
}

function reload() {
  summary.value = queryFees(filters)
  stats.value = [
    { label: '计费中结算单', value: summary.value.billingCount },
    { label: '已停计（已迁出）', value: summary.value.stoppedCount },
    { label: '在廊应收合计(元)', value: formatMoney(summary.value.receivableTotal) },
    { label: '结算单总数', value: listFees().length },
  ]
}

function resetFilters() {
  filters.权属单位 = ''
  filters.计费状态 = ''
  reload()
}

function exportFees() {
  const header = columns.join(',')
  const lines = listFees().map((row) =>
    [
      row.管线编号,
      row.权属单位,
      row.所属舱室,
      row.管线类型,
      row.入廊日期,
      row.迁出日期,
      row.入廊费金额,
      row.计费月数,
      row.服务费金额,
      row.合计金额,
      row.计费状态,
      row.计费口径,
      `"${row.备注.replace(/"/g, '""')}"`,
    ].join(','),
  )
  const blob = new Blob([`﻿${[header, ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = '入廊费与服务费结算单.csv'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

onMounted(reload)
</script>
