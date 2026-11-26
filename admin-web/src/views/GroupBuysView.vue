<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import type { GroupBuyRow } from '../types'

const rows = ref<GroupBuyRow[]>([])
const loading = ref(true)
const error = ref('')
const dialog = ref(false)
const form = reactive({ title: '', productId: 1, groupPriceYuan: 9.9, minParticipants: 2, maxParticipants: 50 })

function money(cents: number) { return '¥' + (Number(cents || 0) / 100).toFixed(2) }
function time(value: string) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '' }

async function load() {
  loading.value = true
  error.value = ''
  try { rows.value = await api.groupBuys() }
  catch (err) { error.value = err instanceof Error ? err.message : '团购加载失败' }
  finally { loading.value = false }
}

function openCreate() {
  form.title = ''
  form.productId = 1
  form.groupPriceYuan = 9.9
  form.minParticipants = 2
  form.maxParticipants = 50
  dialog.value = true
}

async function save() {
  if (!form.title.trim() || form.productId <= 0 || form.groupPriceYuan <= 0) { ElMessage.warning('请填写标题、商品和团购价'); return }
  try {
    await api.createGroupBuy({
      title: form.title.trim(),
      productId: form.productId,
      groupPriceCent: Math.round(form.groupPriceYuan * 100),
      minParticipants: form.minParticipants,
      maxParticipants: form.maxParticipants
    })
    ElMessage.success('团购已创建')
    dialog.value = false
    await load()
  } catch (err) { ElMessage.error(err instanceof Error ? err.message : '创建失败') }
}

async function cancel(row: GroupBuyRow) {
  try {
    await ElMessageBox.confirm('取消后活动将结束，是否继续？', '取消团购', { type: 'warning' })
    await api.cancelGroupBuy(row.id)
    ElMessage.success('团购已取消')
    await load()
  } catch (err) { if (err !== 'cancel') ElMessage.error(err instanceof Error ? err.message : '操作失败') }
}

onMounted(load)
</script>

<template>
  <div class="view-stack">
    <section class="view-head glass-card">
      <div><p class="eyebrow">GROUP BUY</p><h2>社区团购</h2><p>成团进度、截止时间与参团人数。</p></div>
      <button type="button" class="button primary" @click="openCreate">创建团购</button>
    </section>
    <div v-if="error" class="form-error">{{ error }}</div>
    <el-skeleton v-if="loading" :rows="4" animated />
    <section v-else class="group-grid">
      <article v-for="row in rows" :key="row.id" class="glass-card group-card" v-tilt>
        <div class="group-top"><span class="eyebrow">{{ row.productName }}</span><span class="status-pill">{{ row.status }}</span></div>
        <h3>{{ row.title }}</h3>
        <p>{{ money(row.groupPriceCent) }} · {{ row.participantCount }}/{{ row.maxParticipants }} 人 · 还差 {{ row.remaining }} 人成团</p>
        <div class="progress"><span :style="{ width: Math.min(100, row.participantCount / row.maxParticipants * 100) + '%' }"></span></div>
        <div class="group-foot"><small>截止 {{ time(row.endAt) }}</small><button v-if="row.status !== 'CANCELLED'" type="button" class="text-link danger" @click="cancel(row)">取消</button></div>
      </article>
    </section>

    <el-dialog v-model="dialog" title="创建团购" width="480px">
      <el-form label-position="top">
        <el-form-item label="活动标题"><el-input v-model="form.title" maxlength="80" /></el-form-item>
        <el-form-item label="商品 ID"><el-input-number v-model="form.productId" :min="1" /></el-form-item>
        <el-form-item label="团购价（元）"><el-input-number v-model="form.groupPriceYuan" :min="0.01" :precision="2" /></el-form-item>
        <div class="dialog-grid">
          <el-form-item label="成团人数"><el-input-number v-model="form.minParticipants" :min="2" /></el-form-item>
          <el-form-item label="人数上限"><el-input-number v-model="form.maxParticipants" :min="2" /></el-form-item>
        </div>
        <p class="hint">未填写截止时间时默认 24 小时；团购价不能高于商品售价。</p>
      </el-form>
      <template #footer><button class="button" type="button" @click="dialog = false">取消</button><button class="button primary" type="button" @click="save">创建</button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.group-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 14px; }
.group-card { padding: 22px; }
.group-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.group-card h3 { margin: 6px 0 8px; font-size: 20px; }
.group-card p { color: var(--muted); font-size: 12px; }
.progress { height: 7px; overflow: hidden; border-radius: 99px; background: rgba(255,255,255,.4); }
.progress span { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
.group-foot { margin-top: 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--muted); }
.danger { color: #9f3f32; }
.dialog-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.hint { color: var(--muted); font-size: 11px; }
@media (max-width: 800px) { .group-grid { grid-template-columns: 1fr; } }
</style>

