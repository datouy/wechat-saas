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

const schemas = {
  login: z.object({
    code: z.string().min(1, '缺少登录code').max(128)
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

  couponCreate: z.object({
    name: z.string().trim().min(1).max(30).default('满减券'),
    threshold: money.nonnegative().default(0),
    amount: positiveMoney,
    validDays: z.coerce.number().int().positive().default(30),
    limitPerMember: z.coerce.number().int().positive().default(1),
    enabled: z.boolean().optional().default(true)
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

  orderCreate: z.object({
    items: z.array(z.object({
      productId: id,
      quantity: z.coerce.number().int().positive()
    })).min(1, '订单商品不能为空').max(100),
    options: z.object({
      usePoints: z.coerce.number().int().nonnegative().optional().default(0),
      couponId: id.optional(),
      addressId: id.optional(),
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

  appointmentServiceCreate: z.object({
    name: z.string().trim().min(1).max(30),
    price: positiveMoney,
    durationMinutes: z.coerce.number().int().positive().default(60),
    capacityPerSlot: z.coerce.number().int().min(1).default(1),
    slots: z.array(z.string().max(8)).max(30).optional(),
    enabled: z.boolean().optional().default(true)
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
  })
};

/** 校验并返回清洗后的数据；失败抛 ZodError */
function validate(schemaName, data) {
  const schema = schemas[schemaName];
  if (!schema) throw new Error('未知校验 schema: ' + schemaName);
  return schema.parse(data == null ? {} : data);
}

module.exports = { validate, schemas };
