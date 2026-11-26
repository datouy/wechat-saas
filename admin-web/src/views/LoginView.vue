<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()
const loading = ref(false)
const error = ref('')
const form = reactive({
  tenantCode: 't-default',
  username: 'admin',
  password: 'admin123'
})

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await auth.login(form.tenantCode, form.username, form.password)
    router.push('/dashboard')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-copy">
      <p class="eyebrow">COMMUNITY COMMERCE OS</p>
      <h1>让社区经营<br />回到人的尺度。</h1>
      <p>邻里团把商品、订单、会员和经营洞察放进一块温润的玻璃工作台。</p>
      <div class="login-benefits">
        <span>多租户隔离</span><span>订单履约</span><span>会员积分</span><span>审计留痕</span>
      </div>
    </div>
    <form class="login-panel glass-card" @submit.prevent="submit">
      <div class="login-mark">邻</div>
      <p class="eyebrow">WELCOME BACK</p>
      <h2>进入经营台</h2>
      <label class="field">
        <span>租户标识</span>
        <input v-model="form.tenantCode" autocomplete="organization" required />
      </label>
      <label class="field">
        <span>用户名</span>
        <input v-model="form.username" autocomplete="username" required />
      </label>
      <label class="field">
        <span>密码</span>
        <input v-model="form.password" type="password" autocomplete="current-password" required />
      </label>
      <p class="login-hint">本地体验：t-default / admin / admin123</p>
      <p v-if="error" class="form-error">{{ error }}</p>
      <button class="button primary full" type="submit" :disabled="loading">{{ loading ? '正在进入…' : '登录' }}</button>
    </form>
  </div>
</template>

