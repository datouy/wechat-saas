<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import type { CouponRow, CouponTemplateRow } from '../types'

const templates = ref<CouponTemplateRow[]>([])
const coupons = ref<CouponRow[]>([])
const loading = ref(true)
const error = ref('')
const dialog = ref(false)
const editingId = ref<number | null>(null)
const form = reactive({ name: '', thresholdYuan: 0, amountYuan: 0, validDays: 30, limitPerMember: 1, enabled: true })

function money(cents: number) { return '¥' + (Number(cents || 0) / 100).toFixed(2) }
function time(value: string) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [tpl, rows] = await Promise.all([api.couponTemplates(), api.issuedCoupons()])
    templates.value = tpl
    coupons.value = rows
  } catch (err) { error.value = err instanceof Error ? err.message : '优惠券加载失败' }
  finally { loading.value = false }
}

function openCreate() {
  editingId.value = null
  form.name = ''
  form.thresholdYuan = 0
  form.amountYuan = 0
  form.validDays = 30
  form.limitPerMember = 1
  form.enabled = true
  dialog.value = true
}

function openEdit(row: CouponTemplateRow) {
  editingId.value = row.id
  form.name = row.name
  form.thresholdYuan = row.thresholdCent / 100
  form.amountYuan = row.amountCent / 100
  form.validDays = row.validDays
  form.limitPerMember = row.limitPerMember
  form.enabled = row.enabled
  dialog.value = true
}

async function save() {
  if (!form.name.trim() || form.amountYuan <= 0) { ElMessage.warning('请填写名称和优惠金额'); return }
  const payload = {
    name: form.name.trim(),
    thresholdCent: Math.round(form.thresholdYuan * 100),
    amountCent: Math.round(form.amountYuan * 100),
    validDays: form.validDays,
    limitPerMember: form.limitPerMember,
    enabled: form.enabled
  }
  try {
    if (editingId.value) await api.updateCouponTemplate(editingId.value, payload)
    else await api.createCouponTemplate(payload)
    ElMessage.success('优惠券已保存')
    dialog.value = false
    await load()
  } catch (err) { ElMessage.error(err instanceof Error ? err.message : '保存失败') }
}

onMounted(load)
</script>

<template>
  <div class="view-stack">
    <section class="view-head glass-card">
      <div><p class="eyebrow">COUPONS</p><h2>优惠券</h2><p>满减模板、会员领取与使用状态。</p></div>
      <button type="button" class="button primary" @click="openCreate">新增优惠券</button>
    </section>
    <div v-if="error" class="form-error">{{ error }}</div>
    <el-skeleton v-if="loading" :rows="5" animated />
    <template v-else>
      <section class="glass-card table-card" v-tilt>
        <div class="panel-heading" style="padding: 16px 12px 0"><h3>优惠券模板</h3><span class="online-pill"><i></i> {{ templates.length }} 个</span></div>
        <el-table :data="templates" class="glass-table" empty-text="暂无优惠券模板">
          <el-table-column prop="name" label="名称" min-width="150" />
          <el-table-column label="门槛" width="110"><template #default="{ row }">{{ money(row.thresholdCent) }}</template></el-table-column>
          <el-table-column label="优惠" width="110"><template #default="{ row }">{{ money(row.amountCent) }}</template></el-table-column>
          <el-table-column prop="validDays" label="有效天数" width="100" />
          <el-table-column prop="limitPerMember" label="每人限领" width="100" />
          <el-table-column label="状态" width="90"><template #default="{ row }"><span class="status-pill" :class="{ off: !row.enabled }">{{ row.enabled ? '启用' : '停用' }}</span></template></el-table-column>
          <el-table-column label="操作" width="90"><template #default="{ row }"><button type="button" class="text-link" @click="openEdit(row)">编辑</button></template></el-table-column>
        </el-table>
      </section>
      <section class="glass-card table-card" v-tilt>
        <div class="panel-heading" style="padding: 16px 12px 0"><h3>已领取优惠券</h3><span class="online-pill"><i></i> {{ coupons.length }} 张</span></div>
        <el-table :data="coupons" class="glass-table" empty-text="暂无领取记录">
          <el-table-column prop="name" label="优惠券" min-width="140" />
          <el-table-column prop="memberId" label="会员 ID" width="100" />
          <el-table-column label="优惠" width="100"><template #default="{ row }">{{ money(row.amountCent) }}</template></el-table-column>
          <el-table-column prop="status" label="状态" width="110" />
          <el-table-column label="到期时间" min-width="160"><template #default="{ row }">{{ time(row.expireAt) }}</template></el-table-column>
        </el-table>
      </section>
    </template>

    <el-dialog v-model="dialog" :title="editingId ? '编辑优惠券' : '新增优惠券'" width="460px">
      <el-form label-position="top">
        <el-form-item label="名称"><el-input v-model="form.name" maxlength="40" /></el-form-item>
        <div class="dialog-grid">
          <el-form-item label="使用门槛（元）"><el-input-number v-model="form.thresholdYuan" :min="0" :precision="2" /></el-form-item>
          <el-form-item label="优惠金额（元）"><el-input-number v-model="form.amountYuan" :min="0.01" :precision="2" /></el-form-item>
        </div>
        <div class="dialog-grid">
          <el-form-item label="有效天数"><el-input-number v-model="form.validDays" :min="1" /></el-form-item>
          <el-form-item label="每人限领"><el-input-number v-model="form.limitPerMember" :min="1" /></el-form-item>
        </div>
        <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
      </el-form>
      <template #footer><button class="button" type="button" @click="dialog = false">取消</button><button class="button primary" type="button" @click="save">保存</button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.dialog-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
</style>

