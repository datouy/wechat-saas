/**
 * 会员管理
 * - 微信小程序登录对接（openid绑定）
 * - 会员资料、收货地址
 * - 消费统计（累计消费/订单数）
 */
const { randomUUID: uuidv4 } = require('crypto');

class MemberManager {
  constructor(store, wechatService) {
    this.store = store;
    this.wechat = wechatService;
  }

  /** 微信登录：code -> openid -> 会员（不存在则自动注册） */
  async loginByWechatCode(code, tenantId) {
    const session = await this.wechat.code2Session(code);
    const openid = session.openid;
    if (!openid) throw business('微信登录失败：未获得openid');

    let member = this.store.find('members', m => m.openid === openid && m.tenantId === tenantId)[0];
    if (!member) {
      member = {
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
      this.store.insert('members', member);
    } else {
      member.lastLoginAt = new Date().toISOString();
      this.store.markDirty('members');
    }
    return member;
  }

  /** 获取会员 */
  get(memberId) {
    return this.store.findById('members', memberId);
  }

  /** 更新资料 */
  updateProfile(memberId, patch) {
    const allow = ['nickname', 'avatar', 'phone'];
    const clean = {};
    for (const k of allow) if (patch[k] !== undefined) clean[k] = patch[k];
    return this.store.update('members', memberId, clean);
  }

  /** 新增收货地址 */
  addAddress(memberId, address) {
    const member = this.get(memberId);
    if (!member) throw business('会员不存在');
    const addr = {
      id: uuidv4(),
      name: String(address.name || '').slice(0, 20),
      phone: String(address.phone || '').slice(0, 20),
      detail: String(address.detail || '').slice(0, 200),
      isDefault: !!address.isDefault
    };
    if (addr.isDefault) member.addresses.forEach(a => (a.isDefault = false));
    if (member.addresses.length === 0) addr.isDefault = true;
    member.addresses.push(addr);
    this.store.markDirty('members');
    return addr;
  }

  /** 删除地址 */
  removeAddress(memberId, addressId) {
    const member = this.get(memberId);
    if (!member) return false;
    const before = member.addresses.length;
    member.addresses = member.addresses.filter(a => a.id !== addressId);
    this.store.markDirty('members');
    return member.addresses.length < before;
  }

  /** 会员消费统计更新（下单支付成功后调用） */
  recordSpending(memberId, amount) {
    const member = this.get(memberId);
    if (!member) return;
    member.totalSpent = Math.round((member.totalSpent + amount) * 100) / 100;
    member.orderCount += 1;
    this.store.markDirty('members');
  }

  /** 商户下会员列表 */
  listByTenant(tenantId, keyword) {
    let list = this.store.find('members', m => m.tenantId === tenantId);
    if (keyword) {
      const k = keyword.toLowerCase();
      list = list.filter(m => (m.nickname || '').toLowerCase().includes(k) || (m.phone || '').includes(k));
    }
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /** 会员总数 */
  count(tenantId) {
    return this.store.count('members', m => m.tenantId === tenantId);
  }
}

module.exports = MemberManager;
