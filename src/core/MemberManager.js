/**
 * 会员管理
 * - 微信小程序登录对接（openid绑定）
 * - 会员资料、收货地址
 * - 消费统计（累计消费/订单数）
 */
const { randomUUID: uuidv4 } = require('crypto');
const { business } = require('../errors');

class MemberManager {
  constructor(store, wechatService, quotaService) {
    this.store = store;
    this.wechat = wechatService;
    this.quota = quotaService || null;
  }

  /** 微信登录：code -> openid -> 会员（不存在则自动注册） */
  async loginByWechatCode(code, tenantId) {
    const session = await this.wechat.code2Session(code);
    const openid = session.openid;
    if (!openid) throw business('微信登录失败：未获得openid');

    return this.store.transaction(async () => {
      await this.store.lock('member-login:' + tenantId + ':' + openid);
      const found = (await this.store.find('members', m => m.openid === openid && m.tenantId === tenantId))[0];
      if (found) {
        return this.store.update('members', found.id, { lastLoginAt: new Date().toISOString() });
      }
      if (this.quota) await this.quota.assertQuota(tenantId, 'members');
      const member = {
        id: uuidv4(),
        tenantId,
        openid,
        unionid: session.unionid || '',
        nickname: '微信用户' + openid.slice(-4),
        avatar: '',
        phone: '',
        addresses: [],
        totalSpent: 0,
        orderCount: 0,
        lastLoginAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      await this.store.insert('members', member);
      return member;
    });
  }

  /** 获取会员 */
  async get(memberId) {
    return this.store.findById('members', memberId);
  }

  /** 更新资料 */
  async updateProfile(memberId, patch) {
    const allow = ['nickname', 'avatar', 'phone'];
    const clean = {};
    for (const k of allow) if (patch[k] !== undefined) clean[k] = patch[k];
    return this.store.update('members', memberId, clean);
  }

  /** 新增收货地址 */
  async addAddress(memberId, address) {
    return this.store.transaction(async () => {
    const member = await this.get(memberId);
    if (!member) throw business('会员不存在');
    if ((member.addresses || []).length >= 10) throw business('最多保存 10 个收货地址');
    const addr = {
      id: uuidv4(),
      name: String(address.name || '').slice(0, 20),
      phone: String(address.phone || '').slice(0, 20),
      detail: String(address.detail || '').slice(0, 200),
      isDefault: !!address.isDefault
    };
    const addresses = member.addresses.map(a => (addr.isDefault ? { ...a, isDefault: false } : a));
    if (addresses.length === 0) addr.isDefault = true;
    addresses.push(addr);
    await this.store.update('members', memberId, { addresses });
    return addr;
    });
  }

  /** 更新地址；设为默认时取消其他地址的默认状态。 */
  async updateAddress(memberId, addressId, patch) {
    return this.store.transaction(async () => {
    const member = await this.get(memberId);
    if (!member) throw business('会员不存在');
    const current = (member.addresses || []).find(item => item.id === addressId);
    if (!current) throw business('地址不存在');
    const updated = {
      ...current,
      name: patch.name !== undefined ? String(patch.name).trim().slice(0, 20) : current.name,
      phone: patch.phone !== undefined ? String(patch.phone).trim().slice(0, 20) : current.phone,
      detail: patch.detail !== undefined ? String(patch.detail).trim().slice(0, 200) : current.detail,
      isDefault: patch.isDefault !== undefined ? !!patch.isDefault : current.isDefault
    };
    if (!updated.name || !updated.phone || !updated.detail) throw business('地址信息不完整');
    let addresses = member.addresses.map(item => item.id === addressId ? updated : item);
    if (updated.isDefault) addresses = addresses.map(item => ({ ...item, isDefault: item.id === addressId }));
    if (!addresses.some(item => item.isDefault) && addresses.length) {
      addresses[0] = { ...addresses[0], isDefault: true };
    }
    await this.store.update('members', memberId, { addresses });
    return addresses.find(item => item.id === addressId);
    });
  }

  /** 删除地址 */
  async removeAddress(memberId, addressId) {
    return this.store.transaction(async () => {
    const member = await this.get(memberId);
    if (!member) return false;
    const before = member.addresses.length;
    let addresses = member.addresses.filter(a => a.id !== addressId);
    if (addresses.length && !addresses.some(item => item.isDefault)) {
      addresses = addresses.map((item, index) => ({ ...item, isDefault: index === 0 }));
    }
    await this.store.update('members', memberId, { addresses });
    return addresses.length < before;
    });
  }

  /** 会员消费统计更新（下单支付成功后调用） */
  async recordSpending(memberId, amount) {
    const member = await this.get(memberId);
    if (!member) return;
    return this.store.update('members', memberId, {
      totalSpent: Math.round((member.totalSpent + amount) * 100) / 100,
      orderCount: member.orderCount + 1
    });
  }

  /** 商户下会员列表 */
  async listByTenant(tenantId, keyword) {
    let list = await this.store.find('members', m => m.tenantId === tenantId);
    if (keyword) {
      const k = keyword.toLowerCase();
      list = list.filter(m => (m.nickname || '').toLowerCase().includes(k) || (m.phone || '').includes(k));
    }
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /** 会员总数 */
  async count(tenantId) {
    return this.store.count('members', m => m.tenantId === tenantId);
  }
}

module.exports = MemberManager;
