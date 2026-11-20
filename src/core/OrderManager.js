/**
 * 订单管理（核心交易模块）
 * 状态流转:
 *   pending 待支付 -> paid 已支付 -> delivering 配送中 -> completed 已完成
 *   pending -> cancelled 已取消（释放库存、释放优惠券、返还积分）
 *   paid/delivering/completed -> refunding -> refunded 已退款（回补库存、回退销量、返还积分）
 * 支付成功后：核销优惠券、累计消费、发放积分、累加商品销量
 */

const { business } = require('../errors');
const { randomUUID: uuidv4, randomInt } = require('crypto');

class OrderManager {
  constructor(store, deps) {
    this.store = store;
    this.products = deps.productManager;
    this.points = deps.pointsManager;
    this.coupons = deps.couponManager;
    this.members = deps.memberManager;
    this.wechat = deps.wechatService;
    this.groupBuys = deps.groupBuyManager || null;
    this.config = deps.config || { payTimeoutMinutes: 30, autoCompleteDays: 3, deliveryFee: 0 };
    this.timer = null;
  }

  initialize() {
    if (this.config.housekeepingEnabled === false) return;
    this.timer = setInterval(() => this._housekeeping(), 60000);
  }

  /** 生成订单号: NT + 日期 + 6位随机 */
  _orderNo() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    const rand = Math.floor(Math.random() * 900000 + 100000);
    return 'NT' + dateStr + rand;
  }

  /**
   * 创建订单
   * items: [{productId, quantity}]
   * options: { usePoints, couponId, addressId, remark, groupBuyId, deliveryType }
   */
  create(tenantId, memberId, items, options = {}) {
    if (!Array.isArray(items) || items.length === 0) throw business('订单商品不能为空');
    const member = this.members.get(memberId);
    if (!member || member.tenantId !== tenantId) throw business('会员不存在');
    const deliveryType = options.deliveryType === 'pickup' ? 'pickup' : 'delivery';
    let deliveryAddress = null;
    if (deliveryType === 'delivery') {
      if (options.deliveryType === 'delivery' && !options.addressId) throw business('请选择收货地址');
      if (options.addressId) {
        deliveryAddress = (member.addresses || []).find(a => a.id === options.addressId) || null;
        if (!deliveryAddress) throw business('收货地址无效');
      }
    }

    // 1. 校验商品、库存与团购价资格
    const orderItems = [];
    let goodsAmount = 0;
    for (const it of items) {
      const p = this.products.get(it.productId);
      if (!p || p.tenantId !== tenantId) throw business('商品不存在: ' + it.productId);
      if (!p.onSale) throw business('商品已下架: ' + p.name);
      const qty = Math.floor(Number(it.quantity) || 0);
      if (qty <= 0) throw business('商品数量不合法: ' + p.name);
      if (p.stock < qty) throw business('库存不足: ' + p.name);

      let unitPrice = p.price;
      if (options.groupBuyId) {
        const gb = this.store.findById('groupBuys', options.groupBuyId);
        if (!gb || gb.tenantId !== tenantId || gb.productId !== p.id) throw business('团购活动无效');
        // 团购下单要求已成团，避免未成团即支付、成团失败后无法退款的资金风险
        if (gb.status !== 'success') throw business('团购尚未成团，暂不可下单');
        if (new Date(gb.endAt).getTime() < Date.now()) throw business('团购活动已截止');
        if (!gb.participants.some(x => x.memberId === memberId)) throw business('您尚未参加该团购');
        unitPrice = gb.groupPrice;
      }

      orderItems.push({
        productId: p.id,
        name: p.name,
        image: p.image,
        unit: p.unit,
        unitPrice,
        quantity: qty,
        subtotal: unitPrice * qty
      });
      goodsAmount += unitPrice * qty;
    }

    // 2. 优惠券校验（仅校验，稍后预留）
    let couponDiscount = 0;
    let coupon = null;
    if (options.couponId) {
      coupon = this.coupons.validate(options.couponId, memberId, goodsAmount);
      couponDiscount = Math.min(coupon.amount, goodsAmount);
    }

    // 3. 积分抵扣
    let pointsUsed = 0;
    let pointsDiscount = 0;
    if (options.usePoints && this.points.config.enabled) {
      const calc = this.points.calcDiscount(memberId, (goodsAmount - couponDiscount) / 100, options.usePoints);
      pointsUsed = calc.pointsUsed;
      pointsDiscount = Math.round(calc.discount * 100);
    }

    // 4. 配送费与实付
    const deliveryFee = deliveryType === 'pickup' ? 0 : (Math.round(Number(this.config.deliveryFee) * 100) || 0);
    const payAmount = Math.max(0, goodsAmount - couponDiscount - pointsDiscount + deliveryFee);

    const now = new Date();
    const orderId = uuidv4();
    const orderNo = this._orderNo();

    // 5. 落库（扣库存 -> 扣积分 -> 预留优惠券 -> 插入订单），失败回滚
    try {
      for (const it of orderItems) {
        if (!this.products.deductStock(it.productId, it.quantity)) {
          throw business('库存不足: ' + it.name);
        }
      }
      if (pointsUsed > 0) {
        this.points.change(memberId, -pointsUsed, '订单积分抵扣', orderNo);
      }
      if (coupon) {
        this.coupons.reserve(coupon.id, orderId);
      }
    } catch (e) {
      for (const it of orderItems) this.products.restoreStock(it.productId, it.quantity);
      if (pointsUsed > 0) this.points.change(memberId, pointsUsed, '订单抵扣回滚', orderNo);
      if (coupon) this.coupons.release(coupon.id, orderId);
      throw e;
    }

    const order = {
      id: orderId,
      orderNo,
      tenantId,
      memberId,
      items: orderItems,
      goodsAmount,
      couponId: coupon ? coupon.id : null,
      couponDiscount,
      pointsUsed,
      pointsDiscount,
      deliveryFee,
      payAmount,
      status: 'pending',
      address: deliveryAddress,
      deliveryType,
      pickupCode: deliveryType === 'pickup' ? String(randomInt(100000, 1000000)) : null,
      pickupVerifiedAt: null,
      remark: String(options.remark || '').slice(0, 100),
      groupBuyId: options.groupBuyId || null,
      payInfo: null,
      expiresAt: new Date(now.getTime() + this.config.payTimeoutMinutes * 60000).toISOString(),
      createdAt: now.toISOString(),
      paidAt: null,
      completedAt: null,
      cancelledAt: null
    };
    this.store.insert('orders', order);
    return order;
  }

  /** 支付订单：mock模式直接标记已支付；真实模式返回 wx.requestPayment 参数（openid 从会员记录推导） */
  async pay(orderId, memberId) {
    const order = this.store.findById('orders', orderId);
    if (!order) throw business('订单不存在');
    if (order.memberId !== memberId) throw business('无权操作此订单');
    if (order.status === 'paid') {
      return { success: true, alreadyPaid: true, mock: this.wechat.config.mock, order };
    }
    if (order.status !== 'pending') throw business('订单状态不允许支付');
    if (new Date(order.expiresAt).getTime() < Date.now()) throw business('订单已超时，请重新下单');

    if (this.wechat.config.mock) {
      const payResult = {
        mock: true,
        transactionId: 'MOCK' + Date.now(),
        paidAt: new Date().toISOString()
      };
      this._onPaid(order, payResult);
      return { success: true, mock: true, order };
    }

    const member = this.members.get(memberId);
    const payResult = await this.wechat.createJsapiOrder({
      orderNo: order.orderNo,
      amount: order.payAmount,
      description: '邻里团订单-' + order.orderNo,
      openid: member ? member.openid : ''
    });
    return { success: true, mock: false, payParams: payResult, order };
  }

  /** 支付成功回调（mock 或微信支付异步通知），幂等 */
  _onPaid(order, payInfo) {
    if (order.status !== 'pending') return false;
    this.store.update('orders', order.id, { status: 'paid', paidAt: new Date().toISOString(), payInfo });

    if (order.couponId) this.coupons.use(order.couponId);
    this.members.recordSpending(order.memberId, order.payAmount / 100);
    this.points.earnByOrder(order.memberId, order.orderNo, order.payAmount / 100);
    for (const it of order.items) this.products.increaseSales(it.productId, it.quantity);

    return true;
  }

  /** 微信支付回调处理（真实模式） */
  handlePayNotify(orderNo, transactionId) {
    const order = this.store.find('orders', o => o.orderNo === orderNo)[0];
    if (!order) return false;
    if (order.status === 'paid') return true;
    if (order.status === 'pending') {
      return this._onPaid(order, { transactionId, paidAt: new Date().toISOString() });
    }
    return false;
  }

  /** 微信支付回调（真实模式，已完成验签+解密+金额校验后调用） */
  handlePayNotifyVerified(outTradeNo, transactionId, totalAmount) {
    const order = this.store.find('orders', o => o.orderNo === outTradeNo)[0];
    if (!order) return false;
    if (order.status === 'paid' || order.status === 'delivering' || order.status === 'completed') return true;
    if (order.status !== 'pending') return false;
    if (totalAmount !== undefined && Math.round(Number(totalAmount)) !== order.payAmount) {
      throw business('支付金额与订单不符');
    }
    return this._onPaid(order, { transactionId, paidAt: new Date().toISOString() });
  }

  /** 申请退款（mock 即时退款；真实模式调用微信退款后等待退款回调确认）
   *  refundAmount 为退款金额（分）；缺省为剩余可退金额（全额）。支持部分退款，累计退款不超过实付。 */
  async refund(orderId, reason, refundAmount) {
    const order = this.store.findById('orders', orderId);
    if (!order) throw business('订单不存在');
    if (!['paid', 'delivering', 'completed'].includes(order.status)) throw business('当前订单状态不支持退款');

    const alreadyRefunded = Math.round(Number(order.refundedAmount) || 0);
    const refundable = order.payAmount - alreadyRefunded;
    if (refundable <= 0) throw business('订单已全额退款');

    const target = refundAmount === undefined || refundAmount === null
      ? refundable
      : Math.round(Number(refundAmount) || 0);
    if (!(target > 0)) throw business('退款金额必须大于0');
    if (target > refundable) throw business('退款金额超过可退金额');

    const outRefundNo = 'RF' + order.orderNo.slice(2) + Math.floor(Math.random() * 900 + 100);
    const refundInfo = {
      outRefundNo,
      amount: target,
      reason: String(reason || '用户申请退款').slice(0, 80),
      status: 'refunding',
      createdAt: new Date().toISOString()
    };
    this.store.update('orders', order.id, { refund: refundInfo });
    order.refund = refundInfo;

    if (this.wechat.config.mock) {
      this._finalizeRefund(order, outRefundNo, target);
      return { success: true, mock: true, order };
    }
    await this.wechat.refund({
      outTradeNo: order.orderNo,
      outRefundNo,
      total: order.payAmount,
      refund: target,
      reason: order.refund.reason
    });
    return { success: true, mock: false, refundNo: outRefundNo, order };
  }

  /** 退款成功回调（真实模式，已验签+解密后调用） */
  handleRefundNotifyVerified(resource) {
    const order = this.store.find('orders', o => o.orderNo === resource.out_trade_no)[0];
    if (!order) return false;
    if (resource.refund_status === 'SUCCESS' && order.refund && order.refund.outRefundNo === resource.out_refund_no) {
      const amount = (resource.amount && resource.amount.refund) || (order.refund && order.refund.amount) || order.payAmount;
      this._finalizeRefund(order, resource.out_refund_no, amount);
      return true;
    }
    return false;
  }

  /** 退款完成：累计退款金额；全额退款时回补库存、回退销量、返还积分并结单 */
  _finalizeRefund(order, refundNo, refundAmount) {
    const amount = Math.round(Number(refundAmount) || 0);
    const newRefunded = Math.round(Number(order.refundedAmount) || 0) + amount;
    const isFull = newRefunded >= order.payAmount;

    const patch = { refundedAmount: newRefunded };
    if (order.refund) patch.refund = { ...order.refund, status: 'refunded' };

    if (isFull) {
      for (const it of order.items) {
        this.products.restoreStock(it.productId, it.quantity);
        this.products.decreaseSales(it.productId, it.quantity);
      }
      if (order.pointsUsed > 0) {
        this.points.change(order.memberId, order.pointsUsed, '退款返还积分', order.orderNo);
      }
      patch.status = 'refunded';
      patch.refundedAt = new Date().toISOString();
    }
    this.store.update('orders', order.id, patch);
  }

  /** 取消订单（仅待支付；已支付请走退款流程） */
  cancel(orderId, memberId, reason) {
    const order = this.store.findById('orders', orderId);
    if (!order) throw business('订单不存在');
    if (memberId && order.memberId !== memberId) throw business('无权操作此订单');
    if (order.status !== 'pending') throw business('仅待支付订单可取消，已支付订单请走退款流程');

    for (const it of order.items) {
      this.products.restoreStock(it.productId, it.quantity);
    }
    if (order.pointsUsed > 0) {
      this.points.change(order.memberId, order.pointsUsed, '取消订单返还积分', order.orderNo);
    }
    if (order.couponId) {
      this.coupons.release(order.couponId, order.id);
    }

    return this.store.update('orders', order.id, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelReason: reason || '用户取消' });
  }

  /** 商家发货/完成配送；可附带物流信息（公司 + 单号） */
  deliver(orderId, logistics) {
    const order = this.store.findById('orders', orderId);
    if (!order) throw business('订单不存在');
    if (order.status !== 'paid') throw business('仅已支付订单可发货');
    const patch = { status: 'delivering', deliveredAt: new Date().toISOString() };
    if (logistics && (logistics.company || logistics.trackingNo)) {
      patch.logistics = {
        company: String(logistics.company || '').slice(0, 50),
        trackingNo: String(logistics.trackingNo || '').slice(0, 64)
      };
    }
    return this.store.update('orders', order.id, patch);
  }

  /** 确认收货 */
  complete(orderId, memberId) {
    const order = this.store.findById('orders', orderId);
    if (!order) throw business('订单不存在');
    if (memberId && order.memberId !== memberId) throw business('无权操作此订单');
    if (order.status !== 'delivering') throw business('仅配送中订单可确认收货');
    return this.store.update('orders', order.id, { status: 'completed', completedAt: new Date().toISOString() });
  }

  get(orderId) {
    return this.store.findById('orders', orderId);
  }

  listByMember(memberId, status) {
    let list = this.store.find('orders', o => o.memberId === memberId);
    if (status) list = list.filter(o => o.status === status);
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  listByTenant(tenantId, opts = {}) {
    let list = this.store.find('orders', o => o.tenantId === tenantId);
    if (opts.status) list = list.filter(o => o.status === opts.status);
    if (opts.keyword) {
      const k = opts.keyword.toLowerCase();
      list = list.filter(o => o.orderNo.toLowerCase().includes(k));
    }
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /** 定时清理：超时未支付自动取消；配送中超时自动完成 */
  _housekeeping() {
    const now = Date.now();
    for (const order of this.store.find('orders', () => true)) {
      if (order.status === 'pending' && new Date(order.expiresAt).getTime() < now) {
        try { this.cancel(order.id, null, '超时未支付自动取消'); } catch (e) {}
      }
      if (order.status === 'delivering' && order.deliveredAt) {
        const autoDays = this.config.autoCompleteDays || 3;
        if (now - new Date(order.deliveredAt).getTime() > autoDays * 86400000) {
          this.store.update('orders', order.id, { status: 'completed', completedAt: new Date().toISOString() });
        }
      }
    }
  }

  shutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = OrderManager;

