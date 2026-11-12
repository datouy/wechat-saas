/**
 * 演示数据初始化
 * 首次启动自动创建：分类/商品/团购/优惠券/表单/预约服务
 * 已存在数据时跳过（幂等）
 */
async function run(store, pm, cm, fm, am, config) {
  const tenantId = config.tenant.defaultId;

  if (store.count('categories') > 0) {
    console.log('[Seed] 数据已存在，跳过初始化');
    return;
  }
  console.log('[Seed] 首次启动，创建演示数据...');

  // 分类
  const cats = [
    pm.createCategory(tenantId, { name: '生鲜蔬果', sort: 1 }),
    pm.createCategory(tenantId, { name: '肉禽蛋奶', sort: 2 }),
    pm.createCategory(tenantId, { name: '粮油副食', sort: 3 }),
    pm.createCategory(tenantId, { name: '日用百货', sort: 4 })
  ];

  // 商品
  const p1 = pm.create(tenantId, { name: '山东红富士苹果', description: '脆甜多汁，产地直发，5斤装', categoryId: cats[0].id, unit: '5斤装', price: 29.9, originalPrice: 39.9, stock: 200, image: '' });
  const p2 = pm.create(tenantId, { name: '散养土鸡蛋', description: '农户散养，营养早餐必备，30枚', categoryId: cats[1].id, unit: '30枚', price: 25.8, originalPrice: 32, stock: 150, image: '' });
  const p3 = pm.create(tenantId, { name: '巴氏鲜牛奶', description: '每日鲜奶，冷链配送，950ml', categoryId: cats[1].id, unit: '瓶', price: 15.9, originalPrice: 18.9, stock: 100, image: '' });
  const p4 = pm.create(tenantId, { name: '东北五常大米', description: '当季新米，10斤装', categoryId: cats[2].id, unit: '10斤装', price: 59.9, originalPrice: 69.9, stock: 80, image: '' });
  const p5 = pm.create(tenantId, { name: '抽纸家庭装', description: '3层加厚，24包整箱', categoryId: cats[3].id, unit: '箱', price: 39.9, originalPrice: 49.9, stock: 60, image: '' });
  pm.create(tenantId, { name: '本地青菜', description: '当日采摘，绿色种植，1斤', categoryId: cats[0].id, unit: '1斤', price: 5.9, originalPrice: 7.9, stock: 300, image: '' });

  // 团购活动（2个进行中）
  const now = Date.now();
  store.insert('groupBuys', {
    id: 'gb-apple-001', tenantId, productId: p1.id,
    title: '周末苹果团 · 5斤装',
    groupPrice: 2490, minParticipants: 3, maxParticipants: 50,
    status: 'active', participants: [],
    startAt: new Date(now).toISOString(),
    endAt: new Date(now + 48 * 3600000).toISOString(),
    createdAt: new Date(now).toISOString()
  });
  store.insert('groupBuys', {
    id: 'gb-milk-001', tenantId, productId: p3.id,
    title: '早餐牛奶团 · 每日鲜奶',
    groupPrice: 1290, minParticipants: 2, maxParticipants: 30,
    status: 'active', participants: [],
    startAt: new Date(now).toISOString(),
    endAt: new Date(now + 24 * 3600000).toISOString(),
    createdAt: new Date(now).toISOString()
  });

  // 优惠券模板
  cm.createTemplate(tenantId, { name: '新人立减5元', threshold: 30, amount: 5, validDays: 30, limitPerMember: 1 });
  cm.createTemplate(tenantId, { name: '满99减10', threshold: 99, amount: 10, validDays: 15, limitPerMember: 2 });

  // 表单问卷
  fm.create(tenantId, {
    title: '社区团购满意度调查',
    description: '感谢您参与，您的反馈将帮助我们做得更好',
    fields: [
      { label: '您对本次团购商品质量满意吗？', type: 'rating', required: true },
      { label: '您最常购买哪类商品？', type: 'radio', options: ['生鲜蔬果', '肉禽蛋奶', '粮油副食', '日用百货'], required: true },
      { label: '希望增加哪些品类？', type: 'checkbox', options: ['水果', '海鲜', '零食', '烘焙', '母婴'], required: false },
      { label: '其他建议', type: 'textarea', required: false }
    ]
  });

  // 预约服务
  am.createService(tenantId, {
    name: '家政保洁预约', price: 89, durationMinutes: 120, capacityPerSlot: 2,
    slots: ['09:00', '10:00', '14:00', '15:00', '16:00']
  });
  am.createService(tenantId, {
    name: '理发预约', price: 45, durationMinutes: 45, capacityPerSlot: 1,
    slots: ['10:00', '11:00', '14:00', '15:00', '16:00', '17:00']
  });

  // 演示会员（mock登录用）
  store.insert('members', {
    id: 'm-demo-001', tenantId,
    openid: 'mock_demo_openid_001',
    nickname: '演示用户', avatar: '', phone: '13800000000',
    addresses: [{ id: 'addr-001', name: '演示用户', phone: '13800000000', detail: '示例小区1栋101', isDefault: true }],
    totalSpent: 0, orderCount: 0,
    createdAt: new Date().toISOString()
  });
  // 初始化演示会员积分
  store.insert('pointsLedger', {
    id: 'pts-demo-001', memberId: 'm-demo-001', change: 100,
    reason: '新会员赠送积分', refId: '', createdAt: new Date().toISOString()
  });

  console.log('[Seed] ✅ 演示数据已创建：6个商品 / 2个团购 / 2张优惠券 / 1个问卷 / 2个预约服务');
}

module.exports = { run };
