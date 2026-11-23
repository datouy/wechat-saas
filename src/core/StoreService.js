/**
 * 租户门店资料与体验配置。
 * 资料独立于租户注册表，便于后续扩展品牌、联系方式和营业规则。
 */
class StoreService {
  constructor(store, defaults = {}) {
    this.store = store;
    this.defaults = defaults;
  }

  async get(tenantId) {
    const saved = await this.store.findById('storeProfiles', tenantId) || {};
    return {
      id: tenantId,
      name: this.defaults.name || tenantId,
      tagline: '社区好物，今天下单，明天到家',
      description: '围绕社区团购、会员积分、预约和问卷的一体化经营空间。',
      announcement: '今日下单，明日 17:00 后可在社区服务站自提。',
      contactPhone: '',
      pickupAddress: '',
      deliveryNotice: '满 59 元免配送费，具体以结算页为准。',
      brandColor: '#b84a35',
      miniProgramTitle: '邻里团',
      miniProgramAppId: '',
      customerServicePhone: '',
      logoUrl: '',
      brandImageUrl: '',
      ...saved,
      id: tenantId
    };
  }

  async update(tenantId, patch) {
    const current = await this.get(tenantId);
    const clean = {};
    const allow = [
      'name', 'tagline', 'description', 'announcement', 'contactPhone', 'pickupAddress',
      'deliveryNotice', 'brandColor', 'miniProgramTitle', 'miniProgramAppId', 'customerServicePhone'
      , 'logoUrl', 'brandImageUrl'
    ];
    for (const key of allow) {
      if (patch[key] !== undefined) clean[key] = String(patch[key]).trim();
    }
    if (clean.name !== undefined && !clean.name) delete clean.name;
    const next = { ...current, ...clean, updatedAt: new Date().toISOString() };
    const existing = await this.store.findById('storeProfiles', tenantId);
    if (existing) return this.store.update('storeProfiles', tenantId, next);
    await this.store.insert('storeProfiles', next);
    return next;
  }
}

module.exports = StoreService;
