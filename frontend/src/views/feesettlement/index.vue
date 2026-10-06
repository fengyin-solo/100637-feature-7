<template>
  <section class="page" data-module="feesettlement">
    <header class="page-head">
      <div>
        <h2>入廊费用结算</h2>
        <p class="page-desc">
          入廊费与服务费结算单全部由入廊管线台账派生，条数与台账一致；管线办理迁出后，权属单位结算单同步停计费并可直接看到迁出信息。
        </p>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">结算单总数（=管线台账条数）</span>
        <strong class="stat-value">{{ stats.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">计费中</span>
        <strong class="stat-value">{{ stats.billing }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">迁出已停计（新口径）</span>
        <strong class="stat-value">{{ stats.stopped }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">历史结论保留（老口径）</span>
        <strong class="stat-value">{{ stats.historical }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>权属单位</span>
        <select v-model="owner">
          <option value="">全部权属单位</option>
          <option v-for="item in owners" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="owner = ''; reload()">重置条件</button>
      <label class="filter-item checkbox-item">
        <input v-model="onlyStopped" type="checkbox" @change="reload" />
        <span>只看迁出停计</span>
      </label>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in shownRows" :key="row.settleNo" :class="{ 'moved-row': row.pipelineStatus === '已迁出' }">
          <td>{{ row.settleNo }}</td>
          <td>{{ row.pipelineNo }}</td>
          <td>{{ row.owner }}</td>
          <td>{{ row.chamber }}</td>
          <td>{{ row.pipelineType }}</td>
          <td>{{ row.entryDate || '—' }}</td>
          <td>{{ row.moveOutDate || '—' }}</td>
          <td>{{ row.entryFeeStatus }}</td>
          <td>{{ row.serviceFeeStatus }}</td>
          <td>{{ row.ruleScope }}</td>
        </tr>
        <tr v-if="!shownRows.length">
          <td :colspan="columns.length" class="empty-state">暂无符合条件的结算单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>
        共 {{ shownRows.length }} 张结算单
        <template v-if="owner">（权属单位：{{ owner }}）</template>
        ；切换之日 {{ switchDate }} 之前的迁出沿用老口径既有结论，之后的迁出按新口径自迁出当月停计。
      </span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { feeOwners, feeStats, listFeeSettlements, SWITCH_DATE } from '@/api/fee-service'
import type { PipelineFeeRow } from '@/data/types'

const columns = ['结算单编号', '管线编号', '权属单位', '所属舱室', '管线类型', '入廊日期', '迁出日期', '入廊费', '服务费', '结算口径']
const switchDate = SWITCH_DATE

const owner = ref('')
const onlyStopped = ref(false)
const rows = ref<PipelineFeeRow[]>([])
const owners = ref<string[]>([])

const shownRows = computed(() =>
  onlyStopped.value ? rows.value.filter((row) => row.serviceFeeStatus.startsWith('服务费已停计')) : rows.value,
)
const stats = computed(() => feeStats(owner.value))

function reload() {
  owners.value = feeOwners()
  rows.value = listFeeSettlements(owner.value)
}

onMounted(reload)
</script>
