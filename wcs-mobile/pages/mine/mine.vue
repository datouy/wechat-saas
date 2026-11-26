<script setup>
import { onMounted, ref } from 'vue'

const user = ref(null)
const tenant = ref(null)

onMounted(() => {
  try {
    user.value = uni.getStorageSync('wechat_saas_user') || null
    tenant.value = uni.getStorageSync('wechat_saas_tenant') || null
  } catch (err) {
    user.value = null
  }
})

function logout() {
  uni.removeStorageSync('wechat_saas_token')
  uni.removeStorageSync('wechat_saas_user')
  uni.removeStorageSync('wechat_saas_tenant')
  uni.navigateTo({ url: '/pages/login/login' })
}
</script>

<template>
  <view class="page-pad">
    <view class="eyebrow">MY NEIGHBORHOOD</view>
    <view class="page-title">我的</view>
    <view class="profile glass">
      <view class="avatar">{{ user && user.displayName ? user.displayName.slice(0, 1) : '邻' }}</view>
      <view class="profile-main">
        <view class="profile-name">{{ user && user.displayName ? user.displayName : '邻里会员' }}</view>
        <view class="profile-role">{{ user && user.role ? user.role : '社区会员' }} · {{ tenant && tenant.name ? tenant.name : '邻里团' }}</view>
      </view>
    </view>
    <view class="menu glass">
      <view class="menu-row" @click="uni.switchTab({ url: '/pages/orders/orders' })"><text>我的订单</text><text>→</text></view>
      <view class="menu-row" @click="uni.switchTab({ url: '/pages/products/products' })"><text>社区好物</text><text>→</text></view>
      <view class="menu-row" @click="logout"><text class="danger">退出登录</text><text>↗</text></view>
    </view>
    <view class="soft-note">当前为 Java + MySQL 后端联调版本；微信登录与真实支付将在后续接入。</view>
  </view>
</template>

<style>
.page-title { font-family: Georgia, "Songti SC", serif; font-size: 50rpx; margin-top: 4rpx; }
.profile { margin-top: 30rpx; padding: 30rpx; display: flex; align-items: center; gap: 22rpx; }
.avatar { width: 96rpx; height: 96rpx; display: grid; place-items: center; border-radius: 50%; background: rgba(196,91,60,.18); color: #a7462e; font-family: Georgia, serif; font-size: 42rpx; }
.profile-name { font-size: 34rpx; font-weight: 700; }
.profile-role { margin-top: 6rpx; color: #7d685e; font-size: 22rpx; }
.menu { margin-top: 20rpx; padding: 8rpx 26rpx; }
.menu-row { min-height: 92rpx; display: flex; align-items: center; justify-content: space-between; border-top: 1rpx solid rgba(255,255,255,.42); font-size: 25rpx; }
.menu-row:first-child { border-top: 0; }
.danger { color: #9f3f32; }
.soft-note { margin-top: 24rpx; padding: 20rpx; border-radius: 24rpx; background: rgba(255,255,255,.34); color: #7d685e; font-size: 20rpx; line-height: 1.7; }
</style>

