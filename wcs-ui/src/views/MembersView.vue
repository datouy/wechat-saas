<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import type { MemberRow, PointsView } from '../types'

const members = ref<MemberRow[]>([])
const keyword = ref('')
const loading = ref(true)
const error = ref('')

const pointsDialog = ref(false)
const pointsTarget = ref<MemberRow | null>(null)
const pointsView = ref<PointsView | null>(null)
const pointsForm = reactive({ amount: 0, reason: '' })

function money(cents: number) {
  return '¥' + (Number(cents || 0) / 100).toFixed(2)
}

function time(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await api.members({ keyword: keyword.value || undefined, page: 1, size: 100 })
    members.value = result.content
  } catch (err) {
    error.value = err instanceof Error ? err.message : '会员加载失败'
  } finally {
    loading.value = false
  }
}

async function openPoints(member: MemberRow) {
  pointsTarget.value = member
  pointsForm.amount = 0
  pointsForm.reason = ''
  pointsView.value = await api.memberPoints(member.id)
  pointsDialog.value = true
}

async function savePoints() {
  if (!pointsTarget.value || pointsForm.amount === 0 || !pointsForm.reason.trim()) {
    ElMessage.warning('请输入非 0 积分和调整原因')
    return
  }
  try {
    pointsView.value = await api.adjustPoints(pointsTarget.value.id, pointsForm.amount, pointsForm.reason)
    ElMessage.success('积分已调整')
    pointsForm.amount = 0
    pointsForm.reason = ''
    await load()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '积分调整失败')
  }
}

onMounted(load)
</script>

<template>
  <div class="view-stack">
    <section class="view-head glass-card">
      <div><p class="eyebrow">MEMBERS</p><h2>社区会员</h2><p>看见复购、积分和每一次被认真对待的关系。</p></div>
      <div class="search-row"><input v-model="keyword" class="glass-input" placeholder="搜索昵称" @keyup.enter="load" /><button type="button" class="button primary" @click="load">搜索</button></div>
    </section>
    <div v-if="error" class="form-error">{{ error }}</div>
    <el-skeleton v-if="loading" :rows="5" animated />
    <section v-else class="glass-card table-card" v-tilt>
      <el-table :data="members" class="glass-table" empty-text="暂无会员">
        <el-table-column label="会员" min-width="180">
          <template #default="{ row }"><div class="member-cell"><span>{{ row.nickname.slice(0, 1) }}</span><div><strong>{{ row.nickname }}</strong><small>{{ row.phone || '未留手机号' }}</small></div></div></template>
        </el-table-column>
        <el-table-column prop="points" label="积分" width="90" />
        <el-table-column label="累计消费" width="120"><template #default="{ row }">{{ money(row.totalSpentCent) }}</template></el-table-column>
        <el-table-column prop="orderCount" label="订单数" width="90" />
        <el-table-column label="加入时间" min-width="160"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="100"><template #default="{ row }"><button type="button" class="text-link" @click="openPoints(row)">调整积分</button></template></el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="pointsDialog" title="会员积分" width="620px">
      <div class="points-head">
        <div><span class="muted">会员</span><strong>{{ pointsTarget?.nickname }}</strong></div>
        <div><span class="muted">当前积分</span><strong>{{ pointsView?.balance ?? pointsTarget?.points ?? 0 }}</strong></div>
      </div>
      <el-form label-position="top" class="points-form">
        <el-form-item label="变更积分（正数增加，负数扣减）"><el-input-number v-model="pointsForm.amount" :step="1" /></el-form-item>
        <el-form-item label="调整原因"><el-input v-model="pointsForm.reason" maxlength="200" placeholder="例如：服务补偿 / 线下活动" /></el-form-item>
        <button type="button" class="button primary" @click="savePoints">提交调整</button>
      </el-form>
      <el-table :data="pointsView?.ledger || []" class="glass-table" empty-text="暂无积分流水" max-height="260">
        <el-table-column label="时间" width="150"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
        <el-table-column label="变化" width="90"><template #default="{ row }"><span :class="row.changeAmount > 0 ? 'plus' : 'minus'">{{ row.changeAmount > 0 ? '+' : '' }}{{ row.changeAmount }}</span></template></el-table-column>
        <el-table-column prop="reason" label="原因" min-width="170" />
        <el-table-column prop="refId" label="关联" width="110" />
      </el-table>
    </el-dialog>
  </div>
</template>

<style scoped>
.points-head { margin-bottom: 16px; padding: 16px 18px; display: flex; justify-content: space-between; gap: 20px; border: 1px solid rgba(255,255,255,.42); border-radius: 18px; background: rgba(255,255,255,.3); }
.points-head div { display: grid; gap: 2px; }
.points-head span { font-size: 10px; }
.points-head strong { font-family: Georgia, "Songti SC", serif; font-size: 22px; }
.points-form { margin-bottom: 16px; }
.plus { color: #367146; }
.minus { color: #9f3f32; }
.muted { color: var(--muted); }
</style>

