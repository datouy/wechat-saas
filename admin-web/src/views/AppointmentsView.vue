<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import type { AppointmentRow, AppointmentServiceRow } from '../types'

const services = ref<AppointmentServiceRow[]>([])
const appointments = ref<AppointmentRow[]>([])
const loading = ref(true)
const error = ref('')
const dialog = ref(false)
const form = reactive({ name: '', priceYuan: 0, capacityPerSlot: 1, slots: '09:00,10:00,14:00,15:00' })

function money(cents: number) { return '¥' + (Number(cents || 0) / 100).toFixed(2) }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [svc, appts] = await Promise.all([api.appointmentServices(), api.appointments()])
    services.value = svc
    appointments.value = appts
  } catch (err) { error.value = err instanceof Error ? err.message : '预约加载失败' }
  finally { loading.value = false }
}

function openCreate() {
  form.name = ''
  form.priceYuan = 0
  form.capacityPerSlot = 1
  form.slots = '09:00,10:00,14:00,15:00'
  dialog.value = true
}

async function save() {
  if (!form.name.trim()) { ElMessage.warning('请填写服务名称'); return }
  try {
    await api.createAppointmentService({
      name: form.name.trim(),
      priceCent: Math.round(form.priceYuan * 100),
      durationMinutes: 60,
      capacityPerSlot: form.capacityPerSlot,
      slots: form.slots.split(',').map(item => item.trim()).filter(Boolean),
      enabled: true
    })
    ElMessage.success('预约服务已创建')
    dialog.value = false
    await load()
  } catch (err) { ElMessage.error(err instanceof Error ? err.message : '创建失败') }
}

async function complete(row: AppointmentRow) {
  try {
    await ElMessageBox.confirm('确认服务已完成？', '完成预约', { type: 'info' })
    await api.completeAppointment(row.id)
    ElMessage.success('预约已完成')
    await load()
  } catch (err) { if (err !== 'cancel') ElMessage.error(err instanceof Error ? err.message : '操作失败') }
}

async function cancel(row: AppointmentRow) {
  try {
    await ElMessageBox.confirm('确认取消该预约？', '取消预约', { type: 'warning' })
    await api.cancelAppointment(row.id)
    ElMessage.success('预约已取消')
    await load()
  } catch (err) { if (err !== 'cancel') ElMessage.error(err instanceof Error ? err.message : '操作失败') }
}

onMounted(load)
</script>

<template>
  <div class="view-stack">
    <section class="view-head glass-card">
      <div><p class="eyebrow">APPOINTMENTS</p><h2>预约服务</h2><p>服务项目、时段容量与会员预约。</p></div>
      <button type="button" class="button primary" @click="openCreate">新增服务</button>
    </section>
    <div v-if="error" class="form-error">{{ error }}</div>
    <el-skeleton v-if="loading" :rows="4" animated />
    <template v-else>
      <section class="service-grid">
        <article v-for="service in services" :key="service.id" class="glass-card service-card" v-tilt>
          <div class="service-head"><h3>{{ service.name }}</h3><span class="status-pill" :class="{ off: !service.enabled }">{{ service.enabled ? '启用' : '停用' }}</span></div>
          <p>{{ money(service.priceCent) }} · {{ service.durationMinutes }} 分钟 · 每时段 {{ service.capacityPerSlot }} 人</p>
          <div class="slot-list"><span v-for="slot in service.slots" :key="slot">{{ slot }}</span></div>
        </article>
      </section>
      <section class="glass-card table-card" v-tilt>
        <el-table :data="appointments" class="glass-table" empty-text="暂无预约">
          <el-table-column prop="serviceName" label="服务" min-width="130" />
          <el-table-column label="日期" width="120"><template #default="{ row }">{{ row.appointmentDate }}</template></el-table-column>
          <el-table-column prop="slot" label="时段" width="90" />
          <el-table-column prop="memberId" label="会员 ID" width="100" />
          <el-table-column prop="status" label="状态" width="110" />
          <el-table-column prop="note" label="备注" min-width="150" />
          <el-table-column label="操作" width="150"><template #default="{ row }"><button v-if="row.status === 'BOOKED'" type="button" class="text-link" @click="complete(row)">完成</button><button v-if="row.status === 'BOOKED'" type="button" class="text-link danger" @click="cancel(row)">取消</button></template></el-table-column>
        </el-table>
      </section>
    </template>

    <el-dialog v-model="dialog" title="新增预约服务" width="460px">
      <el-form label-position="top">
        <el-form-item label="服务名称"><el-input v-model="form.name" maxlength="40" /></el-form-item>
        <el-form-item label="价格（元）"><el-input-number v-model="form.priceYuan" :min="0" :precision="2" /></el-form-item>
        <el-form-item label="每时段容量"><el-input-number v-model="form.capacityPerSlot" :min="1" /></el-form-item>
        <el-form-item label="时段（逗号分隔）"><el-input v-model="form.slots" /></el-form-item>
      </el-form>
      <template #footer><button class="button" type="button" @click="dialog = false">取消</button><button class="button primary" type="button" @click="save">创建</button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.service-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 14px; }
.service-card { padding: 20px; }
.service-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.service-head h3 { margin: 0; font-size: 18px; }
.service-card p { color: var(--muted); font-size: 11px; }
.slot-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.slot-list span { padding: 4px 8px; border-radius: 999px; background: rgba(255,255,255,.42); font-size: 10px; }
.danger { color: #9f3f32; }
@media (max-width: 900px) { .service-grid { grid-template-columns: 1fr; } }
</style>

