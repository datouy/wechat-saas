<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api/client'
import type { DashboardData } from '../types'

const data = ref<DashboardData | null>(null)
const loading = ref(true)
const error = ref('')
const expanded = ref<string | null>(null)

const metrics = computed(() => {
  if (!data.value) return []
  return [
    { key: 'today', label: '今日成交', value: formatMoney(data.value.todayAmountCent), hint: data.value.todayOrders + ' 笔已支付订单', detail: '今日已支付订单金额合计，按租户隔离统计。' },
    { key: 'pending', label: '待处理订单', value: String(data.value.pendingOrders), hint: '需要商家处理', detail: '待支付或待确认到账的订单，优先处理可减少库存占用。' },
    { key: 'members', label: '会员总数', value: String(data.value.memberCount), hint: '已沉淀客户', detail: '当前租户下的会员总数，用于观察社区复购基础。' },
    { key: 'products', label: '在售商品', value: String(data.value.productCount), hint: '经营中的 SKU', detail: '当前租户的商品数量，后续可扩展低库存与动销筛选。' }
  ]
})

function formatMoney(cents: number) {
  return '¥' + (cents / 100).toFixed(2)
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function toggleMetric(key: string) {
  expanded.value = expanded.value === key ? null : key
}

onMounted(async () => {
  try {
    data.value = await api.dashboard()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '看板加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="view-stack">
    <section class="hero-strip glass-card" v-tilt>
      <div>
        <p class="eyebrow">TODAY AT A GLANCE</p>
        <h2>今天的社区，正在发生。</h2>
        <p>把订单、履约和会员变化收在同一张玻璃卡片里，少一点翻找，多一点判断。</p>
      </div>
      <div class="hero-badge">
        <span>实时经营</span>
        <strong>{{ data?.todayOrders ?? 0 }}</strong>
        <small>今日订单</small>
      </div>
    </section>

    <div v-if="error" class="form-error">{{ error }}</div>
    <el-skeleton v-if="loading" :rows="5" animated />
    <template v-else>
      <section class="metric-grid">
        <button
          v-for="metric in metrics"
          :key="metric.key"
          type="button"
          class="metric-card glass-card"
          :class="{ active: expanded === metric.key, dimmed: expanded && expanded !== metric.key }"
          v-tilt
          @click="toggleMetric(metric.key)"
        >
          <span class="metric-label">{{ metric.label }}</span>
          <strong>{{ metric.value }}</strong>
          <small>{{ metric.hint }}</small>
          <span class="metric-arrow">↗</span>
        </button>
      </section>

      <Transition name="expand">
        <div v-if="expanded" class="metric-detail glass-card">
          <p class="eyebrow">DETAIL</p>
          <h3>{{ metrics.find(item => item.key === expanded)?.label }}</h3>
          <p>{{ metrics.find(item => item.key === expanded)?.detail }}</p>
          <button type="button" class="button ghost small" @click="expanded = null">收起</button>
        </div>
      </Transition>

      <section class="panel-grid">
        <article class="glass-card panel-card" v-tilt>
          <div class="panel-heading">
            <div><p class="eyebrow">RECENT ORDERS</p><h3>最近订单</h3></div>
            <router-link class="text-link" to="/orders">查看全部</router-link>
          </div>
          <el-table :data="data?.recentOrders || []" class="glass-table" empty-text="暂无订单">
            <el-table-column prop="orderNo" label="订单号" min-width="170" />
            <el-table-column prop="memberName" label="客户" width="110" />
            <el-table-column label="金额" width="120">
              <template #default="{ row }">{{ formatMoney(row.payAmountCent) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{ row }"><span class="status-pill">{{ row.status }}</span></template>
            </el-table-column>
            <el-table-column label="时间" min-width="160">
              <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
            </el-table-column>
          </el-table>
        </article>

        <aside class="glass-card panel-card side-panel" v-tilt>
          <p class="eyebrow">NEXT BEST ACTION</p>
          <h3>今天先做什么？</h3>
          <ol class="action-list">
            <li><span>01</span><div><strong>清理待处理订单</strong><small>减少库存占用，及时完成履约。</small></div></li>
            <li><span>02</span><div><strong>看一眼低库存商品</strong><small>为明天的社区团购补货。</small></div></li>
            <li><span>03</span><div><strong>回访高价值会员</strong><small>用积分和优惠券激活复购。</small></div></li>
          </ol>
          <div class="soft-note">数据来自 Java + MySQL 后端，按当前租户实时查询。</div>
        </aside>
      </section>
    </template>
  </div>
</template>

