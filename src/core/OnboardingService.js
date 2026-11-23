/**
 * 三步经营引导。步骤由真实操作与审计记录推导，不使用仅点击“下一步”的假进度。
 */
const { business } = require('../errors');

class OnboardingService {
  constructor(store, auditLog) {
    this.store = store;
    this.auditLog = auditLog;
  }

  async get(tenantId, adminId) {
    const progress = (await this.store.find('onboardingProgress', item => item.tenantId === tenantId && item.adminId === adminId))[0] || {};
    const audits = (await this.auditLog.listByTenant(tenantId, {})).filter(item => item.actorId === adminId);
    const handledOrder = audits.some(item => ['order.deliver', 'order.batch-deliver', 'order.verify-pickup', 'order.refund', 'order.create', 'order.pay'].includes(item.action));
    const handledCustomer = audits.some(item => ['member.points-adjust', 'member.coupon-grant', 'customer.view'].includes(item.action)) || !!progress.customerViewedAt;
    const steps = [
      { id: 'today', label: '读懂今天的经营待办', description: '查看销售额、待履约事项和团购进度', completed: !!progress.todayViewedAt },
      { id: 'order', label: '完成一笔履约', description: '发货、自提核销或处理退款', completed: handledOrder },
      { id: 'customer', label: '查看一位客户档案', description: '了解积分、优惠券和复购轨迹', completed: handledCustomer }
    ];
    return { steps, completed: steps.filter(item => item.completed).length, total: steps.length };
  }

  async mark(tenantId, adminId, step, actor = {}) {
    if (!['today', 'customer'].includes(step)) throw business('不支持该引导步骤');
    const existing = (await this.store.find('onboardingProgress', item => item.tenantId === tenantId && item.adminId === adminId))[0];
    const now = new Date().toISOString();
    if (existing) {
      await this.store.update('onboardingProgress', existing.id, step === 'today' ? { todayViewedAt: now } : { customerViewedAt: now });
    } else {
      await this.store.insert('onboardingProgress', {
        id: tenantId + ':' + adminId,
        tenantId,
        adminId,
        actorName: actor.name || '',
        todayViewedAt: step === 'today' ? now : null,
        customerViewedAt: step === 'customer' ? now : null,
        createdAt: now
      });
    }
    if (step === 'customer') {
      await this.auditLog.record({ tenantId, actorType: 'admin', actorId: adminId, actorName: actor.name || '', action: 'customer.view', resource: 'member' });
    }
    return this.get(tenantId, adminId);
  }
}

module.exports = OnboardingService;
