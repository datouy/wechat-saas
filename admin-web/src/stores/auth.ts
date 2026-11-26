import { defineStore } from 'pinia'
import { api } from '../api/client'
import type { TenantInfo, UserInfo } from '../types'

interface AuthState {
  token: string
  user: UserInfo | null
  tenant: TenantInfo | null
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: '',
    user: null,
    tenant: null
  }),
  actions: {
    hydrate() {
      this.token = localStorage.getItem('wechat_saas_token') || ''
      const user = localStorage.getItem('wechat_saas_user')
      const tenant = localStorage.getItem('wechat_saas_tenant')
      if (user) this.user = JSON.parse(user) as UserInfo
      if (tenant) this.tenant = JSON.parse(tenant) as TenantInfo
    },
    async login(tenantCode: string, username: string, password: string) {
      const result = await api.login(tenantCode, username, password)
      this.token = result.token
      this.user = result.user
      this.tenant = result.tenant
      localStorage.setItem('wechat_saas_token', result.token)
      localStorage.setItem('wechat_saas_user', JSON.stringify(result.user))
      localStorage.setItem('wechat_saas_tenant', JSON.stringify(result.tenant))
    },
    logout() {
      this.token = ''
      this.user = null
      this.tenant = null
      localStorage.removeItem('wechat_saas_token')
      localStorage.removeItem('wechat_saas_user')
      localStorage.removeItem('wechat_saas_tenant')
    }
  }
})

