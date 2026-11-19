/**
 * 团购活动管理（社区团购核心）
 * - 创建团购活动（商品+团购价+成团人数+截止时间）
 * - 会员开团/参团，成团后仍可在截止前继续参团（不超过上限）
 * - 成团进度统计与自动关闭
 */
const { randomUUID: uuidv4 } = require('crypto');

class GroupBuyManager {
  constructor(store, productManager, config) {
    this.store = store;
    this.products = productManager;
    this.config = config || { minParticipants: 2, autoCloseHours: 24 };
    this.timer = null;
  }

  initialize() {
    this.timer = setInterval(() => this._autoCloseExpired(), 60000);
  }

  create(tenantId, data) {
    const product = this.products.get(data.productId);
    if (!product || product.tenantId !== tenantId) throw new Error('商品不存在');
    const groupPrice = Math.round(Number(data.groupPrice) * 100);
    if (!(groupPrice > 0)) throw new Error('团购价必须大于0');
    if (groupPrice > product.price) throw new Error('团购价不能高于商品原价');

    const now = new Date();
    const endAt = data.endAt ? new Date(data.endAt) :
      new Date(now.getTime() + (Number(data.durationHours) || this.config.autoCloseHours) * 3600000);
    if (isNaN(endAt.getTime())) throw new Error('活动截止时间无效');

    const gb = {
      id: uuidv4(),
      tenantId,
      productId: product.id,
      title: String(data.title || product.name + '团购').slice(0, 50),
      groupPrice,
      minParticipants: Math.max(2, Number(data.minParticipants) || this.config.minParticipants),
      maxParticipants: Number(data.maxParticipants) || 100,
      status: 'active', // active / success / closed / cancelled
      participants: [], // [{memberId, role:'leader'|'member', joinedAt}]
      startAt: now.toISOString(),
      endAt: endAt.toISOString(),
      createdAt: now.toISOString()
    };
    this.store.insert('groupBuys', gb);
    return gb;
  }

  list(tenantId, status) {
    let list = this.store.find('groupBuys', g => g.tenantId === tenantId);
    if (status) list = list.filter(g => g.status === status);
    return list
      .map(g => this._decorate(g))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  get(id) {
    const gb = this.store.findById('groupBuys', id);
    return gb ? this._decorate(gb) : null;
  }

  /** 判断某会员是否为有效参团者 */
  hasParticipant(groupBuyId, memberId) {
    const gb = this.store.findById('groupBuys', groupBuyId);
    if (!gb) return false;
    return gb.participants.some(p => p.memberId === memberId);
  }

  /** 参团：active 或 success 状态下、截止前均可加入 */
  join(groupBuyId, memberId) {
    const gb = this.store.findById('groupBuys', groupBuyId);
    if (!gb) throw new Error('团购活动不存在');
    if (gb.status === 'cancelled' || gb.status === 'closed') throw new Error('活动已结束');
    if (new Date(gb.endAt).getTime() < Date.now()) {
      gb.status = 'closed';
      this.store.markDirty('groupBuys');
      throw new Error('活动已截止');
    }
    if (gb.participants.some(p => p.memberId === memberId)) {
      return this._decorate(gb); // 已参团，幂等返回
    }
    if (gb.participants.length >= gb.maxParticipants) throw new Error('参团人数已满');

    gb.participants.push({
      memberId,
      role: gb.participants.length === 0 ? 'leader' : 'member',
      joinedAt: new Date().toISOString()
    });

    if (gb.participants.length >= gb.minParticipants) {
      gb.status = 'success';
      gb.successAt = gb.successAt || new Date().toISOString();
    }
    this.store.markDirty('groupBuys');
    return this._decorate(gb);
  }

  cancel(id) {
    const gb = this.store.findById('groupBuys', id);
    if (!gb) throw new Error('团购活动不存在');
    if (gb.status === 'cancelled') return gb;
    gb.status = 'cancelled';
    this.store.markDirty('groupBuys');
    return gb;
  }

  _autoCloseExpired() {
    const now = Date.now();
    let changed = false;
    for (const gb of this.store.collection('groupBuys')) {
      if ((gb.status === 'active' || gb.status === 'success') && new Date(gb.endAt).getTime() < now) {
        if (gb.status === 'active') gb.status = 'closed';
        changed = true;
      }
    }
    if (changed) this.store.markDirty('groupBuys');
  }

  _decorate(gb) {
    const p = this.products.get(gb.productId);
    return {
      ...gb,
      product: p ? { id: p.id, name: p.name, image: p.image, unit: p.unit, price: p.price } : null,
      participantCount: gb.participants.length,
      remaining: Math.max(0, gb.minParticipants - gb.participants.length)
    };
  }

  shutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = GroupBuyManager;

