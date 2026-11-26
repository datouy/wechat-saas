import axios from 'axios'
import type {
  ApiEnvelope, AppointmentRow, AppointmentServiceRow, AuditRow, CouponRow, CouponTemplateRow,
  DashboardData, FormRow, FormStatsRow, GroupBuyRow, InventoryAdjustmentRow, LoginResult,
  MemberRow, OrderDetailRow, OrderPageRow, PageResult, PointsView, ProductRow,
  ProductUpsertPayload, SubscriptionAdminData, TenantInfo
} from '../types'

const client = axios.create({
  baseURL: '/api',
  timeout: 15000
})

client.interceptors.request.use(config => {
  const token = localStorage.getItem('wechat_saas_token')
  if (token) config.headers.Authorization = 'Bearer ' + token
  return config
})

client.interceptors.response.use(
  response => response,
  error => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('wechat_saas_token')
    }
    return Promise.reject(error)
  }
)

async function unwrap<T>(promise: Promise<{ data: ApiEnvelope<T> }>): Promise<T> {
  const response = await promise
  if (!response.data.success) throw new Error(response.data.message || '请求失败')
  return response.data.data
}

export const api = {
  login(tenantCode: string, username: string, password: string) {
    return unwrap<LoginResult>(client.post('/auth/login', { tenantCode, username, password }))
  },
  me() {
    return unwrap<LoginResult['user']>(client.get('/auth/me'))
  },
  dashboard() {
    return unwrap<DashboardData>(client.get('/dashboard'))
  },
  products(params: { keyword?: string; page?: number; size?: number }) {
    return unwrap<PageResult<ProductRow>>(client.get('/products', { params }))
  },
  createProduct(payload: ProductUpsertPayload) {
    return unwrap<ProductRow>(client.post('/products', payload))
  },
  updateProduct(id: number, payload: Partial<ProductUpsertPayload>) {
    return unwrap<ProductRow>(client.put('/products/' + id, payload))
  },
  offShelfProduct(id: number) {
    return unwrap<ProductRow>(client.delete('/products/' + id))
  },
  adjustments(id: number) {
    return unwrap<InventoryAdjustmentRow[]>(client.get('/products/' + id + '/inventory-adjustments'))
  },
  adjustStock(id: number, payload: { delta: number; reason: string }) {
    return unwrap<InventoryAdjustmentRow>(client.post('/products/' + id + '/inventory-adjustments', payload))
  },
  undoAdjustment(id: number) {
    return unwrap<InventoryAdjustmentRow>(client.post('/inventory-adjustments/' + id + '/undo'))
  },
  orders(params: { status?: string; page?: number; size?: number }) {
    return unwrap<PageResult<OrderPageRow>>(client.get('/orders', { params }))
  },
  orderDetail(id: number) {
    return unwrap<OrderDetailRow>(client.get('/orders/' + id))
  },
  payOrder(id: number) {
    return unwrap<OrderPageRow>(client.post('/orders/' + id + '/pay'))
  },
  deliverOrder(id: number, payload: { company: string; trackingNo: string }) {
    return unwrap<OrderPageRow>(client.post('/orders/' + id + '/deliver', payload))
  },
  completeOrder(id: number) {
    return unwrap<OrderPageRow>(client.post('/orders/' + id + '/complete'))
  },
  cancelOrder(id: number, reason: string) {
    return unwrap<OrderPageRow>(client.post('/orders/' + id + '/cancel', { reason }))
  },
  refundOrder(id: number, amountCent: number | null, reason: string) {
    const key = 'web-' + id + '-' + Date.now() + '-' + Math.random().toString(16).slice(2)
    return unwrap(client.post('/orders/' + id + '/refund', { amountCent, reason }, {
      headers: { 'Idempotency-Key': key }
    }))
  },
  members(params: { keyword?: string; page?: number; size?: number }) {
    return unwrap<PageResult<MemberRow>>(client.get('/members', { params }))
  },
  memberPoints(id: number) {
    return unwrap<PointsView>(client.get('/members/' + id + '/points'))
  },
  adjustPoints(id: number, amount: number, reason: string) {
    return unwrap<PointsView>(client.post('/members/' + id + '/points', { amount, reason }))
  },
  auditLogs(params: { action?: string; page?: number; size?: number }) {
    return unwrap<PageResult<AuditRow>>(client.get('/audit-logs', { params }))
  },
  couponTemplates() {
    return unwrap<CouponTemplateRow[]>(client.get('/coupons/templates'))
  },
  createCouponTemplate(payload: Record<string, unknown>) {
    return unwrap<CouponTemplateRow>(client.post('/coupons/templates', payload))
  },
  updateCouponTemplate(id: number, payload: Record<string, unknown>) {
    return unwrap<CouponTemplateRow>(client.put('/coupons/templates/' + id, payload))
  },
  issuedCoupons() {
    return unwrap<CouponRow[]>(client.get('/coupons'))
  },
  groupBuys() {
    return unwrap<GroupBuyRow[]>(client.get('/group-buys'))
  },
  createGroupBuy(payload: Record<string, unknown>) {
    return unwrap<GroupBuyRow>(client.post('/group-buys', payload))
  },
  cancelGroupBuy(id: number) {
    return unwrap<GroupBuyRow>(client.post('/group-buys/' + id + '/cancel'))
  },
  forms() {
    return unwrap<FormRow[]>(client.get('/forms'))
  },
  createForm(payload: Record<string, unknown>) {
    return unwrap<FormRow>(client.post('/forms', payload))
  },
  formStats(id: number) {
    return unwrap<FormStatsRow>(client.get('/forms/' + id + '/stats'))
  },
  appointmentServices() {
    return unwrap<AppointmentServiceRow[]>(client.get('/appointment-services'))
  },
  createAppointmentService(payload: Record<string, unknown>) {
    return unwrap<AppointmentServiceRow>(client.post('/appointment-services', payload))
  },
  appointments() {
    return unwrap<AppointmentRow[]>(client.get('/appointments'))
  },
  completeAppointment(id: number) {
    return unwrap<AppointmentRow>(client.post('/appointments/' + id + '/complete'))
  },
  cancelAppointment(id: number) {
    return unwrap<AppointmentRow>(client.post('/appointments/' + id + '/cancel'))
  },
  subscriptionAdmin() {
    return unwrap<SubscriptionAdminData>(client.get('/admin/subscriptions'))
  },
  testSubscription(payload: Record<string, unknown>) {
    return unwrap<Record<string, unknown>>(client.post('/admin/subscriptions/test', payload))
  },
  tenant() {
    return unwrap<TenantInfo>(client.get('/tenant'))
  }
}

