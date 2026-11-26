<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import type { FormRow, FormStatsRow } from '../types'

const rows = ref<FormRow[]>([])
const loading = ref(true)
const error = ref('')
const dialog = ref(false)
const statsDialog = ref(false)
const stats = ref<FormStatsRow | null>(null)
const form = reactive({ title: '', description: '', fieldLabel: '', required: true })

function time(value: string) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '' }

async function load() {
  loading.value = true
  error.value = ''
  try { rows.value = await api.forms() }
  catch (err) { error.value = err instanceof Error ? err.message : '表单加载失败' }
  finally { loading.value = false }
}

function openCreate() {
  form.title = ''
  form.description = ''
  form.fieldLabel = ''
  form.required = true
  dialog.value = true
}

async function save() {
  if (!form.title.trim() || !form.fieldLabel.trim()) { ElMessage.warning('请填写表单标题和至少一个字段'); return }
  try {
    await api.createForm({
      title: form.title.trim(),
      description: form.description,
      status: 'open',
      fields: [{ id: 'f1', label: form.fieldLabel.trim(), type: 'text', options: [], required: form.required }]
    })
    ElMessage.success('表单已创建')
    dialog.value = false
    await load()
  } catch (err) { ElMessage.error(err instanceof Error ? err.message : '创建失败') }
}

async function openStats(row: FormRow) {
  stats.value = await api.formStats(row.id)
  statsDialog.value = true
}

onMounted(load)
</script>

<template>
  <div class="view-stack">
    <section class="view-head glass-card">
      <div><p class="eyebrow">FORMS</p><h2>问卷与表单</h2><p>社区反馈、需求收集与提交统计。</p></div>
      <button type="button" class="button primary" @click="openCreate">新建表单</button>
    </section>
    <div v-if="error" class="form-error">{{ error }}</div>
    <el-skeleton v-if="loading" :rows="4" animated />
    <section v-else class="glass-card table-card" v-tilt>
      <el-table :data="rows" class="glass-table" empty-text="暂无表单">
        <el-table-column prop="title" label="标题" min-width="160" />
        <el-table-column prop="description" label="说明" min-width="220" />
        <el-table-column label="字段数" width="90"><template #default="{ row }">{{ row.fields.length }}</template></el-table-column>
        <el-table-column prop="status" label="状态" width="90" />
        <el-table-column label="创建时间" min-width="160"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="100"><template #default="{ row }"><button type="button" class="text-link" @click="openStats(row)">查看统计</button></template></el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="dialog" title="新建表单" width="480px">
      <el-form label-position="top">
        <el-form-item label="表单标题"><el-input v-model="form.title" maxlength="80" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="form.description" type="textarea" :rows="3" maxlength="300" /></el-form-item>
        <el-form-item label="第一个字段"><el-input v-model="form.fieldLabel" maxlength="80" placeholder="例如：您最需要什么社区服务？" /></el-form-item>
        <el-form-item label="必填"><el-switch v-model="form.required" /></el-form-item>
      </el-form>
      <template #footer><button class="button" type="button" @click="dialog = false">取消</button><button class="button primary" type="button" @click="save">创建</button></template>
    </el-dialog>

    <el-dialog v-model="statsDialog" title="表单统计" width="560px">
      <p class="stats-total" v-if="stats">{{ stats.title }} · 共 {{ stats.total }} 份提交</p>
      <div v-for="field in stats?.fields || []" :key="field.id" class="stats-field">
        <strong>{{ field.label }}</strong>
        <span>已答 {{ field.answered }}</span>
        <span v-if="field.average !== null">平均分 {{ field.average }}</span>
        <div v-for="(count, key) in field.distribution" :key="key" class="distribution-row"><span>{{ key }}</span><strong>{{ count }}</strong></div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.stats-total { color: var(--muted); }
.stats-field { margin-top: 14px; padding: 14px; border: 1px solid rgba(255,255,255,.4); border-radius: 14px; background: rgba(255,255,255,.28); }
.stats-field strong { display: block; margin-bottom: 8px; }
.stats-field span { margin-right: 12px; color: var(--muted); font-size: 10px; }
.distribution-row { display: flex; justify-content: space-between; padding: 5px 0; border-top: 1px solid rgba(255,255,255,.3); font-size: 11px; }
</style>

