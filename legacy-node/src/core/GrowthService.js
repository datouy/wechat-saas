/**
 * 会员经营洞察：会员分层、复购、沉睡召回与群运营素材。
 */
const DAY = 86400000;

class GrowthService {
  constructor(store) {
    this.store = store;
  }

  async memberInsights(tenantId) {
    const now = Date.now();
    const [members, orders] = await Promise.all([
      this.store.find('members', item => item.tenantId === tenantId),
      this.store.find('orders', item => item.tenantId === tenantId && ['paid', 'delivering', 'completed'].includes(item.status))
    ]);
    const byMember = new Map(members.map(member => [member.id, []]));
    for (const order of orders) {
      if (!byMember.has(order.memberId)) byMember.set(order.memberId, []);
      byMember.get(order.memberId).push(order);
    }
    const rows = [...byMember.entries()].map(([memberId, memberOrders]) => {
      const member = members.find(item => item.id === memberId) || { id: memberId, nickname: '未命名会员' };
      const sorted = memberOrders.slice().sort((a, b) => new Date(a.paidAt || a.createdAt) - new Date(b.paidAt || b.createdAt));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const netSpent = sorted.reduce((sum, order) => sum + Math.max(0, Number(order.payAmount || 0) - Number(order.refundedAmount || 0)), 0);
      const lastAt = last ? new Date(last.paidAt || last.createdAt).getTime() : 0;
      const ageDays = lastAt ? Math.floor((now - lastAt) / DAY) : null;
      const recent90 = sorted.filter(order => now - new Date(order.paidAt || order.createdAt).getTime() <= 90 * DAY).length;
      let segment = 'new';
      if (!sorted.length) segment = 'lead';
      else if (ageDays >= 45) segment = 'dormant';
      else if (ageDays >= 21) segment = 'atRisk';
      else if (recent90 >= 3) segment = 'loyal';
      else if (netSpent >= 10000) segment = 'highValue';
      else if (first && now - new Date(first.paidAt || first.createdAt).getTime() <= 30 * DAY) segment = 'new';
      else segment = 'active';
      return {
        id: member.id,
        nickname: member.nickname || '未命名会员',
        phone: member.phone || '',
        orderCount: sorted.length,
        totalSpent: netSpent / 100,
        avgOrder: sorted.length ? netSpent / sorted.length / 100 : 0,
        lastPurchaseAt: last ? (last.paidAt || last.createdAt) : null,
        inactiveDays: ageDays,
        segment
      };
    });
    const buyers = rows.filter(item => item.orderCount > 0);
    const repeat = buyers.filter(item => item.orderCount >= 2);
    const labels = {
      highValue: '高价值会员', loyal: '高频复购', active: '活跃会员',
      new: '新会员', atRisk: '即将沉睡', dormant: '沉睡会员', lead: '未成交客户'
    };
    const segments = Object.keys(labels).map(key => ({
      key,
      label: labels[key],
      count: rows.filter(item => item.segment === key).length,
      members: rows.filter(item => item.segment === key).sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 8)
    }));
    const revenue = buyers.reduce((sum, item) => sum + item.totalSpent, 0);
    return {
      summary: {
        memberCount: rows.length,
        buyers: buyers.length,
        repeatBuyers: repeat.length,
        repurchaseRate: buyers.length ? Number((repeat.length / buyers.length * 100).toFixed(1)) : 0,
        dormant30: rows.filter(item => item.segment === 'dormant' || item.segment === 'atRisk').length,
        averageOrderValue: buyers.reduce((sum, item) => sum + item.avgOrder, 0) / Math.max(1, buyers.length),
        lifetimeRevenue: revenue,
        repeatRevenueShare: revenue ? Number((repeat.reduce((sum, item) => sum + item.totalSpent, 0) / revenue * 100).toFixed(1)) : 0
      },
      segments,
      recallCandidates: rows.filter(item => item.segment === 'dormant' || item.segment === 'atRisk').slice(0, 20)
    };
  }

  async materials(tenantId) {
    const [groups, products, coupons, growth] = await Promise.all([
      this.store.find('groupBuys', item => item.tenantId === tenantId && ['active', 'success'].includes(item.status)),
      this.store.find('products', item => item.tenantId === tenantId && item.onSale),
      this.store.find('couponTemplates', item => item.tenantId === tenantId && item.enabled),
      this.memberInsights(tenantId)
    ]);
    const items = [];
    for (const group of groups.slice(0, 3)) {
      const product = products.find(item => item.id === group.productId);
      const left = Math.max(0, Number(group.minParticipants || 0) - (group.participants || []).length);
      items.push({
        id: 'group-' + group.id,
        type: '拼团接龙',
        title: group.title,
        content: '邻里团「' + group.title + '」正在进行。' + (product ? product.name : '今日好物') +
          '团购价 ¥' + (Number(group.groupPrice || 0) / 100).toFixed(2) +
          (left ? '，还差 ' + left + ' 人成团' : '，已经成团') + '。截止 ' +
          new Date(group.endAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
          '，需要的邻居直接接龙。'
      });
    }
    const coupon = coupons[0];
    if (coupon) {
      items.push({
        id: 'coupon-' + coupon.id,
        type: '优惠提醒',
        title: coupon.name,
        content: '本周会员福利：满 ¥' + (coupon.threshold / 100).toFixed(2) + ' 减 ¥' +
          (coupon.amount / 100).toFixed(2) + '。数量按会员领取上限发放，先领后用。'
      });
    }
    if (growth.recallCandidates.length) {
      items.push({
        id: 'recall-dormant',
        type: '沉睡召回',
        title: '给 ' + growth.recallCandidates.length + ' 位邻居的召回文案',
        content: '最近没见到你，社区本周为你留了一份会员价好物。回复“需要”，我们就把今天的团购清单发给你；也欢迎直接到店看看新到商品。'
      });
    }
    return { generatedAt: new Date().toISOString(), items };
  }
}

module.exports = GrowthService;
