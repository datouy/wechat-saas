/**
 * 平台租户运营：自助开通、套餐、试用、配额、暂停/恢复、账单与平台审计。
 * 外部支付尚未启用；账单只形成待支付记录，后续接入微信支付或对公转账回调。
 */
const crypto = require('crypto');
const { business } = require('../errors');

const DEFAULT_PLANS = [
  {
    id: 'plan-starter', code: 'starter', name: '社区起步版', monthlyPrice: 9900,
    limits: { admins: 3, members: 500, locations: 1 }, features: ['团购', '会员积分', '优惠券']
  },
  {
    id: 'plan-growth', code: 'growth', name: '邻里增长版', monthlyPrice: 29900,
    limits: { admins: 10, members: 5000, locations: 5 }, features: ['会员分层', '经营报表', '消息模板']
  },
  {
    id: 'plan-enterprise', code: 'enterprise', name: '连锁企业版', monthlyPrice: 89900,
    limits: { admins: 50, members: null, locations: 20 }, features: ['多门店', '审计归档', '灾备演练']
  }
];

class PlatformService {
  constructor(store, auth, config, auditLog) {
    this.store = store;
    this.auth = auth;
    this.config = config || {};
    this.auditLog = auditLog || null;
  }

  async initialize() {
    for (const plan of DEFAULT_PLANS) {
      const existing = await this.store.findById('plans', plan.id);
      if (!existing) await this.store.insert('plans', { ...plan, enabled: true, createdAt: new Date().toISOString() });
    }
    const defaultTenantId = this.config.defaultTenantId || 't-default';
    const tenant = await this.store.findById('tenants', defaultTenantId);
    if (tenant) await this._ensureSubscription(tenant.id, this.config.defaultPlan || 'starter', 'active');
    if (this.config.platformUsername && this.config.platformPassword) {
      await this.ensureOperator(this.config.platformUsername, this.config.platformPassword);
    }
  }

  async ensureOperator(username, password) {
    const existing = (await this.store.find('platformAdmins', item => item.username === username))[0];
    if (existing) return existing;
    this._validatePassword(username, password);
    const operator = {
      id: crypto.randomUUID(), username, passwordHash: this.auth.hashPassword(password),
      status: 'active', tokenVersion: 0, createdAt: new Date().toISOString()
    };
    await this.store.insert('platformAdmins', operator);
    return operator;
  }

  async authenticate(username, password) {
    const operator = (await this.store.find('platformAdmins', item => item.username === String(username || '')))[0];
    if (!operator || operator.status !== 'active') return null;
    if (!this.auth.verifyPassword(password, operator.passwordHash)) return null;
    return this.store.update('platformAdmins', operator.id, { lastLoginAt: new Date().toISOString() });
  }

  async getOperator(id) {
    return this.store.findById('platformAdmins', id);
  }

  async signup(data) {
    if (!this.config.signupEnabled) throw business('当前未开放租户自助开通');
    return this.createTenant({
      name: data.name,
      slug: data.slug,
      ownerUsername: data.username,
      ownerPassword: data.password,
      contactPhone: data.phone,
      planCode: data.planCode || this.config.defaultPlan,
      trial: true,
      source: 'self-service'
    });
  }

