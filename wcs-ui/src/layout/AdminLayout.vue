<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CommandPalette from '../components/CommandPalette.vue'
import BottomDock from '../components/BottomDock.vue'
import { useAuthStore } from '../store/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const palette = ref<InstanceType<typeof CommandPalette> | null>(null)

const nav = [
  { path: '/dashboard', icon: '今', label: '今天' },
  { path: '/products', icon: '商', label: '商品' },
  { path: '/orders', icon: '单', label: '订单' },
  { path: '/members', icon: '客', label: '客户' },
  { path: '/settings', icon: '设', label: '设置' },
  { path: '/audit', icon: '审', label: '审计' },
  { path: '/coupons', icon: '券', label: '优惠券' },
  { path: '/group-buys', icon: '团', label: '团购' },
  { path: '/forms', icon: '问', label: '问卷' },
  { path: '/appointments', icon: '约', label: '预约' },
  { path: '/wechat', icon: '微', label: '微信能力' }
]

const title = computed(() => String(route.meta.title || '经营台'))

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="admin-shell">
    <aside class="admin-sidebar">
      <div class="admin-brand">
        <span class="brand-orb">邻</span>
        <div>
          <strong>邻里团</strong>
          <small>{{ auth.tenant?.name || '社区经营台' }}</small>
        </div>
      </div>
      <nav class="admin-nav">
        <router-link v-for="item in nav" :key="item.path" :to="item.path" class="admin-nav-link" active-class="active">
          <span class="nav-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </router-link>
      </nav>
      <div class="admin-user">
        <div class="avatar">{{ auth.user?.displayName?.slice(0, 1) || '邻' }}</div>
        <div>
          <strong>{{ auth.user?.displayName || '经营管理员' }}</strong>
          <small>{{ auth.user?.role || 'OWNER' }}</small>
        </div>
        <button type="button" class="text-link" @click="logout">退出</button>
      </div>
    </aside>
    <main class="admin-main">
      <header class="admin-topbar">
        <div>
          <p class="eyebrow">COMMUNITY COMMERCE</p>
          <h1>{{ title }}</h1>
        </div>
        <div class="top-actions">
          <button type="button" class="command-trigger" @click="palette?.open()">⌘K 搜索</button>
          <span class="online-pill"><i></i> 在线</span>
        </div>
      </header>
      <section class="admin-content">
        <router-view />
      </section>
    </main>
    <CommandPalette ref="palette" />
    <BottomDock />
  </div>
</template>

