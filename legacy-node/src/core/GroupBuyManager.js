/**
 * 团购活动管理（社区团购核心）
 * - 创建团购活动（商品+团购价+成团人数+截止时间）
 * - 会员开团/参团，成团后仍可在截止前继续参团（不超过上限）
 * - 成团进度统计与自动关闭
 */

const { business } = require('../errors');
const { randomUUID: uuidv4 } = require('crypto');

class GroupBuyManager {
  constructor(store, productManager, config) {
    this.store = store;
    this.products = productManager;
    this.config = config || { minParticipants: 2, autoCloseHours: 24 };
    this.timer = null;
  }

  initialize() {
    if (this.config.autoCloseEnabled === false) return;
    this.timer = setInterval(() => this._autoCloseExpired().catch(error => console.error('[GroupBuy] 自动结束失败:', error.message)), 60000);
    if (this.timer.unref) this.timer.unref();
  }

  async create(tenantId, data) {
    const product = await this.products.get(data.productId);
    if (!product || product.tenantId !== tenantId) throw business('商品不存在');
    const groupPrice = Math.round(Number(data.groupPrice) * 100);
    if (!(groupPrice > 0)) throw business('团购价必须大于0');
    if (groupPrice > product.price) throw business('团购价不能高于商品原价');

    const now = new Date();
    const endAt = data.endAt ? new Date(data.endAt) :
      new Date(now.getTime() + (Number(data.durationHours) || this.config.autoCloseHours) * 3600000);
    if (isNaN(endAt.getTime())) throw business('活动截止时间无效');

    const minParticipants = Math.max(2, Number(data.minParticipants) || this.config.minParticipants);
    const maxParticipants = Math.max(minParticipants, Number(data.maxParticipants) || 100);
    const gb = {
      id: uuidv4(),
      tenantId,
      productId: product.id,
      title: String(data.title || product.name + '团购').slice(0, 50),
      groupPrice,
      minParticipants,
      maxParticipants,
      status: 'active', // active / success / closed / cancelled
      participants: [], // [{memberId, role:'leader'|'member', joinedAt}]
      startAt: now.toISOString(),
      endAt: endAt.toISOString(),
      createdAt: now.toISOString()
    };
    await this.store.insert('groupBuys', gb);
    return gb;
  }

  async list(tenantId, status) {
    let list = await this.store.find('groupBuys', g => g.tenantId === tenantId);
    if (status) list = list.filter(g => g.status === status);
    const decorated = await Promise.all(list.map(g => this._decorate(g)));
    return decorated.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async get(id) {
    const gb = await this.store.findById('groupBuys', id);
    return gb ? this._decorate(gb) : null;
  }

  async update(id, tenantId, data = {}) {
    const gb = await this.store.findById('groupBuys', id);
    if (!gb || gb.tenantId !== tenantId) throw business('团购活动不存在');
    if (['cancelled', 'closed'].includes(gb.status)) throw business('已结束的团购不能修改');
    const patch = {};
    if (data.title !== undefined) patch.title = String(data.title).trim().slice(0, 50);
    if (data.endAt !== undefined) {
      const endAt = new Date(data.endAt);
      if (isNaN(endAt.getTime()) || endAt.getTime() <= Date.now()) throw business('新的截止时间必须晚于当前时间');
      patch.endAt = endAt.toISOString();
    }
    if (data.extendHours !== undefined) {
      const base = Math.max(Date.now(), new Date(gb.endAt).getTime());
      patch.endAt = new Date(base + Math.max(1, Number(data.extendHours)) * 3600000).toISOString();
    }
    if (data.maxParticipants !== undefined) {
      const max = Math.max(2, Math.trunc(Number(data.maxParticipants) || 0));
      if (max < gb.participants.length || max < Number(gb.minParticipants || 2)) throw business('人数上限不能小于当前参团人数或成团人数');
      patch.maxParticipants = max;
    }
    if (!Object.keys(patch).length) throw business('没有需要修改的团购信息');
    patch.updatedByAction = 'admin-update';
    return this._decorate(await this.store.update('groupBuys', id, patch));
  }

  /** 判断某会员是否为有效参团者 */
  async hasParticipant(groupBuyId, memberId) {
    const gb = await this.store.findById('groupBuys', groupBuyId);
    if (!gb) return false;
    return gb.participants.some(p => p.memberId === memberId);
  }

  /** 参团：active 或 success 状态下、截止前均可加入 */
  async join(groupBuyId, memberId) {
    return this.store.transaction(async () => {
    const gb = await this.store.findByIdForUpdate('groupBuys', groupBuyId);
    if (!gb) throw business('团购活动不存在');
    if (gb.status === 'cancelled' || gb.status === 'closed') throw business('活动已结束');
    if (new Date(gb.endAt).getTime() < Date.now()) {
      await this.store.update('groupBuys', groupBuyId, { status: 'closed' });
      throw business('活动已截止');
    }
    if (gb.participants.some(p => p.memberId === memberId)) {
      return this._decorate(gb); // 已参团，幂等返回
    }
    if (gb.participants.length >= gb.maxParticipants) throw business('参团人数已满');

    const participants = gb.participants.concat([{
      memberId,
      role: gb.participants.length === 0 ? 'leader' : 'member',
      joinedAt: new Date().toISOString()
    }]);

    const patch = { participants };
    if (participants.length >= gb.minParticipants) {
      patch.status = 'success';
      patch.successAt = gb.successAt || new Date().toISOString();
    }
    return this._decorate(await this.store.update('groupBuys', groupBuyId, patch));
    });
  }

  async cancel(id) {
    const gb = await this.store.findById('groupBuys', id);
    if (!gb) throw business('团购活动不存在');
    if (gb.status === 'cancelled') return gb;
    return this.store.update('groupBuys', id, { status: 'cancelled' });
  }

  async _autoCloseExpired() {
    const now = Date.now();
    for (const gb of await this.store.find('groupBuys', () => true)) {
      if (gb.status === 'active' && new Date(gb.endAt).getTime() < now) {
        await this.store.update('groupBuys', gb.id, { status: 'closed' });
      }
    }
  }

  async _decorate(gb) {
    const p = await this.products.get(gb.productId);
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