  async createTenant(data) {
    const name = String(data.name || '').trim().slice(0, 80);
    const slug = this._slug(data.slug || name);
    const username = String(data.ownerUsername || '').trim();
    const password = String(data.ownerPassword || '');
    if (!name) throw business('门店名称不能为空');
    if (!slug) throw business('租户标识不能为空');
    if (!username) throw business('所有者账号不能为空');
    this._validatePassword(username, password);
    const duplicate = (await this.store.find('tenants', item => item.slug === slug || item.id === slug))[0];
    if (duplicate) throw business('租户标识已存在');

    const now = new Date();
    const trialEndsAt = data.trial === false ? null : new Date(now.getTime() + (Number(this.config.trialDays) || 14) * 86400000).toISOString();
    const tenant = {
      id: slug,
      slug,
      name,
      status: data.trial === false ? 'active' : 'trialing',
      contactPhone: String(data.contactPhone || '').slice(0, 30),
      source: data.source || 'platform',
      trialEndsAt,
      createdAt: now.toISOString()
    };

    return this.store.transaction(async () => {
      await this.store.lock('tenant-create:' + slug);
      if ((await this.store.find('tenants', item => item.slug === slug || item.id === slug)).length) {
        throw business('租户标识已存在');
      }
      await this.store.insert('tenants', tenant);
      const owner = {
        id: crypto.randomUUID(), tenantId: tenant.id, username,
        passwordHash: this.auth.hashPassword(password), role: 'owner', status: 'active',
        tokenVersion: 0, createdAt: now.toISOString()
      };
      await this.store.insert('admins', owner);
      await this.store.insert('storeProfiles', {
        id: tenant.id, tenantId: tenant.id, name, tagline: '社区好物，今天下单，明天到家',
        accountStatus: 'active', planCode: data.planCode || this.config.defaultPlan,
        onboardingState: 'new', createdAt: now.toISOString()
      });
      await this._ensureSubscription(tenant.id, data.planCode || this.config.defaultPlan, tenant.status, trialEndsAt);
      await this._audit(tenant.id, 'tenant.create', tenant.id, { name, slug, source: tenant.source, planCode: data.planCode || this.config.defaultPlan });
      return { tenant, owner: { id: owner.id, username: owner.username, role: owner.role } };
    });
  }

