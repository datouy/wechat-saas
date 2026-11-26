<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import type { OrderPageRow } from '../types'

const orders = ref<OrderPageRow[]>([])
const status = ref('')
const loading = ref(true)
const error = ref('')

const deliverDialog = ref(false)
const deliverTarget = ref<OrderPageRow | null>(null)
const deliverForm = reactive({ company: '', trackingNo: '' })

const refundDialog = ref(false)
const refundTarget = ref<OrderPageRow | null>(null)
const refundForm = reactive({ amountYuan: 0, reason: '' })

const statuses = [
  { value: '', label: '全部' },
  { value: 'PENDING', label: '待支付' },
  { value: 'PAID', label: '已支付' },
  { value: 'DELIVERING', label: '配送中' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'REFUNDED', label: '已退款' },
  { value: 'CANCELLED', label: '已取消' }
]

function money(cents: number) {
  return '¥' + (Number(cents || 0) / 100).toFixed(2)
}

function time(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
}

function remaining(row: OrderPageRow) {
  return Math.max(0, row.payAmountCent - (row.refundedAmountCent || 0))
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await api.orders({ status: status.value || undefined, page: 1, size: 100 })
    orders.value = result.content
  } catch (err) {
    error.value = err instanceof Error ? err.message : '订单加载失败'
  } finally {
    loading.value = false
  }
}

function setStatus(value: string) {
  status.value = value
  load()
}

async function pay(row: OrderPageRow) {
  try {
    await api.payOrder(row.id)
    ElMessage.success('订单已标记支付')
    await load()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '支付失败')
  }
}

function openDeliver(row: OrderPageRow) {
  deliverTarget.value = row
  deliverForm.company = row.logisticsCompany || '顺丰'
  deliverForm.trackingNo = row.logisticsNo || ''
  deliverDialog.value = true
}

async function saveDeliver() {
  if (!deliverTarget.value) return
  if (!deliverForm.company.trim() || !deliverForm.trackingNo.trim()) {
    ElMessage.warning('请填写物流公司和单号')
    return
  }
  try {
    await api.deliverOrder(deliverTarget.value.id, { company: deliverForm.company, trackingNo: deliverForm.trackingNo })
    ElMessage.success('订单已发货')
    deliverDialog.value = false
    await load()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '发货失败')
  }
}

async function complete(row: OrderPageRow) {
  try {
    await ElMessageBox.confirm('确认客户已收货并完成订单？', '完成订单', { type: 'info' })
    await api.completeOrder(row.id)
    ElMessage.success('订单已完成')
    await load()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

async function cancel(row: OrderPageRow) {
  try {
    const result = await ElMessageBox.prompt('填写取消原因', '取消订单', { inputValue: '商家取消', inputPlaceholder: '取消原因' })
    await api.cancelOrder(row.id, result.value || '商家取消')
    ElMessage.success('订单已取消并释放库存')
    await load()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err instanceof Error ? err.message : '取消失败')
  }
}

function openRefund(row: OrderPageRow) {
  refundTarget.value = row
  refundForm.amountYuan = remaining(row) / 100
  refundForm.reason = '用户申请退款'
  refundDialog.value = true
}

async function saveRefund() {
  if (!refundTarget.value) return
  const amountCent = Math.round(Number(refundForm.amountYuan || 0) * 100)
  if (amountCent <= 0) {
    ElMessage.warning('退款金额必须大于 0')
    return
  }
  try {
    await api.refundOrder(refundTarget.value.id, amountCent, refundForm.reason || '用户申请退款')
    ElMessage.success('退款已完成')
    refundDialog.value = false
    await load()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '退款失败')
  }
}

onMounted(load)
</script>

<template>
  <div class="view-stack">
    <section class="view-head glass-card">
      <div><p class="eyebrow">FULFILLMENT</p><h2>订单履约</h2><p>从支付、发货到退款，状态清晰，动作可追溯。</p></div>
      <span class="online-pill"><i></i> {{ orders.length }} 条记录</span>
    </section>
    <div class="filter-capsules">
      <button v-for="item in statuses" :key="item.value" type="button" :class="{ active: status === item.value }" @click="setStatus(item.value)">{{ item.label }}</button>
    </div>
    <div v-if="error" class="form-error">{{ error }}</div>
    <el-skeleton v-if="loading" :rows="5" animated />
    <section v-else class="glass-card table-card" v-tilt>
      <el-table :data="orders" class="glass-table" empty-text="暂无订单">
        <el-table-column prop="orderNo" label="订单号" min-width="170" />
        <el-table-column prop="memberName" label="客户" width="100" />
        <el-table-column label="实付" width="110"><template #default="{ row }">{{ money(row.payAmountCent) }}</template></el-table-column>
        <el-table-column label="已退" width="100"><template #default="{ row }">{{ money(row.refundedAmountCent) }}</template></el-table-column>
        <el-table-column label="状态" width="105"><template #default="{ row }"><span class="status-pill">{{ row.status }}</span></template></el-table-column>
        <el-table-column label="物流" min-width="130"><template #default="{ row }"><span v-if="row.logisticsNo">{{ row.logisticsCompany }} {{ row.logisticsNo }}</span><span v-else class="muted">-</span></template></el-table-column>
        <el-table-column label="创建时间" min-width="150"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="230">
          <template #default="{ row }">
            <div class="order-actions">
              <button v-if="row.status === 'PENDING'" type="button" class="text-link" @click="pay(row)">确认支付</button>
              <button v-if="row.status === 'PAID'" type="button" class="text-link" @click="openDeliver(row)">发货</button>
              <button v-if="row.status === 'DELIVERING'" type="button" class="text-link" @click="complete(row)">完成</button>
              <button v-if="['PAID','DELIVERING','COMPLETED'].includes(row.status) && remaining(row) > 0" type="button" class="text-link danger" @click="openRefund(row)">退款</button>
              <button v-if="row.status === 'PENDING'" type="button" class="text-link danger" @click="cancel(row)">取消</button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="deliverDialog" title="订单发货" width="420px">
      <p class="dialog-hint">{{ deliverTarget?.orderNo }} · {{ deliverTarget?.memberName }}</p>
      <el-form label-position="top">
        <el-form-item label="物流公司"><el-input v-model="deliverForm.company" maxlength="50" /></el-form-item>
        <el-form-item label="物流单号"><el-input v-model="deliverForm.trackingNo" maxlength="64" /></el-form-item>
      </el-form>
      <template #footer><button class="button" type="button" @click="deliverDialog = false">取消</button><button class="button primary" type="button" @click="saveDeliver">确认发货</button></template>
    </el-dialog>

    <el-dialog v-model="refundDialog" title="订单退款" width="440px">
      <p class="dialog-hint">{{ refundTarget?.orderNo }} · 可退 {{ money(refundTarget ? remaining(refundTarget) : 0) }}</p>
      <el-form label-position="top">
        <el-form-item label="退款金额（元）"><el-input-number v-model="refundForm.amountYuan" :min="0.01" :precision="2" :step="1" /></el-form-item>
        <el-form-item label="退款原因"><el-input v-model="refundForm.reason" maxlength="200" /></el-form-item>
      </el-form>
      <template #footer><button class="button" type="button" @click="refundDialog = false">取消</button><button class="button primary" type="button" @click="saveRefund">确认退款</button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.order-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.order-actions .danger { color: #9f3f32; }
.dialog-hint { margin: 0 0 14px; color: var(--muted); font-size: 12px; }
.muted { color: var(--muted); }
</style>

