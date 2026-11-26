<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../../api/client'

const orders = ref([])
const loading = ref(true)
const error = ref('')

function money(cents) {
  return '¥' + (Number(cents || 0) / 100).toFixed(2)
}

function time(value) {
  return value ? String(value).replace('T', ' ').slice(0, 16) : ''
}

async function pay(order) {
  try {
    await api.payOrder(order.id)
    uni.showToast({ title: '支付成功', icon: 'success' })
    await load()
  } catch (err) {
    uni.showToast({ title: err && err.message ? err.message : '支付失败', icon: 'none' })
  }
}

async function load() {
  if (!uni.getStorageSync('wechat_saas_token')) {
    uni.navigateTo({ url: '/pages/login/login' })
    return
  }
  try {
    const result = await api.orders()
    orders.value = result.content || []
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
    <view class="eyebrow">MY ORDERS</view>
    <view class="page-title">我的订单</view>
    <view v-if="error" class="error-line">{{ error }}</view>
    <view v-if="loading" class="loading glass">正在加载…</view>
    <view v-else-if="orders.length === 0" class="loading glass">还没有订单，去社区好物看看吧。</view>
    <view v-else class="list">
      <view v-for="order in orders" :key="order.id" class="item glass">
        <view class="item-top"><text class="order-no">{{ order.orderNo }}</text><text class="pill">{{ order.status }}</text></view>
        <view class="item-mid"><text class="amount">{{ money(order.payAmountCent) }}</text><text class="muted">{{ order.memberName }}</text></view>
        <view class="item-bottom"><text>{{ time(order.createdAt) }}</text><view class="order-actions"><text>{{ order.paymentMode }}</text><button v-if="order.status === 'PENDING'" class="pay-button" @click.stop="pay(order)">微信支付</button></view></view>
      </view>
    </view>
  </view>
</template>

<style>
.page-title { font-family: Georgia, "Songti SC", serif; font-size: 50rpx; margin-top: 4rpx; }
.list { margin-top: 28rpx; display: grid; gap: 16rpx; }
.item { padding: 26rpx; display: grid; gap: 16rpx; }
.item-top, .item-mid, .item-bottom { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.order-no { font-size: 21rpx; color: #7d685e; }
.amount { font-family: Georgia, "Songti SC", serif; font-size: 38rpx; }
.item-bottom { color: #7d685e; font-size: 19rpx; }
.loading, .error-line { margin-top: 22rpx; padding: 30rpx; text-align: center; color: #7d685e; font-size: 22rpx; }
.error-line { border-radius: 22rpx; background: rgba(163,59,47,.12); color: #9f3f32; }
.order-actions { display: flex; align-items: center; gap: 14rpx; }
.pay-button { min-height: 56rpx; padding: 0 20rpx; border-radius: 999rpx; background: #c45b3c; color: #fff; font-size: 20rpx; }
</style>

