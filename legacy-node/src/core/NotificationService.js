/**
 * 小程序订阅消息：模板可由环境变量提供，也可在经营台按租户覆盖。
 * 未配置或发送失败都不影响订单主链路，并保留可查询的发送记录。
 */
const { randomUUID } = require('crypto');
const { cnDate } = require('./time');

const EVENT_LABELS = {
  orderPaid: '支付成功',
  orderDelivered: '发货/待自提提醒',
  pickupReady: '取货已就绪',
  pickupReminder: '取货超时提醒',
  pickupCompleted: '取货完成',
  refundSubmitted: '退款已提交',
  refundCompleted: '退款完成',
  afterSalesSubmitted: '售后已受理',
  afterSalesUpdated: '售后进展更新',
  appointmentBooked: '预约成功'
};

class NotificationService {
  constructor(store, wechat, memberManager, templates, outbox) {
    this.store = store;
    this.wechat = wechat;
    this.members = memberManager;
    this.defaults = templates || {};
    this.outbox = outbox || null;
  }

  async listTemplates(tenantId, events) {
    const selected = events && events.length ? events : Object.keys(EVENT_LABELS);
    const out = [];
    for (const event of selected) {
      const template = await this._template(event, tenantId);
      const stored = await this._storedTemplate(tenantId, event);
      out.push({
        event,
        title: EVENT_LABELS[event] || event,
        templateId: template && template.templateId ? template.templateId : '',
        page: template && template.page ? template.page : '',
        data: template && template.data ? template.data : {},
        enabled: template ? template.enabled !== false : false,
        configured: !!(template && template.templateId),
        source: stored ? 'tenant' : (template ? 'environment' : 'none')
      });
    }
    return out;
  }

  async updateTemplate(tenantId, event, patch = {}) {
    if (!EVENT_LABELS[event]) throw new Error('不支持的订阅消息事件');
    const existing = await this._storedTemplate(tenantId, event);
    const clean = {
      tenantId,
      event,
      templateId: String(patch.templateId || '').trim().slice(0, 128),
      page: String(patch.page || '').trim().slice(0, 200),
      data: patch.data && typeof patch.data === 'object' && !Array.isArray(patch.data) ? patch.data : {},
      enabled: patch.enabled !== false,
      updatedAt: new Date().toISOString()
    };
    if (existing) return this.store.update('notificationTemplates', existing.id, clean);
    return this.store.insert('notificationTemplates', {
      id: tenantId + ':' + event,
      ...clean,
      createdAt: clean.updatedAt
    });
  }

  async testTemplate(tenantId, event, memberId) {
    const member = memberId ? await this.members.get(memberId) : (await this.store.find('members', item => item.tenantId === tenantId))[0];
    if (!member || member.tenantId !== tenantId) throw new Error('没有可用于测试的会员');
    if (!(await this._template(event, tenantId))) throw new Error('请先配置该消息模板');
    const queued = await this.notifyMember(member.id, event, {
      orderNo: 'TEST-' + Date.now(),
      amount: '0.01',
      status: '测试消息',
      date: cnDate(),
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      pickupCode: '000000',
      serviceName: '订阅消息测试'
    });
    if (queued && this.outbox) return this.outbox.deliverNow(queued.id, tenantId);
    return queued;
  }

  async notifyMember(memberId, event, variables) {
    const member = await this.members.get(memberId);
    if (!member) return null;
    const template = await this._template(event, member.tenantId);
    if (!template || !template.templateId || template.enabled === false || !member.openid) return null;
    const data = this._renderData(template.data || {}, variables || {});
    if (this.outbox) {
      const record = await this.outbox.enqueue({
        tenantId: member.tenantId,
        memberId,
        openid: member.openid,
        event,
        title: EVENT_LABELS[event] || event,
        templateId: template.templateId,
        page: template.page || '',
        payload: data
      });
      this.outbox.kick();
      return record;
    }
    const record = {
      id: randomUUID(),
      tenantId: member.tenantId,
      memberId,
      event,
      title: EVENT_LABELS[event] || event,
      templateId: template.templateId,
      status: 'sending',
      createdAt: new Date().toISOString()
    };
    await this.store.insert('notifications', record);
    try {
      const result = await this.wechat.sendSubscribeMessage({
        openid: member.openid,
        templateId: template.templateId,
        page: template.page || '',
        data
      });
      await this.store.update('notifications', record.id, {
        status: result && result.mock ? 'mocked' : 'sent',
        result: { errcode: result && result.errcode, errmsg: result && result.errmsg },
        sentAt: new Date().toISOString()
      });
      return result;
    } catch (error) {
      await this.store.update('notifications', record.id, { status: 'failed', error: error.message, failedAt: new Date().toISOString() });
      return null;
    }
  }

  async notifyOrder(order, event, extra) {
    return this.notifyMember(order.memberId, event, {
      orderNo: order.orderNo,
      amount: (Number(order.payAmount || 0) / 100).toFixed(2),
      status: order.status,
      date: order.createdAt ? cnDate(new Date(order.createdAt)) : '',
      pickupCode: order.pickupCode || '',
      ...extra
    });
  }

  async notifyAppointment(appointment, event, extra) {
    return this.notifyMember(appointment.memberId, event, {
      date: appointment.date,
      time: appointment.slot,
      serviceName: appointment.serviceName,
      ...extra
    });
  }

  async _storedTemplate(tenantId, event) {
    return (await this.store.find('notificationTemplates', item => item.tenantId === tenantId && item.event === event))[0] || null;
  }

  async _template(event, tenantId) {
    const stored = tenantId ? await this._storedTemplate(tenantId, event) : null;
    if (stored) return { ...stored, enabled: stored.enabled !== false };
    const raw = this.defaults[event];
    if (!raw) return null;
    return typeof raw === 'string' ? { templateId: raw, enabled: true } : { ...raw, enabled: raw.enabled !== false };
  }

  _renderData(templateData, variables) {
    const out = {};
    for (const key of Object.keys(templateData || {})) {
      const value = templateData[key];
      const raw = value && typeof value === 'object' ? value.value : value;
      out[key] = {
        value: String(raw == null ? '' : raw).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => {
          return variables[name] == null ? '' : String(variables[name]);
        }).slice(0, 20)
      };
    }
    return out;
  }
}

NotificationService.EVENTS = Object.keys(EVENT_LABELS);
module.exports = NotificationService;
