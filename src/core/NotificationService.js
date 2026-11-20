/**
 * 小程序订阅消息发送与审计。未配置模板时安静跳过，不影响交易主链路。
 */
const { randomUUID } = require('crypto');

class NotificationService {
  constructor(store, wechat, memberManager, templates) {
    this.store = store;
    this.wechat = wechat;
    this.members = memberManager;
    this.templates = templates || {};
  }

  listTemplates(events) {
    const selected = events && events.length ? events : Object.keys(this.templates);
    const labels = {
      orderPaid: '支付成功',
      orderDelivered: '发货提醒',
      pickupCompleted: '取货完成',
      refundCompleted: '退款完成',
      appointmentBooked: '预约成功'
    };
    return selected
      .map(event => {
        const t = this._template(event);
        return t && t.templateId ? { event, title: labels[event] || event, templateId: t.templateId } : null;
      })
      .filter(Boolean);
  }

  async notifyMember(memberId, event, variables) {
    const template = this._template(event);
    const member = this.members.get(memberId);
    if (!template || !template.templateId || !member || !member.openid) return null;
    const data = this._renderData(template.data, variables || {});
    const record = {
      id: randomUUID(),
      tenantId: member.tenantId,
      memberId,
      event,
      templateId: template.templateId,
      status: 'sending',
      createdAt: new Date().toISOString()
    };
    this.store.insert('notifications', record);
    try {
      const result = await this.wechat.sendSubscribeMessage({
        openid: member.openid,
        templateId: template.templateId,
        page: template.page || '',
        data
      });
      this.store.update('notifications', record.id, {
        status: result && result.mock ? 'mocked' : 'sent',
        result: { errcode: result && result.errcode, errmsg: result && result.errmsg }
      });
      return result;
    } catch (e) {
      this.store.update('notifications', record.id, { status: 'failed', error: e.message });
      return null;
    }
  }

  notifyOrder(order, event, extra) {
    const vars = {
      orderNo: order.orderNo,
      amount: (Number(order.payAmount || 0) / 100).toFixed(2),
      status: order.status,
      date: String(order.createdAt || '').slice(0, 10),
      pickupCode: order.pickupCode || '',
      ...extra
    };
    return this.notifyMember(order.memberId, event, vars);
  }

  notifyAppointment(appointment, event, extra) {
    return this.notifyMember(appointment.memberId, event, {
      date: appointment.date,
      time: appointment.slot,
      serviceName: appointment.serviceName,
      ...extra
    });
  }

  _template(event) {
    const raw = this.templates[event];
    if (!raw) return null;
    return typeof raw === 'string' ? { templateId: raw } : raw;
  }

  _renderData(templateData, variables) {
    const out = {};
    for (const key of Object.keys(templateData || {})) {
      const value = templateData[key];
      const raw = value && typeof value === 'object' ? value.value : value;
      out[key] = {
        value: String(raw == null ? '' : raw).replace(/\{([A-Za-z0-9_]+)\}/g, (m, name) => {
          return variables[name] == null ? '' : String(variables[name]);
        }).slice(0, 20)
      };
    }
    return out;
  }
}

module.exports = NotificationService;
