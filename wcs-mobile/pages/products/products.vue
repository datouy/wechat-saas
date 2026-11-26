<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../../api/client'

const products = ref([])
const loading = ref(true)
const error = ref('')

function money(cents) {
  return '¥' + (Number(cents || 0) / 100).toFixed(2)
}

async function load() {
  if (!uni.getStorageSync('wechat_saas_token')) {
    uni.navigateTo({ url: '/pages/login/login' })
    return
  }
  try {
    const result = await api.products()
    products.value = result.content || []
  } catch (err) {
    error.value = err && err.message ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <view class="page-pad">
    <view class="eyebrow">COMMUNITY CATALOG</view>
    <view class="page-title">社区好物</view>
    <view class="page-note">从附近社区出发，选今天真正需要的东西。</view>
    <view v-if="error" class="error-line">{{ error }}</view>
    <view v-if="loading" class="loading glass">正在加载…</view>
    <view v-else class="list">
      <view v-for="product in products" :key="product.id" class="item glass">
        <view class="item-mark">{{ product.name.slice(0, 1) }}</view>
        <view class="item-main">
          <view class="item-title">{{ product.name }} <text class="pill">{{ product.onSale ? '在售' : '下架' }}</text></view>
          <view class="item-desc">{{ product.description || '社区精选商品' }}</view>
          <view class="item-meta"><text class="price">{{ money(product.priceCent) }}</text><text>库存 {{ product.stock }}</text><text>销量 {{ product.sales }}</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<style>
.page-title { font-family: Georgia, "Songti SC", serif; font-size: 50rpx; margin-top: 4rpx; }
.page-note { margin-top: 8rpx; color: #7d685e; font-size: 22rpx; }
.list { margin-top: 28rpx; display: grid; gap: 16rpx; }
.item { padding: 24rpx; display: grid; grid-template-columns: 78rpx 1fr; gap: 20rpx; }
.item-mark { width: 78rpx; height: 78rpx; display: grid; place-items: center; border-radius: 24rpx; background: rgba(196,91,60,.16); color: #a7462e; font-family: Georgia, serif; font-size: 34rpx; }
.item-main { min-width: 0; }
.item-title { font-size: 28rpx; font-weight: 700; }
.item-desc { margin-top: 6rpx; color: #7d685e; font-size: 21rpx; }
.item-meta { margin-top: 16rpx; display: flex; flex-wrap: wrap; align-items: baseline; gap: 18rpx; color: #7d685e; font-size: 19rpx; }
.price { color: #2b1f1a; font-size: 30rpx; font-weight: 700; }
.loading, .error-line { margin-top: 22rpx; padding: 30rpx; text-align: center; color: #7d685e; font-size: 22rpx; }
.error-line { border-radius: 22rpx; background: rgba(163,59,47,.12); color: #9f3f32; }
</style>

