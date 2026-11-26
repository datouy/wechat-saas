<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../../api/client'

const dashboard = ref(null)
const products = ref([])
const groupBuys = ref([])
const loading = ref(true)
const error = ref('')

function money(cents) {
  return '¥' + (Number(cents || 0) / 100).toFixed(2)
}

function goLogin() {
  uni.navigateTo({ url: '/pages/login/login' })
}

function goProducts() {
  uni.switchTab({ url: '/pages/products/products' })
}

async function joinGroup(group) {
  try {
    await api.joinGroupBuy(group.id)
    uni.showToast({ title: '参团成功', icon: 'success' })
    groupBuys.value = (await api.groupBuys() || []).slice(0, 4)
  } catch (err) {
    uni.showToast({ title: err && err.message ? err.message : '参团失败', icon: 'none' })
  }
}

async function authorizeSubscriptions() {
  try {
    const data = await api.subscriptions()
    const ids = (data.events || []).filter(item => item.configured).map(item => item.templateId).slice(0, 3)
    if (!ids.length) {
      uni.showToast({ title: '暂未配置订阅模板', icon: 'none' })
      return
    }
    const save = async decisions => {
      await api.authorizeSubscription(decisions)
      uni.showToast({ title: '订阅授权已记录', icon: 'success' })
    }
    if (uni.requestSubscribeMessage && uni.getSystemInfoSync().platform !== 'windows') {
      uni.requestSubscribeMessage({
        tmplIds: ids,
        success(result) {
          const decisions = {}
          ids.forEach(id => { decisions[id] = result[id] === 'accept' ? 'accept' : (result[id] === 'reject' ? 'reject' : 'filter') })
          save(decisions)
        },
        fail() {
          const decisions = {}
          ids.forEach(id => { decisions[id] = 'filter' })
          save(decisions)
        }
      })
    } else {
      const decisions = {}
      ids.forEach(id => { decisions[id] = 'accept' })
      await save(decisions)
    }
  } catch (err) {
    uni.showToast({ title: err && err.message ? err.message : '订阅授权失败', icon: 'none' })
  }
}