  async listTenants() {
    const tenants = await this.store.find('tenants', () => true);
    const out = [];
    for (const tenant of tenants) out.push(await this._tenantSummary(tenant));
    return out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async getTenant(tenantId) {
    const tenant = await this.store.findById('tenants', tenantId);
    if (!tenant) throw business('租户不存在');
    return this._tenantSummary(tenant);
  }

  async updateTenant(tenantId, patch) {
    const updated = await this.store.transaction(async () => {
      await this.store.lock('tenant-update:' + tenantId);
      const tenant = await this.store.findByIdForUpdate('tenants', tenantId);
      if (!tenant) throw business('租户不存在');
      const clean = {};
      if (patch.name !== undefined) clean.name = String(patch.name).trim().slice(0, 80);
      if (patch.status !== undefined) {
        if (!['active', 'trialing', 'suspended', 'closed'].includes(patch.status)) throw business('不支持的租户状态');
        clean.status = patch.status;
        clean.statusChangedAt = new Date().toISOString();
      }
      const result = await this.store.update('tenants', tenantId, clean);
      await this._audit(tenantId, 'tenant.update', tenantId, clean);
      return result;
    });
    return this._tenantSummary(updated);
  }

  async changePlan(tenantId, planCode) {
    const plan = await this._planByCode(planCode);
    if (!plan || !plan.enabled) throw business('套餐不存在或已停用');
    return this.store.transaction(async () => {
      await this.store.lock('subscription:' + tenantId);
      const subscription = await this._ensureSubscription(tenantId, plan.code, 'active');
      const updated = await this.store.update('subscriptions', subscription.id, {
        planId: plan.id,
        planCode: plan.code,
        status: 'active',
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        changedAt: new Date().toISOString()
      });
      await this.store.insert('subscriptionEvents', {
        id: crypto.randomUUID(), tenantId, planCode: plan.code, action: 'plan.change',
        createdAt: new Date().toISOString()
      });
      await this._audit(tenantId, 'tenant.plan-change', tenantId, { planCode: plan.code });
      return updated;
    });
  }

  async createInvoice(tenantId) {
    const summary = await this.getTenant(tenantId);
    const plan = summary.plan;
    if (!plan) throw business('租户尚未订阅套餐');
    return this.store.transaction(async () => {
      const invoice = {
        id: crypto.randomUUID(), tenantId, planCode: plan.code,
        amount: Number(plan.monthlyPrice) || 0, currency: 'CNY', status: 'issued',
        periodStart: new Date().toISOString(),
        periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        createdAt: new Date().toISOString()
      };
      await this.store.insert('billingInvoices', invoice);
      await this._audit(tenantId, 'billing.invoice-created', invoice.id, { amount: invoice.amount, planCode: plan.code });
      return invoice;
    });
  }

  async markInvoice(invoiceId, status, note) {
    if (!['void', 'paid', 'issued'].includes(status)) throw business('不支持的账单状态');
    return this.store.transaction(async () => {
      const invoice = await this.store.findByIdForUpdate('billingInvoices', invoiceId);
      if (!invoice) throw business('账单不存在');
      const updated = await this.store.update('billingInvoices', invoiceId, {
        status, note: String(note || '').slice(0, 200), updatedBy: 'platform', updatedAt: new Date().toISOString()
      });
      await this._audit(invoice.tenantId, 'billing.invoice-status', invoiceId, { status });
      return updated;
    });
  }

  async quota(tenantId, metric) {
    const summary = await this.getTenant(tenantId);
    const used = Number(summary.usage[metric] || 0);
    const limit = summary.plan && summary.plan.limits ? summary.plan.limits[metric] : null;
    return { metric, used, limit: limit == null ? null : Number(limit), exceeded: limit != null && used >= Number(limit) };
  }

  async assertQuota(tenantId, metric) {
    const result = await this.quota(tenantId, metric);
    if (result.exceeded) throw business('当前套餐的 ' + metric + ' 配额已用尽');
    return result;
  }

  async plans() {
    return (await this.store.find('plans', item => item.enabled !== false))
      .sort((a, b) => Number(a.monthlyPrice) - Number(b.monthlyPrice));
  }

  async invoices(tenantId) {
    return (await this.store.find('billingInvoices', item => !tenantId || item.tenantId === tenantId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async _tenantSummary(tenant) {
    const subscription = (await this.store.find('subscriptions', item => item.tenantId === tenant.id))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0] || null;
    const allPlans = await this.store.find('plans', () => true);
    const plan = subscription ? allPlans.find(item => item.code === subscription.planCode || item.id === subscription.planId) || null : null;
    const usage = {
      admins: await this.store.count('admins', item => item.tenantId === tenant.id),
      members: await this.store.count('members', item => item.tenantId === tenant.id),
      locations: await this.store.count('storeLocations', item => item.tenantId === tenant.id),
      orders: await this.store.count('orders', item => item.tenantId === tenant.id)
    };
    return { ...tenant, subscription, plan, usage };
  }

  async _ensureSubscription(tenantId, planCode, status, trialEndsAt) {
    const plan = await this._planByCode(planCode);
    if (!plan) throw business('默认套餐不存在');
    const existing = (await this.store.find('subscriptions', item => item.tenantId === tenantId))[0];
    if (existing) {
      if (existing.planCode === plan.code && existing.status === status) return existing;
      return this.store.update('subscriptions', existing.id, {
        planId: plan.id, planCode: plan.code, status,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        trialEndsAt: trialEndsAt || existing.trialEndsAt || null
      });
    }
    return this.store.insert('subscriptions', {
      id: crypto.randomUUID(), tenantId, planId: plan.id, planCode: plan.code, status,
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      trialEndsAt: trialEndsAt || null,
      createdAt: new Date().toISOString()
    });
  }

  async _planByCode(code) {
    return (await this.store.find('plans', item => item.code === code || item.id === code))[0] || null;
  }

  async _audit(tenantId, action, resourceId, detail) {
    if (!this.auditLog) return;
    await this.auditLog.record({
      tenantId, actorType: 'platform', actorId: 'platform', actorName: '平台运营',
      action, resource: 'tenant', resourceId, detail
    });
  }

  _slug(value) {
    return String(value || '').trim().toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 48) || ('t-' + crypto.randomBytes(5).toString('hex'));
  }

  _validatePassword(username, password) {
    const value = String(password || '');
    const problems = [];
    if (value.length < 10) problems.push('至少 10 位');
    if (!/[a-z]/.test(value)) problems.push('包含小写字母');
    if (!/[A-Z]/.test(value)) problems.push('包含大写字母');
    if (!/\d/.test(value)) problems.push('包含数字');
    if (username && value.toLowerCase().includes(String(username).toLowerCase())) problems.push('不能包含用户名');
    if (problems.length) throw business('密码需' + problems.join('、'));
  }
}

PlatformService.DEFAULT_PLANS = DEFAULT_PLANS;
module.exports = PlatformService;
