const BASE_URL = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8080/api'

function token() {
  return uni.getStorageSync('wechat_saas_token') || ''
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const header = Object.assign({}, options.header || {})
    const current = token()
    if (current) header.Authorization = 'Bearer ' + current
    if (options.method && options.method !== 'GET') header['Content-Type'] = 'application/json'
    uni.request({
      url: BASE_URL + path,
      method: options.method || 'GET',
      data: options.data,
      header,
      timeout: 15000,
      success(response) {
        const body = response.data
        if (response.statusCode >= 200 && response.statusCode < 300 && body && body.success) {
          resolve(body.data)
          return
        }
        if (response.statusCode === 401) uni.removeStorageSync('wechat_saas_token')
        reject(new Error(body && body.message ? body.message : '请求失败'))
      },
      fail(error) {
        reject(new Error(error.errMsg || '网络请求失败'))
      }
    })
  })
}

export const api = {
  wxLogin(code) {
    return request('/wx/login', {
      method: 'POST',
      header: { 'X-Tenant-Id': 't-default' },
      data: { code }
    })
  },
  coupons() {
    return request('/wx/coupons')
  },
  couponTemplates() {
    return request('/wx/coupons/templates')
  },
  claimCoupon(id) {
    return request('/wx/coupons/claim/' + id, { method: 'POST', data: {} })
  },
  groupBuys() {
    return request('/wx/group-buys')
  },
  joinGroupBuy(id) {
    return request('/wx/group-buys/' + id + '/join', { method: 'POST', data: {} })
  },
  subscriptions() {
    return request('/wx/subscriptions')
  },
  authorizeSubscription(decisions) {
    return request('/wx/subscriptions/authorize', { method: 'POST', data: { decisions } })
  },
  appointmentServices() {
    return request('/wx/appointment-services')
  },
  payOrder(id) {
    return request('/wx/orders/' + id + '/pay', { method: 'POST', data: {} })
  },
  login(tenantCode, username, password) {
    return request('/auth/login', {
      method: 'POST',
      data: { tenantCode, username, password }
    })
  },
  dashboard() {
    return request('/dashboard')
  },
  products() {
    return request('/products?page=1&size=100')
  },
  orders() {
    return request('/orders?page=1&size=100')
  },
  members() {
    return request('/members?page=1&size=100')
  }
}

