/**
 * 租户下的多履约门店：自提点、配送门店、营业时间和公开品牌配置。
 */
const { randomUUID } = require('crypto');
const { business } = require('../errors');

class LocationService {
  constructor(store, storeService, platformService) {
    this.store = store;
    this.storeService = storeService;
    this.platform = platformService || null;
  }

  async initialize(tenantId) {
    if (await this.store.count('storeLocations', item => item.tenantId === tenantId)) return this.primary(tenantId);
    const profile = await this.storeService.get(tenantId);
    return this.create(tenantId, {
      name: profile.name,
      code: 'MAIN',
      address: profile.pickupAddress || '社区服务站',
      phone: profile.contactPhone || '',
      hours: '每日 09:00-20:00',
      pickupEnabled: true,
      deliveryEnabled: true,
      isPrimary: true,
      status: 'active',
      brandColor: profile.brandColor
    });
  }

  async list(tenantId, opts = {}) {
    let list = await this.store.find('storeLocations', item => item.tenantId === tenantId);
    if (opts.activeOnly) list = list.filter(item => item.status === 'active');
    return list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || new Date(a.createdAt) - new Date(b.createdAt));
  }

  async primary(tenantId) {
    const list = await this.list(tenantId, { activeOnly: true });
    return list.find(item => item.isPrimary) || list[0] || null;
  }

  async get(id, tenantId) {
    const location = await this.store.findById('storeLocations', id);
    return location && (!tenantId || location.tenantId === tenantId) ? location : null;
  }

  async create(tenantId, data = {}) {
    return this.store.transaction(async () => {
    if (this.platform) await this.platform.assertQuota(tenantId, 'locations');
    const existing = await this.list(tenantId);
    if (existing.length >= 20) throw business('每个租户最多配置 20 个履约门店');
    const item = {
      id: randomUUID(),
      tenantId,
      name: String(data.name || '社区门店').trim().slice(0, 40),
      code: String(data.code || '').trim().toUpperCase().slice(0, 20),
      address: String(data.address || '').trim().slice(0, 160),
      phone: String(data.phone || '').trim().slice(0, 30),
      hours: String(data.hours || '每日 09:00-20:00').trim().slice(0, 80),
      pickupEnabled: data.pickupEnabled !== false,
      deliveryEnabled: data.deliveryEnabled !== false,
      isPrimary: !!data.isPrimary,
      status: data.status === 'disabled' ? 'disabled' : 'active',
      brandColor: /^#[0-9a-f]{6}$/i.test(String(data.brandColor || '')) ? data.brandColor : '#b84a35',
      createdAt: new Date().toISOString()
    };
    if (!item.name || !item.address) throw business('门店名称和地址不能为空');
    if (existing.some(other => other.code && other.code === item.code)) throw business('门店编码已存在');
    if (item.isPrimary || !existing.some(other => other.isPrimary && other.status === 'active')) item.isPrimary = true;
    if (item.isPrimary) {
      for (const other of existing) await this.store.update('storeLocations', other.id, { isPrimary: false });
    }
    await this.store.insert('storeLocations', item);
    return item;
    });
  }

  async update(id, tenantId, data = {}) {
    const current = await this.get(id, tenantId);
    if (!current) throw business('履约门店不存在');
    const patch = {};
    const textFields = { name: 40, code: 20, address: 160, phone: 30, hours: 80 };
    for (const [key, max] of Object.entries(textFields)) {
      if (data[key] !== undefined) patch[key] = String(data[key]).trim().slice(0, max);
    }
    if (patch.code !== undefined) {
      patch.code = patch.code.toUpperCase();
      if ((await this.list(tenantId)).some(other => other.id !== id && other.code && other.code === patch.code)) throw business('门店编码已存在');
    }
    if (data.pickupEnabled !== undefined) patch.pickupEnabled = !!data.pickupEnabled;
    if (data.deliveryEnabled !== undefined) patch.deliveryEnabled = !!data.deliveryEnabled;
    if (data.status !== undefined) patch.status = data.status === 'disabled' ? 'disabled' : 'active';
    if (data.brandColor !== undefined) patch.brandColor = /^#[0-9a-f]{6}$/i.test(String(data.brandColor)) ? data.brandColor : current.brandColor;
    if (data.isPrimary) {
      for (const other of await this.list(tenantId)) await this.store.update('storeLocations', other.id, { isPrimary: other.id === id });
      patch.isPrimary = true;
    }
    if (!(patch.name || current.name) || !(patch.address || current.address)) throw business('门店名称和地址不能为空');
    return this.store.update('storeLocations', id, patch);
  }

  async publicList(tenantId) {
    return (await this.list(tenantId, { activeOnly: true })).map(item => ({
      id: item.id,
      name: item.name,
      address: item.address,
      phone: item.phone,
      hours: item.hours,
      pickupEnabled: item.pickupEnabled,
      deliveryEnabled: item.deliveryEnabled,
      isPrimary: item.isPrimary,
      brandColor: item.brandColor
    }));
  }
}

module.exports = LocationService;
