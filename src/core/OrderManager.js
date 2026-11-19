/**
 * 订单管理（核心交易模块）
 * 状态流转:
 *   pending 待支付 -> paid 已支付 -> delivering 配送中 -> completed 已完成
 *   pending -> cancelled 已取消（释放库存、释放优惠券、返还积分）
 *   paid/delivering/completed -> refunding -> refunded 已退款（回补库存、回退销量、返还积分）
 * 支付成功后：核销优惠券、累计消费、发放积分、累加商品销量
 */
const { randomUUID: uuidv4 } = require('crypto');

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
    if (!Array.isArray(items) || items.length === 0) throw new Error('订单商品不能为空');
    const member = this.members.get(memberId);
    if (!member || member.tenantId !== tenantId) throw new Error('会员不存在');

    // 1. 校验商品、库存与团购价资格
    const orderItems = [];
    let goodsAmount = 0;
    for (const it of items) {
      const p = this.products.get(it.productId);
      if (!p || p.tenantId !== tenantId) throw new Error('商品不存在: ' + it.productId);
      if (!p.onSale) throw new Error('商品已下架: ' + p.name);
      const qty = Math.floor(Number(it.quantity) || 0);
      if (qty <= 0) throw new Error('商品数量不合法: ' + p.name);
      if (p.stock < qty) throw new Error('库存不足: ' + p.name);

      let unitPrice = p.price;
      if (options.groupBuyId) {
        const gb = this.store.findById('groupBuys', options.groupBuyId);
        if (!gb || gb.tenantId !== tenantId || gb.productId !== p.id) throw new Error('团购活动无效');
        if (gb.status !== 'active' && gb.status !== 'success') throw new Error('团购活动不可用');
        if (new Date(gb.endAt).getTime() < Date.now()) throw new Error('团购活动已截止');
        if (!gb.participants.some(x => x.memberId === memberId)) throw new Error('您尚未参加该团购');
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
    const deliveryFee = Math.round(Number(this.config.deliveryFee) * 100) || 0;
    const payAmount = Math.max(0, goodsAmount - couponDiscount - pointsDiscount + deliveryFee);

    const now = new Date();
    const orderId = uuidv4();
    const orderNo = this._orderNo();

    // 5. 落库（扣库存 -> 扣积分 -> 预留优惠券 -> 插入订单），失败回滚
    try {
      for (const it of orderItems) {
        if (!this.products.deductStock(it.productId, it.quantity)) {
          throw new Error('库存不足: ' + it.name);
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
      address: options.addressId ? (member.addresses.find(a => a.id === options.addressId) || null) : null,
      deliveryType: options.deliveryType === 'pickup' ? 'pickup' : 'delivery',
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
    if (!order) throw new Error('订单不存在');
    if (order.memberId !== memberId) throw new Error('无权操作此订单');
    if (order.status === 'paid') {
      return { success: true, alreadyPaid: true, mock: this.wechat.config.mock, order };
    }
    if (order.status !== 'pending') throw new Error('订单状态不允许支付');
    if (new Date(order.expiresAt).getTime() < Date.now()) throw new Error('订单已超时，请重新下单');

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
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    order.payInfo = payInfo;

    if (order.couponId) this.coupons.use(order.couponId);
    this.members.recordSpending(order.memberId, order.payAmount / 100);
    this.points.earnByOrder(order.memberId, order.orderNo, order.payAmount / 100);
    for (const it of order.items) this.products.increaseSales(it.productId, it.quantity);

    this.store.markDirty('orders');
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
      throw new Error('支付金额与订单不符');
    }
    return this._onPaid(order, { transactionId, paidAt: new Date().toISOString() });
  }

  /** 申请退款（mock 即时退款；真实模式调用微信退款后等待退款回调确认） */
  async refund(orderId, reason) {
    const order = this.store.findById('orders', orderId);
    if (!order) throw new Error('订单不存在');
    if (!['paid', 'delivering', 'completed'].includes(order.status)) throw new Error('当前订单状态不支持退款');
    if (order.refund && order.refund.status === 'refunded') throw new Error('订单已退款');

    const outRefundNo = 'RF' + order.orderNo.slice(2) + Math.floor(Math.random() * 900 + 100);
    order.refund = {
      outRefundNo,
      reason: String(reason || '用户申请退款').slice(0, 80),
      status: 'refunding',
      createdAt: new Date().toISOString()
    };
    this.store.markDirty('orders');

    if (this.wechat.config.mock) {
      this._finalizeRefund(order, outRefundNo);
      return { success: true, mock: true, order };
    }
    await this.wechat.refund({
      outTradeNo: order.orderNo,
      outRefundNo,
      total: order.payAmount,
      refund: order.payAmount,
      reason: order.refund.reason
    });
    return { success: true, mock: false, refundNo: outRefundNo, order };
  }

  /** 退款成功回调（真实模式，已验签+解密后调用） */
  handleRefundNotifyVerified(resource) {
    const order = this.store.find('orders', o => o.orderNo === resource.out_trade_no)[0];
    if (!order) return false;
    if (resource.refund_status === 'SUCCESS' && order.refund && order.refund.outRefundNo === resource.out_refund_no) {
      this._finalizeRefund(order, resource.out_refund_no);
      return true;
    }
    return false;
  }

  /** 退款完成：回补库存、回退销量、返还积分 */
  _finalizeRefund(order, refundNo) {
    if (order.status === 'refunded') return;
    for (const it of order.items) {
      this.products.restoreStock(it.productId, it.quantity);
      this.products.decreaseSales(it.productId, it.quantity);
    }
    if (order.pointsUsed > 0) {
      this.points.change(order.memberId, order.pointsUsed, '退款返还积分', order.orderNo);
    }
    order.status = 'refunded';
    order.refundedAt = new Date().toISOString();
    if (order.refund) order.refund.status = 'refunded';
    this.store.markDirty('orders');
  }

  /** 取消订单（仅待支付；已支付请走退款流程） */
  cancel(orderId, memberId, reason) {
    const order = this.store.findById('orders', orderId);
    if (!order) throw new Error('订单不存在');
    if (memberId && order.memberId !== memberId) throw new Error('无权操作此订单');
    if (order.status !== 'pending') throw new Error('仅待支付订单可取消，已支付订单请走退款流程');

    for (const it of order.items) {
      this.products.restoreStock(it.productId, it.quantity);
    }
    if (order.pointsUsed > 0) {
      this.points.change(order.memberId, order.pointsUsed, '取消订单返还积分', order.orderNo);
    }
    if (order.couponId) {
      this.coupons.release(order.couponId, order.id);
    }

    order.status = 'cancelled';
    order.cancelledAt = new Date().toISOString();
    order.cancelReason = reason || '用户取消';
    this.store.markDirty('orders');
    return order;
  }

  /** 商家发货/完成配送 */
  deliver(orderId) {
    const order = this.store.findById('orders', orderId);
    if (!order) throw new Error('订单不存在');
    if (order.status !== 'paid') throw new Error('仅已支付订单可发货');
    order.status = 'delivering';
    order.deliveredAt = new Date().toISOString();
    this.store.markDirty('orders');
    return order;
  }

  /** 确认收货 */
  complete(orderId, memberId) {
    const order = this.store.findById('orders', orderId);
    if (!order) throw new Error('订单不存在');
    if (memberId && order.memberId !== memberId) throw new Error('无权操作此订单');
    if (order.status !== 'delivering') throw new Error('仅配送中订单可确认收货');
    order.status = 'completed';
    order.completedAt = new Date().toISOString();
    this.store.markDirty('orders');
    return order;
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
    let changed = false;
    for (const order of this.store.collection('orders')) {
      if (order.status === 'pending' && new Date(order.expiresAt).getTime() < now) {
        try {
          this.cancel(order.id, null, '超时未支付自动取消');
          changed = true;
        } catch (e) {}
      }
      if (order.status === 'delivering' && order.deliveredAt) {
        const autoDays = this.config.autoCompleteDays || 3;
        if (now - new Date(order.deliveredAt).getTime() > autoDays * 86400000) {
          order.status = 'completed';
          order.completedAt = new Date().toISOString();
          changed = true;
        }
      }
    }
    if (changed) this.store.markDirty('orders');
  }

  shutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = OrderManager;

