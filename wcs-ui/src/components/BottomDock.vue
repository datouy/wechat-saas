<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const items = [
  { path: '/dashboard', icon: '今', label: '今天' },
  { path: '/products', icon: '商', label: '商品' },
  { path: '/orders', icon: '单', label: '订单' },
  { path: '/members', icon: '客', label: '客户' },
  { path: '/settings', icon: '设', label: '设置' },
  { path: '/audit', icon: '审', label: '审计' }
]

function fullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.()
  } else {
    document.documentElement.requestFullscreen?.()
  }
}
</script>

<template>
  <nav class="bottom-dock" aria-label="快速导航">
    <button
      v-for="item in items"
      :key="item.path"
      type="button"
      class="dock-item"
      :class="{ active: route.path === item.path }"
      :data-label="item.label"
      @click="router.push(item.path)"
    >
      <span>{{ item.icon }}</span>
    </button>
    <button type="button" class="dock-item" data-label="全屏" @click="fullscreen"><span>⛶</span></button>
  </nav>
</template>

