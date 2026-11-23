/**
 * 入口参数校验（Zod）
 * - 统一在 API 层做类型/范围/必填校验，业务层不再信任未清洗的输入
 * - 校验失败抛 ZodError，由统一错误处理映射为 400 + 字段明细
 */
const { z } = require('zod');

const id = z.string().min(1).max(64);
const money = z.coerce.number().finite();
const positiveMoney = money.positive('金额必须大于0');
const nonNegativeInt = z.coerce.number().int().nonnegative();
const assetUrl = z.string().trim().max(2048).refine(
  value => !value || value.startsWith('/uploads/') || /^https:\/\/[^\s]+$/i.test(value),
  '素材地址仅支持站内 /uploads/ 路径或 HTTPS 地址'
);

const schemas = {
  login: z.object({
    code: z.string().min(1, '缺少登录code').max(128)
  }),

  subscriptionAuthorize: z.object({
    decisions: z.record(z.string().max(128), z.enum(['accept', 'reject', 'ban', 'filter'])).default({})
  }),

  tenantSignup: z.object({
    name: z.string().trim().min(2, '门店名称至少 2 个字').max(80),
    slug: z.string().trim().regex(/^[a-z0-9-]{3,48}$/, '租户标识需为 3-48 位小写字母、数字或连字符').optional(),
    username: z.string().trim().regex(/^[a-zA-Z0-9_.-]{3,32}$/, '所有者账号需为 3-32 位字母、数字或 _.-'),
    password: z.string().min(10, '密码至少 10 位').max(128),
    phone: z.string().trim().max(30).optional().default(''),
    planCode: z.enum(['starter', 'growth', 'enterprise']).optional().default('starter')
  }),

  platformLogin: z.object({
    username: z.string().trim().min(1).max(32),
    password: z.string().min(1).max(128)
  }),

  platformTenantCreate: z.object({
    name: z.string().trim().min(2).max(80),
    slug: z.string().trim().regex(/^[a-z0-9-]{3,48}$/).optional(),
    ownerUsername: z.string().trim().regex(/^[a-zA-Z0-9_.-]{3,32}$/),
    ownerPassword: z.string().min(10).max(128),
    contactPhone: z.string().trim().max(30).optional().default(''),
    planCode: z.enum(['starter', 'growth', 'enterprise']).optional().default('starter'),
    trial: z.boolean().optional().default(true)
  }),

  platformTenantUpdate: z.object({
    name: z.string().trim().min(2).max(80).optional(),
    status: z.enum(['active', 'trialing', 'suspended', 'closed']).optional()
  }).refine(value => Object.keys(value).length > 0, '至少提供一项租户修改'),

  platformPlanChange: z.object({
    planCode: z.enum(['starter', 'growth', 'enterprise'])
  }),

  platformInvoiceStatus: z.object({
    status: z.enum(['issued', 'paid', 'void']),
    note: z.string().trim().max(200).optional().default('')
  }),

  assetUpload: z.object({
    filename: z.string().trim().max(120).optional().default('brand'),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon']),
    data: z.string().min(1).max(4 * 1024 * 1024),
    kind: z.enum(['logo', 'brand', 'banner', 'favicon']).optional().default('brand')
  }),

  productCreate: z.object({
    name: z.string().trim().min(1, '商品名称不能为空').max(50),
    price: positiveMoney,
    originalPrice: money.nonnegative().optional(),
    stock: nonNegativeInt.default(0),
    categoryId: id.optional().default(''),
    unit: z.string().max(10).optional().default('份'),
    description: z.string().max(500).optional().default(''),
    image: z.string().max(2048).optional().default(''),
    onSale: z.boolean().optional().default(true)
  }),

  productUpdate: z.object({
    name: z.string().trim().min(1).max(50).optional(),
    price: positiveMoney.optional(),
    originalPrice: money.nonnegative().optional(),
    stock: nonNegativeInt.optional(),
    categoryId: id.optional(),
    unit: z.string().max(10).optional(),
    description: z.string().max(500).optional(),
    image: z.string().max(2048).optional(),
    onSale: z.boolean().optional(),
    sort: z.coerce.number().int().optional()
  }),

  categoryCreate: z.object({
    name: z.string().trim().min(1, '分类名称不能为空').max(20),
    sort: z.coerce.number().int().optional().default(0)
  }),

  categoryUpdate: z.object({
    name: z.string().trim().min(1).max(20).optional(),
    sort: z.coerce.number().int().optional()
  }),

  couponCreate: z.object({
    name: z.string().trim().min(1).max(30).default('满减券'),
    threshold: money.nonnegative().default(0),
    amount: positiveMoney,
    validDays: z.coerce.number().int().positive().default(30),
    limitPerMember: z.coerce.number().int().positive().default(1),
    enabled: z.boolean().optional().default(true)
  }),

  couponUpdate: z.object({
    name: z.string().trim().min(1).max(30).optional(),
    threshold: money.nonnegative().optional(),
    amount: positiveMoney.optional(),
    validDays: z.coerce.number().int().positive().optional(),
    limitPerMember: z.coerce.number().int().positive().optional(),
    enabled: z.boolean().optional()
  }),

  groupBuyCreate: z.object({
    productId: id,
    groupPrice: positiveMoney,
    title: z.string().max(50).optional(),
    minParticipants: z.coerce.number().int().min(2).optional(),
    maxParticipants: z.coerce.number().int().positive().optional(),
    endAt: z.string().datetime({ offset: true }).optional().or(z.string().max(64).optional()),
    durationHours: z.coerce.number().positive().optional()
  }),

  groupBuyUpdate: z.object({
    title: z.string().trim().min(1).max(50).optional(),
    endAt: z.string().min(10).max(64).optional(),
    extendHours: z.coerce.number().positive().max(720).optional(),
    maxParticipants: z.coerce.number().int().min(2).optional()
  }).refine(value => Object.keys(value).length > 0, '至少提供一项团购修改'),

  orderCreate: z.object({
    items: z.array(z.object({
      productId: id,
      quantity: z.coerce.number().int().positive()
    })).min(1, '订单商品不能为空').max(100),
    options: z.object({
      usePoints: z.coerce.number().int().nonnegative().optional().default(0),
      couponId: id.optional(),
      addressId: id.optional(),
      pickupLocationId: id.optional(),
      groupBuyId: id.optional(),
      deliveryType: z.enum(['delivery', 'pickup']).optional().default('delivery'),
      remark: z.string().max(100).optional()
    }).optional().default({})
  }),

  orderDeliver: z.object({
    company: z.string().trim().max(50).optional().default(''),
    trackingNo: z.string().trim().max(64).optional().default('')
  }),

  orderBatchDeliver: z.object({
    orderIds: z.array(id).min(1, '请选择订单').max(100),
    company: z.string().trim().max(50).optional().default(''),
    trackingNo: z.string().trim().max(64).optional().default('')
  }),

  orderPickupVerify: z.object({
    pickupCode: z.string().trim().regex(/^\d{6}$/, '取货码应为6位数字')
  }),

  orderRefund: z.object({
    amount: money.positive('退款金额必须大于0').optional(),
    reason: z.string().trim().max(80).optional().default('商家退款')
  }),

  afterSalesCreate: z.object({
    type: z.enum(['refund', 'return', 'complaint']).default('refund'),
    amount: positiveMoney.optional(),
    reason: z.string().trim().min(1, '请填写售后原因').max(120),
    description: z.string().max(500).optional().default('')
  }),

  afterSalesResolve: z.object({
    status: z.enum(['approved', 'rejected', 'resolved']),
    resolution: z.string().trim().max(500).optional().default('')
  }),

  inventoryAdjust: z.object({
    delta: z.coerce.number().int().refine(value => value !== 0, '调整数量不能为 0'),
    reason: z.string().trim().min(1, '请填写调整原因').max(100)
  }),

  appointmentServiceCreate: z.object({
    name: z.string().trim().min(1).max(30),
    price: positiveMoney,
    durationMinutes: z.coerce.number().int().positive().default(60),
    capacityPerSlot: z.coerce.number().int().min(1).default(1),
    slots: z.array(z.string().max(8)).max(30).optional(),
    enabled: z.boolean().optional().default(true)
  }),

  appointmentServiceUpdate: z.object({
    name: z.string().trim().min(1).max(30).optional(),
    price: positiveMoney.optional(),
    durationMinutes: z.coerce.number().int().positive().optional(),
    capacityPerSlot: z.coerce.number().int().min(1).optional(),
    slots: z.array(z.string().max(8)).max(30).optional(),
    enabled: z.boolean().optional()
  }),

  appointmentBook: z.object({
    serviceId: id,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需为 YYYY-MM-DD'),
    slot: z.string().min(1).max(8),
    note: z.string().max(100).optional()
  }),

  formCreate: z.object({
    title: z.string().trim().min(1).max(50),
    description: z.string().max(300).optional().default(''),
    fields: z.array(z.object({
      label: z.string().trim().min(1).max(50),
      type: z.enum(['text', 'textarea', 'radio', 'checkbox', 'rating', 'number']),
      options: z.array(z.string().max(50)).max(20).optional().default([]),
      required: z.boolean().optional().default(false)
    })).min(1).max(50),
    status: z.enum(['open', 'closed']).optional().default('open')
  }),

  formUpdate: z.object({
    title: z.string().trim().min(1).max(50).optional(),
    description: z.string().max(300).optional(),
    fields: z.array(z.object({
      label: z.string().trim().min(1).max(50),
      type: z.enum(['text', 'textarea', 'radio', 'checkbox', 'rating', 'number']),
      options: z.array(z.string().max(50)).max(20).optional().default([]),
      required: z.boolean().optional().default(false)
    })).min(1).max(50).optional(),
    status: z.enum(['open', 'closed']).optional()
  }),

  formSubmit: z.object({
    answers: z.record(z.string(), z.any()).optional().default({})
  }),

  memberUpdate: z.object({
    nickname: z.string().max(50).optional(),
    avatar: z.string().max(2048).optional(),
    phone: z.string().max(20).optional()
  }),

  addressCreate: z.object({
    name: z.string().trim().min(1).max(20),
    phone: z.string().trim().min(1).max(20),
    detail: z.string().trim().min(1).max(200),
    isDefault: z.boolean().optional()
  }),

  addressUpdate: z.object({
    name: z.string().trim().min(1).max(20).optional(),
    phone: z.string().trim().min(1).max(20).optional(),
    detail: z.string().trim().min(1).max(200).optional(),
    isDefault: z.boolean().optional()
  }).refine(value => Object.keys(value).length > 0, '至少提供一项地址修改'),

  storeProfileUpdate: z.object({
    name: z.string().trim().min(1, '门店名称不能为空').max(40).optional(),
    tagline: z.string().max(80).optional(),
    description: z.string().max(300).optional(),
    announcement: z.string().max(160).optional(),
    contactPhone: z.string().max(30).optional(),
    pickupAddress: z.string().max(120).optional(),
    deliveryNotice: z.string().max(160).optional(),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, '品牌色需为 #RRGGBB').optional(),
    miniProgramTitle: z.string().max(60).optional(),
    miniProgramAppId: z.string().max(64).optional(),
    customerServicePhone: z.string().max(30).optional(),
    logoUrl: assetUrl.optional(),
    brandImageUrl: assetUrl.optional()
  }),

  adminCreate: z.object({
    username: z.string().trim().regex(/^[a-zA-Z0-9_.-]{3,32}$/, '用户名需为 3-32 位字母、数字或 _.-'),
    password: z.string().min(10, '密码至少 10 位').max(128),
    role: z.enum(['manager', 'fulfillment']).default('manager')
  }),

  adminUpdate: z.object({
    role: z.enum(['manager', 'fulfillment']).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    password: z.string().min(10, '密码至少 10 位').max(128).optional()
  }),

  pointsAdjust: z.object({
    amount: z.coerce.number().int().refine(v => v !== 0, '积分变更不能为 0'),
    reason: z.string().trim().min(1, '请填写调整原因').max(80)
  }),

  notificationTemplateUpdate: z.object({
    templateId: z.string().trim().max(128).optional().default(''),
    page: z.string().trim().max(200).optional().default(''),
    data: z.record(z.string(), z.any()).optional().default({}),
    enabled: z.boolean().optional().default(true)
  }),

  locationCreate: z.object({
    name: z.string().trim().min(1).max(40),
    code: z.string().trim().max(20).optional().default(''),
    address: z.string().trim().min(1).max(160),
    phone: z.string().max(30).optional().default(''),
    hours: z.string().max(80).optional().default('每日 09:00-20:00'),
    pickupEnabled: z.boolean().optional().default(true),
    deliveryEnabled: z.boolean().optional().default(true),
    isPrimary: z.boolean().optional().default(false),
    status: z.enum(['active', 'disabled']).optional().default('active'),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#b84a35')
  }),

  locationUpdate: z.object({
    name: z.string().trim().min(1).max(40).optional(),
    code: z.string().trim().max(20).optional(),
    address: z.string().trim().min(1).max(160).optional(),
    phone: z.string().max(30).optional(),
    hours: z.string().max(80).optional(),
    pickupEnabled: z.boolean().optional(),
    deliveryEnabled: z.boolean().optional(),
    isPrimary: z.boolean().optional(),
    status: z.enum(['active', 'disabled']).optional(),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
  }).refine(value => Object.keys(value).length > 0, '至少提供一项门店修改')
};

/** 校验并返回清洗后的数据；失败抛 ZodError */
function validate(schemaName, data) {
  const schema = schemas[schemaName];
  if (!schema) throw new Error('未知校验 schema: ' + schemaName);
  return schema.parse(data == null ? {} : data);
}

module.exports = { validate, schemas };
