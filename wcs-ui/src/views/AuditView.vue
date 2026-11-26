<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api/client'
import type { AuditRow } from '../types'

const rows = ref<AuditRow[]>([])
const action = ref('')
const loading = ref(true)
const error = ref('')

function time(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''
}

function detail(value: string) {
  if (!value) return '-'
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch (err) {
    return value
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await api.auditLogs({ action: action.value || undefined, page: 1, size: 100 })
    rows.value = result.content
  } catch (err) {
    error.value = err instanceof Error ? err.message : '审计日志加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="view-stack">
    <section class="view-head glass-card">
      <div><p class="eyebrow">AUDIT TRAIL</p><h2>审计日志</h2><p>每一次商品、库存、订单和会员动作都留下可追溯记录。</p></div>
      <div class="search-row"><input v-model="action" class="glass-input" placeholder="按 action 筛选，例如 order.refund" @keyup.enter="load" /><button type="button" class="button primary" @click="load">查询</button></div>
    </section>
    <div v-if="error" class="form-error">{{ error }}</div>
    <el-skeleton v-if="loading" :rows="5" animated />
    <section v-else class="glass-card table-card" v-tilt>
      <el-table :data="rows" class="glass-table" empty-text="暂无审计记录">
        <el-table-column label="时间" width="160"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
        <el-table-column prop="actorName" label="操作人" width="100" />
        <el-table-column prop="action" label="动作" min-width="160" />
        <el-table-column prop="resource" label="资源" width="110" />
        <el-table-column prop="resourceId" label="资源 ID" width="100" />
        <el-table-column label="详情" min-width="240"><template #default="{ row }"><pre class="audit-detail">{{ detail(row.detail) }}</pre></template></el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.audit-detail { max-width: 420px; max-height: 90px; margin: 0; overflow: auto; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 9px; line-height: 1.5; white-space: pre-wrap; }
</style>