async function load() {
  if (!uni.getStorageSync('wechat_saas_token')) {
    goLogin()
    return
  }
  try {
    const result = await api.dashboard()
    const list = await api.products()
    const groups = await api.groupBuys()
    dashboard.value = result
    products.value = (list.content || []).slice(0, 4)
    groupBuys.value = (groups || []).slice(0, 4)
  } catch (err) {
    error.value = err && err.message ? err.message : '加载失败'
    if (err && err.message && err.message.indexOf('登录') >= 0) goLogin()
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <view class="page-pad">
    <view class="topline">
      <view>
        <text class="eyebrow">NEIGHBORHOOD MARKET</text>
        <view class="title">邻里团</view>
      </view>
      <view class="member-dot" @click="uni.switchTab({ url: '/pages/mine/mine' })">邻</view>
    </view>

    <view class="hero glass">
      <text class="hero-tag">今天，社区好物正在靠近</text>
      <view class="hero-title">把新鲜和信任<br />一起送到家。</view>
      <view class="hero-actions">
        <button class="primary-button" @click="goProducts">逛社区好物</button>
        <button class="quiet-button" @click="uni.switchTab({ url: '/pages/orders/orders' })">我的订单</button>
        <button class="quiet-button" @click="authorizeSubscriptions">订阅提醒</button>
      </view>
      <view class="hero-orb">邻</view>
    </view>

    <view v-if="error" class="error-line">{{ error }}</view>
    <view v-if="loading" class="loading glass">正在把社区好物装进玻璃盒…</view>
    <template v-else>
      <view class="metric-row">
        <view class="metric glass">
          <text class="muted">今日成交</text>
          <text class="metric-value">{{ money(dashboard && dashboard.todayAmountCent) }}</text>
          <text class="metric-hint">{{ dashboard ? dashboard.todayOrders : 0 }} 笔订单</text>
        </view>
        <view class="metric glass">
          <text class="muted">社区会员</text>
          <text class="metric-value">{{ dashboard ? dashboard.memberCount : 0 }}</text>
          <text class="metric-hint">已经加入</text>
        </view>
      </view>

      <view class="section-head">
        <view><text class="eyebrow">GROUP BUY</text><view class="section-title">邻里团购</view></view>
      </view>
      <view v-if="groupBuys.length" class="group-list">
        <view v-for="group in groupBuys" :key="group.id" class="group-card glass">
          <view class="group-top"><text class="pill">{{ group.status }}</text><text class="muted">{{ group.participantCount }}/{{ group.maxParticipants }} 人</text></view>
          <view class="group-name">{{ group.title }}</view>
          <view class="group-desc">{{ group.productName }} · 还差 {{ group.remaining }} 人成团</view>
          <view class="group-foot"><text class="price">{{ money(group.groupPriceCent) }}</text><button class="join-button" @click="joinGroup(group)">参团</button></view>
        </view>
      </view>

      <view class="section-head">
        <view><text class="eyebrow">CURATED FOR TODAY</text><view class="section-title">今日精选</view></view>
        <text class="more-link" @click="goProducts">全部好物 →</text>
      </view>
      <view class="product-grid">
        <view v-for="product in products" :key="product.id" class="product-card glass">
          <view class="product-mark">{{ product.name.slice(0, 1) }}</view>
          <view class="product-name">{{ product.name }}</view>
          <view class="product-desc">{{ product.description || '社区精选' }}</view>
          <view class="product-foot"><text class="price">{{ money(product.priceCent) }}</text><text class="stock">库存 {{ product.stock }}</text></view>
        </view>
      </view>
    </template>
  </view>
</template>

<style>
.topline { padding-top: 18rpx; display: flex; align-items: flex-start; justify-content: space-between; }
.title { margin-top: 4rpx; font-family: Georgia, "Songti SC", serif; font-size: 52rpx; letter-spacing: 2rpx; }
.member-dot { width: 76rpx; height: 76rpx; display: grid; place-items: center; border-radius: 50%; background: rgba(255,255,255,.5); border: 1rpx solid rgba(255,255,255,.7); color: #a7462e; font-family: Georgia, serif; font-size: 30rpx; }
.hero { position: relative; margin-top: 34rpx; padding: 46rpx 38rpx; overflow: hidden; }
.hero-tag { color: #a7462e; font-size: 22rpx; }
.hero-title { position: relative; z-index: 1; margin-top: 18rpx; font-family: Georgia, "Songti SC", serif; font-size: 56rpx; line-height: 1.16; letter-spacing: -2rpx; }
.hero-actions { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 14rpx; margin-top: 34rpx; }
.primary-button, .quiet-button { min-height: 76rpx; padding: 0 26rpx; border-radius: 999rpx; font-size: 23rpx; }
.primary-button { background: #c45b3c; color: #fff; }
.quiet-button { background: rgba(255,255,255,.4); border: 1rpx solid rgba(255,255,255,.65); color: #2b1f1a; }
.hero-orb { position: absolute; right: -34rpx; bottom: -60rpx; color: rgba(196,91,60,.08); font-family: Georgia, "Songti SC", serif; font-size: 260rpx; }
.metric-row { margin-top: 20rpx; display: grid; grid-template-columns: 1fr 1fr; gap: 16rpx; }
.metric { padding: 26rpx; display: grid; gap: 6rpx; }
.metric-value { font-family: Georgia, "Songti SC", serif; font-size: 46rpx; }
.metric-hint { color: #7d685e; font-size: 20rpx; }
.section-head { margin-top: 44rpx; display: flex; align-items: flex-end; justify-content: space-between; }
.section-title { margin-top: 6rpx; font-family: Georgia, "Songti SC", serif; font-size: 38rpx; }
.more-link { color: #a7462e; font-size: 22rpx; }
.product-grid { margin-top: 20rpx; display: grid; grid-template-columns: 1fr 1fr; gap: 16rpx; }
.product-card { padding: 24rpx; }
.product-mark { width: 70rpx; height: 70rpx; display: grid; place-items: center; border-radius: 22rpx; background: rgba(196,91,60,.16); color: #a7462e; font-family: Georgia, serif; font-size: 30rpx; }
.product-name { margin-top: 18rpx; font-size: 26rpx; font-weight: 700; }
.product-desc { min-height: 58rpx; margin-top: 6rpx; color: #7d685e; font-size: 20rpx; line-height: 1.5; }
.product-foot { margin-top: 18rpx; display: flex; align-items: baseline; justify-content: space-between; }
.price { font-size: 30rpx; font-weight: 700; }
.stock { color: #7d685e; font-size: 18rpx; }
.group-list { margin-top: 20rpx; display: grid; gap: 16rpx; }
.group-card { padding: 24rpx; }
.group-top, .group-foot { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.group-name { margin-top: 14rpx; font-size: 30rpx; font-weight: 700; }
.group-desc { margin-top: 6rpx; color: #7d685e; font-size: 21rpx; }
.group-foot { margin-top: 16rpx; }
.join-button { min-height: 60rpx; padding: 0 24rpx; border-radius: 999rpx; background: #c45b3c; color: #fff; font-size: 22rpx; }
.loading { margin-top: 22rpx; padding: 40rpx; text-align: center; color: #7d685e; font-size: 22rpx; }
.error-line { margin-top: 18rpx; padding: 18rpx 22rpx; border-radius: 22rpx; background: rgba(163,59,47,.12); color: #9f3f32; font-size: 22rpx; }
</style>

