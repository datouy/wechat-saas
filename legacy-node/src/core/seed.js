/**
 * 首次启动演示数据。
 * 数据覆盖从顾客下单、支付、履约到会员资产与经营待办的完整链路。
 */
const { cnDate } = require('./time');

const DEMO_COLLECTIONS = [
  'categories', 'products', 'groupBuys', 'couponTemplates', 'coupons',
  'forms', 'formSubmissions', 'appointmentServices', 'appointments',
  'orders', 'members', 'pointsLedger', 'notifications', 'storeProfiles',
  'afterSalesRequests', 'notificationTemplates', 'inventoryAdjustments',
  'storeLocations', 'onboardingProgress', 'analyticsMeta', 'analyticsDaily', 'paymentTransactions'
];

function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString();
}

function line(product, quantity, unitPrice) {
  const price = unitPrice === undefined ? product.price : unitPrice;
  return {
    productId: product.id,
    name: product.name,
    image: product.image,
    unit: product.unit,
    unitPrice: price,
    quantity,
    subtotal: price * quantity
  };
}

function orderRecord({ id, orderNo, tenantId, member, items, status, createdAt, paidAt, deliveryType, address, pickupCode, couponId, couponDiscount = 0 }) {
  const goodsAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
  return {
    id,
    orderNo,
    tenantId,
    memberId: member.id,
    items,
    goodsAmount,
    couponId: couponId || null,
    couponDiscount,
    pointsUsed: 0,
    pointsDiscount: 0,
    deliveryFee: 0,
    payAmount: Math.max(0, goodsAmount - couponDiscount),
    status,
    address: deliveryType === 'pickup' ? null : (address || (member.addresses && member.addresses[0]) || null),
    deliveryType,
    pickupCode: deliveryType === 'pickup' ? pickupCode : null,
    pickupVerifiedAt: status === 'completed' && deliveryType === 'pickup' ? paidAt : null,
    remark: '',
    groupBuyId: null,
    payInfo: paidAt ? { mock: true, transactionId: 'MOCK-' + orderNo, paidAt } : null,
    expiresAt: new Date(new Date(createdAt).getTime() + 30 * 60000).toISOString(),
    createdAt,
    paidAt: paidAt || null,
    completedAt: status === 'completed' ? isoAgo(3600000) : null,
    cancelledAt: null
  };
}

async function resetTenant(store, tenantId) {
  for (const collection of DEMO_COLLECTIONS) {
    for (const doc of await store.find(collection, item => item.tenantId === tenantId)) {
      await store.remove(collection, doc.id);
    }
  }
}

