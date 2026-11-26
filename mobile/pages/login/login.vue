<script setup>
import { ref } from 'vue'
import { api } from '../../api/client'

const loading = ref(false)
const error = ref('')
const manualCode = ref('mock-member-a')

function wechatLoginCode() {
  return new Promise(resolve => {
    uni.login({
      provider: 'weixin',
      success(result) { resolve(result.code || '') },
      fail() { resolve('') }
    })
  })
}

async function submit() {
  loading.value = true
  error.value = ''
  try {
    let code = await wechatLoginCode()
    if (!code) code = manualCode.value.trim()
    if (!code) throw new Error('未获取到微信登录 code')
    const result = await api.wxLogin(code)
    uni.setStorageSync('wechat_saas_token', result.token)
    uni.setStorageSync('wechat_saas_user', result.member)
    uni.setStorageSync('wechat_saas_tenant', result.tenant)
    uni.showToast({ title: result.mock ? '模拟微信登录成功' : '微信登录成功', icon: 'success' })
    setTimeout(() => uni.switchTab({ url: '/pages/index/index' }), 300)
  } catch (err) {
    error.value = err && err.message ? err.message : '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <view class="login-page">
    <view class="login-brand">邻</view>
    <text class="eyebrow">NEIGHBORHOOD COMMERCE</text>
    <view class="login-title">把社区好物<br />带回生活。</view>
    <view class="login-copy">微信授权后查看附近团购、订单、优惠券与会员权益。</view>
    <view class="form glass">
      <view class="field">
        <text>H5 联调 code</text>
        <input v-model="manualCode" placeholder="H5 环境填写 mock code" />
      </view>
      <view class="hint">微信小程序会自动调用 uni.login；H5 使用上面的联调 code。</view>
      <view v-if="error" class="error-line">{{ error }}</view>
      <button class="primary-button" :disabled="loading" @click="submit">{{ loading ? '正在登录…' : '微信一键登录' }}</button>
    </view>
  </view>
</template>

<style>
.login-page { min-height: 100vh; padding: 80rpx 40rpx; }
.login-brand { width: 86rpx; height: 86rpx; display: grid; place-items: center; border-radius: 30rpx 30rpx 30rpx 8rpx; background: #c45b3c; color: #fff; font-family: Georgia, serif; font-size: 42rpx; box-shadow: 0 18rpx 40rpx rgba(196,91,60,.24); }
.login-title { margin-top: 18rpx; font-family: Georgia, "Songti SC", serif; font-size: 64rpx; line-height: 1.16; letter-spacing: -2rpx; }
.login-copy { margin-top: 14rpx; color: #7d685e; font-size: 24rpx; }
.form { margin-top: 44rpx; padding: 30rpx; }
.field { display: grid; gap: 10rpx; margin-bottom: 22rpx; color: #7d685e; font-size: 21rpx; }
.field input { min-height: 84rpx; padding: 0 22rpx; border-radius: 24rpx; background: rgba(255,255,255,.52); border: 1rpx solid rgba(255,255,255,.7); color: #2b1f1a; font-size: 26rpx; }
.hint { padding: 16rpx; border-radius: 20rpx; background: rgba(255,255,255,.3); color: #7d685e; font-size: 20rpx; line-height: 1.6; }
.primary-button { margin-top: 22rpx; min-height: 88rpx; border-radius: 999rpx; background: #c45b3c; color: #fff; font-size: 26rpx; }
.error-line { margin: 16rpx 0; padding: 16rpx; border-radius: 20rpx; background: rgba(163,59,47,.12); color: #9f3f32; font-size: 21rpx; }
</style>

