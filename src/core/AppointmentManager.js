/**
 * 预约管理
 * - 服务项目（如家政保洁、美容美发）
 * - 时间段容量管理
 * - 会员预约/取消，防重复占位
 */
const { randomUUID: uuidv4 } = require('crypto');
const { cnDate } = require('./time');

class AppointmentManager {
  constructor(store) { this.store = store; }

  /** 创建可预约服务 */
  createService(tenantId, data) {
    const svc = {
      id: uuidv4(),
      tenantId,
      name: String(data.name || '').slice(0, 30),
      price: Math.round(Number(data.price) * 100),
      durationMinutes: Number(data.durationMinutes) || 60,
      capacityPerSlot: Math.max(1, Number(data.capacityPerSlot) || 1),
      // 可预约时段，如 ['09:00','10:00','14:00']
      slots: Array.isArray(data.slots) ? data.slots.slice(0, 30) : ['09:00', '10:00', '14:00', '15:00'],
      enabled: data.enabled !== false,
      createdAt: new Date().toISOString()
    };
    if (!svc.name) throw business('服务名称不能为空');
    this.store.insert('appointmentServices', svc);
    return svc;
  }

  listServices(tenantId) {
    return this.store.find('appointmentServices', s => s.tenantId === tenantId);
  }

  /** 查询某日某服务的可用时段（含余位） */
  querySlots(serviceId, date) {
    const svc = this.store.findById('appointmentServices', serviceId);
    if (!svc) throw business('服务不存在');
    const booked = this.store.find('appointments',
      a => a.serviceId === serviceId && a.date === date && a.status === 'booked');
    return svc.slots.map(slot => {
      const used = booked.filter(b => b.slot === slot).length;
      return { slot, capacity: svc.capacityPerSlot, used, available: svc.capacityPerSlot - used };
    });
  }

  /** 预约 */
  book(serviceId, memberId, date, slot, note) {
    const svc = this.store.findById('appointmentServices', serviceId);
    if (!svc || !svc.enabled) throw business('服务不可预约');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw business('日期格式需为 YYYY-MM-DD');
    if (!svc.slots.includes(slot)) throw business('时段无效');
    if (date < cnDate()) throw business('不能预约过去的日期');

    const dup = this.store.find('appointments',
      a => a.serviceId === serviceId && a.memberId === memberId && a.date === date && a.slot === slot && a.status === 'booked');
    if (dup.length) throw business('您已预约该时段');

    const slots = this.querySlots(serviceId, date);
    const target = slots.find(s => s.slot === slot);
    if (!target || target.available <= 0) throw business('该时段已约满');

    const appt = {
      id: uuidv4(),
      tenantId: svc.tenantId,
      serviceId,
      serviceName: svc.name,
      memberId,
      date,
      slot,
      note: String(note || '').slice(0, 100),
      status: 'booked', // booked / completed / cancelled
      createdAt: new Date().toISOString()
    };
    this.store.insert('appointments', appt);
    return appt;
  }

  cancel(appointmentId, memberId) {
    const a = this.store.findById('appointments', appointmentId);
    if (!a) throw business('预约不存在');
    if (memberId && a.memberId !== memberId) throw business('无权操作');
    if (a.status !== 'booked') throw business('预约已不可取消');
    a.status = 'cancelled';
    a.cancelledAt = new Date().toISOString();
    this.store.markDirty('appointments');
    return a;
  }

  listByTenant(tenantId, opts = {}) {
    let list = this.store.find('appointments', a => a.tenantId === tenantId);
    if (opts.date) list = list.filter(a => a.date === opts.date);
    if (opts.status) list = list.filter(a => a.status === opts.status);
    return list.sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
  }

  listByMember(memberId) {
    return this.store.find('appointments', a => a.memberId === memberId)
      .sort((a, b) => (b.date + b.slot).localeCompare(a.date + a.slot));
  }
}

module.exports = AppointmentManager;