async function run(store, pm, cm, fm, am, config, storeService, tenantIdOverride) {
  const tenantId = tenantIdOverride || config.tenant.defaultId;
  if (storeService) {
    const existingProfile = await store.findById('storeProfiles', tenantId);
    if (!existingProfile) {
      await storeService.update(tenantId, {
        name: tenantId === config.tenant.defaultId ? (config.tenant.defaultName || '邻里团 · 青禾社区店') : tenantId,
        tagline: '把社区好物和邻里服务，放进一个清楚的日常里',
        description: '社区团购、自提履约、会员积分、预约和问卷经营的一体化门店。',
        announcement: '今日 20:00 前下单，明日下午 17:00 后社区服务站自提。',
        contactPhone: '0773-888 1024',
        pickupAddress: '青禾社区东门邻里服务站',
        deliveryNotice: '社区 3 公里内满 59 元免配送费。',
        brandColor: '#b84a35'
      });
    }
  }

  if (await store.count('categories', category => category.tenantId === tenantId) > 0) {
    console.log('[Seed] 数据已存在，跳过初始化');
    return;
  }
  console.log('[Seed] 首次启动，创建完整经营演示数据...');

  const cats = [
    await pm.createCategory(tenantId, { name: '新鲜水果', sort: 1 }),
    await pm.createCategory(tenantId, { name: '蛋奶早餐', sort: 2 }),
    await pm.createCategory(tenantId, { name: '粮油主食', sort: 3 }),
    await pm.createCategory(tenantId, { name: '居家日用', sort: 4 })
  ];

  const products = [
    await pm.create(tenantId, { name: '山东红富士苹果', description: '脆甜多汁，产地直发，5斤家庭装。', categoryId: cats[0].id, unit: '5斤装', price: 29.9, originalPrice: 39.9, stock: 36, image: '/static/demo/apple.svg' }),
    await pm.create(tenantId, { name: '散养土鸡蛋', description: '农户散养，早餐和烘焙都适合。', categoryId: cats[1].id, unit: '30枚', price: 25.8, originalPrice: 32, stock: 48, image: '/static/demo/eggs.svg' }),
    await pm.create(tenantId, { name: '巴氏鲜牛奶', description: '每日鲜奶，冷链配送，950ml。', categoryId: cats[1].id, unit: '瓶', price: 15.9, originalPrice: 18.9, stock: 72, image: '/static/demo/milk.svg' }),
    await pm.create(tenantId, { name: '东北五常大米', description: '当季新米，米香饱满，10斤装。', categoryId: cats[2].id, unit: '10斤装', price: 59.9, originalPrice: 69.9, stock: 6, image: '/static/demo/rice.svg' }),
    await pm.create(tenantId, { name: '抽纸家庭装', description: '3层加厚，24包整箱。', categoryId: cats[3].id, unit: '箱', price: 39.9, originalPrice: 49.9, stock: 31, image: '/static/demo/tissue.svg' }),
    await pm.create(tenantId, { name: '本地青菜', description: '当日采摘，绿色种植，1斤。', categoryId: cats[0].id, unit: '1斤', price: 5.9, originalPrice: 7.9, stock: 89, image: '/static/demo/greens.svg' })
  ];

  for (const [index, quantity] of [13, 9, 18, 4, 6, 21].entries()) {
    await store.update('products', products[index].id, { sales: quantity });
  }

  const members = [
    {
      id: 'm-demo-001', tenantId, openid: 'mock_5c2e139cc8fe8ebebb6c', unionid: '', nickname: '刘可', avatar: '', phone: '13800001234',
      addresses: [{ id: 'addr-browser-001', name: '刘可', phone: '13800001234', detail: '青禾社区 3 栋 1202', isDefault: true }],
      totalSpent: 103.7, orderCount: 3, lastLoginAt: isoAgo(5 * 60000), createdAt: isoAgo(21 * 86400000)
    },
    {
      id: 'm-demo-002', tenantId, openid: 'mock_demo_002', unionid: '', nickname: '李静', avatar: '', phone: '13900005678',
      addresses: [{ id: 'addr-demo-002', name: '李静', phone: '13900005678', detail: '青禾社区 1 栋 801', isDefault: true }],
      totalSpent: 169.5, orderCount: 4, lastLoginAt: isoAgo(25 * 60000), createdAt: isoAgo(35 * 86400000)
    },
    {
      id: 'm-demo-003', tenantId, openid: 'mock_demo_003', unionid: '', nickname: '陈先生', avatar: '', phone: '18600006789',
      addresses: [{ id: 'addr-demo-003', name: '陈先生', phone: '18600006789', detail: '青禾社区 6 栋 502', isDefault: true }],
      totalSpent: 77.8, orderCount: 2, lastLoginAt: isoAgo(2 * 86400000), createdAt: isoAgo(12 * 86400000)
    },
    {
      id: 'm-demo-004', tenantId, openid: 'mock_demo_004', unionid: '', nickname: '王阿姨', avatar: '', phone: '15800007890',
      addresses: [{ id: 'addr-demo-004', name: '王阿姨', phone: '15800007890', detail: '青禾社区 2 栋 301', isDefault: true }],
      totalSpent: 116.7, orderCount: 3, lastLoginAt: isoAgo(3 * 86400000), createdAt: isoAgo(58 * 86400000)
    },
    {
      id: 'm-demo-005', tenantId, openid: 'mock_demo_005', unionid: '', nickname: '周小满', avatar: '', phone: '18000008901',
      addresses: [], totalSpent: 0, orderCount: 0, lastLoginAt: isoAgo(3 * 3600000), createdAt: isoAgo(3 * 3600000)
    }
  ];
  for (const member of members) await store.insert('members', member);

  const now = Date.now();
  await store.insert('groupBuys', {
    id: 'gb-apple-001', tenantId, productId: products[0].id,
    title: '周末苹果团 · 5斤装', groupPrice: 2490, minParticipants: 3, maxParticipants: 50,
    status: 'active', participants: [{ memberId: 'm-demo-002', role: 'leader', joinedAt: isoAgo(50 * 60000) }, { memberId: 'm-demo-004', role: 'member', joinedAt: isoAgo(18 * 60000) }],
    startAt: isoAgo(2 * 3600000), endAt: new Date(now + 4 * 3600000).toISOString(), createdAt: isoAgo(2 * 3600000)
  });
  await store.insert('groupBuys', {
    id: 'gb-milk-001', tenantId, productId: products[2].id,
    title: '早餐牛奶团 · 每日鲜奶', groupPrice: 1290, minParticipants: 2, maxParticipants: 30,
    status: 'success', participants: [{ memberId: 'm-demo-001', role: 'leader', joinedAt: isoAgo(26 * 3600000) }, { memberId: 'm-demo-003', role: 'member', joinedAt: isoAgo(22 * 3600000) }],
    startAt: isoAgo(30 * 3600000), endAt: new Date(now + 18 * 3600000).toISOString(), successAt: isoAgo(22 * 3600000), createdAt: isoAgo(30 * 3600000)
  });

  const coupon1 = await cm.createTemplate(tenantId, { name: '邻里新人立减 5 元', threshold: 30, amount: 5, validDays: 30, limitPerMember: 1 });
  const coupon2 = await cm.createTemplate(tenantId, { name: '满 99 减 10', threshold: 99, amount: 10, validDays: 15, limitPerMember: 2 });
  const browserCoupon1 = await cm.claim(coupon1.id, 'm-demo-001');
  await cm.claim(coupon2.id, 'm-demo-001');
  await store.update('coupons', browserCoupon1.id, { status: 'used', usedAt: isoAgo(25 * 60000), reservedByOrderId: null });

  const form = await fm.create(tenantId, {
    title: '本周社区团购满意度',
    description: '30 秒告诉我们，你最希望下周增加哪些好物。',
    fields: [
      { label: '这周的商品品质满意吗？', type: 'rating', required: true },
      { label: '最常购买哪类商品？', type: 'radio', options: ['新鲜水果', '蛋奶早餐', '粮油主食', '居家日用'], required: true },
      { label: '希望增加的品类', type: 'checkbox', options: ['海鲜', '烘焙', '零食', '母婴'], required: false },
      { label: '其他建议', type: 'textarea', required: false }
    ]
  });
  await store.insert('formSubmissions', {
    id: 'demo-form-submission-001', tenantId, formId: form.id, memberId: 'm-demo-001',
    answers: { f1: 5, f2: '蛋奶早餐', f3: ['烘焙', '零食'], f4: '希望周末能增加面包。' }, createdAt: isoAgo(42 * 60000)
  });

  const cleaning = await am.createService(tenantId, { name: '家政保洁预约', price: 89, durationMinutes: 120, capacityPerSlot: 2, slots: ['09:00', '10:00', '14:00', '15:00', '16:00'] });
  await am.createService(tenantId, { name: '理发预约', price: 45, durationMinutes: 45, capacityPerSlot: 1, slots: ['10:00', '11:00', '14:00', '15:00', '16:00', '17:00'] });
  await store.insert('appointments', {
    id: 'demo-appointment-001', tenantId, serviceId: cleaning.id, serviceName: cleaning.name, memberId: 'm-demo-001',
    date: cnDate(), slot: '15:00', note: '两小时日常保洁', status: 'booked', createdAt: isoAgo(90 * 60000)
  });

  const orders = [
    orderRecord({
      id: 'demo-order-001', orderNo: 'NT' + cnDate().replaceAll('-', '') + '260001', tenantId, member: members[0],
      items: [line(products[2], 2), line(products[1], 1)], status: 'paid', deliveryType: 'delivery',
      createdAt: isoAgo(32 * 60000), paidAt: isoAgo(30 * 60000), couponId: browserCoupon1.id, couponDiscount: 500
    }),
    orderRecord({
      id: 'demo-order-002', orderNo: 'NT' + cnDate().replaceAll('-', '') + '260002', tenantId, member: members[1],
      items: [line(products[0], 1)], status: 'paid', deliveryType: 'pickup', pickupCode: '315806',
      createdAt: isoAgo(82 * 60000), paidAt: isoAgo(80 * 60000)
    }),
    orderRecord({
      id: 'demo-order-003', orderNo: 'NT' + cnDate(new Date(now - 86400000)).replaceAll('-', '') + '260003', tenantId, member: members[2],
      items: [line(products[3], 1)], status: 'delivering', deliveryType: 'delivery',
      createdAt: isoAgo(26 * 3600000), paidAt: isoAgo(25 * 3600000)
    }),
    orderRecord({
      id: 'demo-order-004', orderNo: 'NT' + cnDate(new Date(now - 2 * 86400000)).replaceAll('-', '') + '260004', tenantId, member: members[0],
      items: [line(products[0], 1), line(products[5], 2)], status: 'completed', deliveryType: 'pickup', pickupCode: '608214',
      createdAt: isoAgo(2 * 86400000), paidAt: isoAgo(2 * 86400000 - 1800000)
    }),
    orderRecord({
      id: 'demo-order-005', orderNo: 'NT' + cnDate(new Date(now - 4 * 86400000)).replaceAll('-', '') + '260005', tenantId, member: members[3],
      items: [line(products[4], 1), line(products[2], 3)], status: 'completed', deliveryType: 'delivery',
      createdAt: isoAgo(4 * 86400000), paidAt: isoAgo(4 * 86400000 - 3600000)
    })
  ];
  for (const order of orders) await store.insert('orders', order);

  await store.insert('afterSalesRequests', {
    id: 'demo-after-sales-001',
    tenantId,
    orderId: 'demo-order-002',
    orderNo: orders[1].orderNo,
    memberId: 'm-demo-002',
    type: 'complaint',
    requestedAmount: 0,
    reason: '到货外包装有压痕',
    description: '商品本身完好，希望下次加强包装。',
    status: 'pending',
    resolution: '',
    createdAt: isoAgo(18 * 60000)
  });

  if (config.wechat.mock) {
    await store.insert('notificationTemplates', {
      id: tenantId + ':orderPaid',
      tenantId,
      event: 'orderPaid',
      templateId: 'demo-order-paid-template',
      page: 'pages/orders/orders',
      data: {
        character_string1: { value: '{orderNo}' },
        amount2: { value: '{amount}' },
        phrase3: { value: '{status}' }
      },
      enabled: true,
      createdAt: isoAgo(30 * 86400000)
    });
  }

  const points = [
    ['pts-demo-001', 'm-demo-001', 100, '新会员赠送积分'],
    ['pts-demo-002', 'm-demo-001', 30, '消费返积分'],
    ['pts-demo-003', 'm-demo-002', 80, '历史积分转入'],
    ['pts-demo-004', 'm-demo-003', 60, '消费返积分'],
    ['pts-demo-005', 'm-demo-004', 120, '会员活动奖励']
  ].map(([id, memberId, change, reason]) => ({ id, memberId, change, reason, refId: '', createdAt: isoAgo(60 * 60000) }));
  for (const entry of points) await store.insert('pointsLedger', entry);

  console.log('[Seed] ✅ 演示数据已创建：6个商品 / 2个团购 / 5个客户 / 5笔订单 / 2张优惠券 / 1个问卷 / 2个预约服务');
}

module.exports = { run, resetTenant, DEMO_COLLECTIONS };
