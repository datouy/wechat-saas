<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import type { SubscriptionAdminData } from '../types'

const data = ref<SubscriptionAdminData | null>(null)
const loading = ref(true)
const error = ref('')
const form = reactive({ memberId: 1, templateId: 'tmpl-order-paid', page: 'pages/orders/orders' })

function time(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-' }

async function load() {
  loading.value = true
  error.value = ''
  try { data.value = await api.subscriptionAdmin() }
  catch (err) { error.value = err instanceof Error ? err.message : '微信配置加载失败' }
  finally { loading.value = false }
}

async function test() {
  try {
    await api.testSubscription({ memberId: form.memberId, templateId: form.templateId, page: form.page, data: { thing1: { value: '订阅消息测试' } } })
    ElMessage.success('测试消息已发送')
    await load()
  } catch (err) { ElMessage.error(err instanceof Error ? err.message : '发送失败') }
}

onMounted(load)
</script>

<template>
  <div class="view-stack">
    <section class="view-head glass-card">
      <div><p class="eyebrow">WECHAT</p><h2>微信能力</h2><p>登录、订阅消息与支付配置入口；本地默认 mock。</p></div>
      <span class="online-pill"><i></i> Java + WeChat Gateway</span>
    </section>
    <div v-if="error" class="form-error">{{ error }}</div>
    <el-skeleton v-if="loading" :rows="4" animated />
    <template v-else>
      <section class="settings-grid">
        <article class="glass-card panel-card" v-tilt>
          <p class="eyebrow">LOGIN</p><h3>微信登录</h3>
          <p class="muted-copy">小程序通过 code2Session 登录；本地 mock 会根据 code 生成稳定 openid。</p>
          <div class="soft-note">接口：POST /api/wx/login</div>
        </article>
        <article class="glass-card panel-card" v-tilt>
          <p class="eyebrow">PAYMENT</p><h3>微信支付</h3>
          <p class="muted-copy">默认 mock 完成支付；生产需配置 AppID、商户号、APIv3 密钥、商户私钥和回调地址。</p>
          <div class="soft-note">接口：POST /api/wx/orders/{id}/pay</div>
        </article>
        <article class="glass-card panel-card" v-tilt>
          <p class="eyebrow">TEMPLATES</p><h3>订阅模板</h3>
          <p class="muted-copy">当前已配置 {{ Object.keys(data?.templates || {}).length }} 个事件模板。</p>
          <div class="soft-note">通过 APP_WECHAT_SUBSCRIBE_TEMPLATES 注入 JSON</div>
        </article>
      </section>

      <section class="glass-card panel-card" v-tilt>
        <div class="panel-heading"><div><p class="eyebrow">TEST SEND</p><h3>发送测试订阅消息</h3></div></div>
        <div class="test-row">
          <el-input-number v-model="form.memberId" :min="1" />
          <el-input v-model="form.templateId" placeholder="模板 ID" />
          <el-input v-model="form.page" placeholder="跳转页面" />
          <button type="button" class="button primary" @click="test">发送测试</button>
        </div>
      </section>

      <section class="glass-card table-card" v-tilt>
        <el-table :data="data?.outbox || []" class="glass-table" empty-text="暂无消息记录">
          <el-table-column prop="event" label="事件" width="100" />
          <el-table-column prop="templateId" label="模板 ID" min-width="150" />
          <el-table-column prop="status" label="状态" width="100" />
          <el-table-column prop="attempts" label="尝试" width="80" />
          <el-table-column label="发送时间" min-width="160"><template #default="{ row }">{{ time(row.sentAt) }}</template></el-table-column>
          <el-table-column prop="error" label="错误" min-width="160" />
        </el-table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.test-row { display: grid; grid-template-columns: 120px 1fr 1fr auto; gap: 10px; align-items: center; }
@media (max-width: 800px) { .test-row { grid-template-columns: 1fr; } }
</style>

