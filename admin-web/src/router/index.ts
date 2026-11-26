import { createRouter, createWebHistory } from 'vue-router'
import AdminLayout from '../layouts/AdminLayout.vue'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
    {
      path: '/',
      component: AdminLayout,
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue'), meta: { title: '今天' } },
        { path: 'products', name: 'products', component: () => import('../views/ProductsView.vue'), meta: { title: '商品' } },
        { path: 'orders', name: 'orders', component: () => import('../views/OrdersView.vue'), meta: { title: '订单' } },
        { path: 'members', name: 'members', component: () => import('../views/MembersView.vue'), meta: { title: '客户' } },
        { path: 'settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { title: '设置' } },
        { path: 'audit', name: 'audit', component: () => import('../views/AuditView.vue'), meta: { title: '审计' } },
        { path: 'coupons', name: 'coupons', component: () => import('../views/CouponsView.vue'), meta: { title: '优惠券' } },
        { path: 'group-buys', name: 'group-buys', component: () => import('../views/GroupBuysView.vue'), meta: { title: '团购' } },
        { path: 'forms', name: 'forms', component: () => import('../views/FormsView.vue'), meta: { title: '问卷' } },
        { path: 'appointments', name: 'appointments', component: () => import('../views/AppointmentsView.vue'), meta: { title: '预约' } },
        { path: 'wechat', name: 'wechat', component: () => import('../views/WechatView.vue'), meta: { title: '微信能力' } }
      ]
    }
  ]
})

router.beforeEach(to => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.token) return { name: 'login' }
  if (to.name === 'login' && auth.token) return { name: 'dashboard' }
  return true
})

export default router

