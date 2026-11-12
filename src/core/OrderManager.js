/**
 * 订单管理（核心交易模块）
 * 状态流转:
 *   pending 待支付 -> paid 已支付 -> delivering 配送中 -> completed 已完成
 *   任意 -> cancelled 已取消（库存回滚、优惠券/积分返还）
 * - 下单校验库存、计算优惠（优惠券+积分）
 * - 支付（本地mock / 微信支付JSAPI对接点）
 * - 超时未支付自动取消
 */
const { v4: uuidv4 } = require('uuid');

class OrderManager {
  constructor(store, deps) {
    // deps: { productManager, pointsManager, couponManager, memberManager, wechatService, config }
    this.store = store;
    this.products = deps.productManager;
    this.points = deps.pointsManager;
    this.coupons = deps.couponManager;
    this.members = deps.memberManager;
    this.wechat = deps.wechatService;
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

    // 1. 校验商品与库存
    const orderItems = [];
    let goodsAmount = 0;
    for (const it of items) {
      const p = this.products.get(it.productId);
      if (!p || p.tenantId !== tenantId) throw new Error('商品不存在: ' + it.productId);
      if (!p.onSale) throw new Error('商品已下架: ' + p.name);
      const qty = Math.floor(Number(it.quantity) || 0);
      if (qty <= 0) throw new Error('商品数量不合法: ' + p.name);
      if (p.stock < qty) throw new Error('库存不足: ' + p.name);

      // 团购价
      let unitPrice = p.price;
      if (options.groupBuyId) {
        const gb = this.store.findById('groupBuys', options.groupBuyId);
        if (gb && gb.productId === p.id && gb.status !== 'cancelled') {
          unitPrice = gb.groupPrice;
        }
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

    // 2. 优惠券
    let couponDiscount = 0;
    let coupon = null;
    if (options.couponId) {
      coupon = this.coupons.validate(options.couponId, memberId, goodsAmount / 100);
      couponDiscount = Math.min(coupon.amount * 100, goodsAmount);
    }

    // 3. 积分抵扣
    let pointsUsed = 0;
    let pointsDiscount = 0;
    if (options.usePoints && this.points.config.enabled) {
      const calc = this.points.calcDiscount(memberId, (goodsAmount - couponDiscount) / 100, options.usePoints);
      pointsUsed = calc.pointsUsed;
      pointsDiscount = Math.round(calc.discount * 100);
    }

    // 4. 配送费
    const deliveryFee = Math.round(Number(this.config.deliveryFee) * 100) || 0;
    const payAmount = Math.max(0, goodsAmount - couponDiscount - pointsDiscount + deliveryFee);

    // 5. 扣库存（失败则回滚已扣的）
    const deducted = [];
    for (const it of orderItems) {
      if (this.products.deductStock(it.productId, it.quantity)) {
        deducted.push(it);
      } else {
        // 回滚
        for (const d of deducted) this.products.restoreStock(d.productId, d.quantity);
        throw new Error('库存不足: ' + it.name);
      }
    }

    // 6. 扣积分（生成流水）
    if (pointsUsed > 0) {
      this.points.change(memberId, -pointsUsed, '订单积分抵扣', '');
    }

    const now = new Date();
    const order = {
      id: uuidv4(),
      orderNo: this._orderNo(),
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

    // 记录积分引用
    if (pointsUsed > 0) {
      const ledger = this.store.find('pointsLedger',
        p => p.memberId === memberId && p.reason === '订单积分抵扣' && !p.refId);
      if (ledger.length) {
        ledger[ledger.length - 1].refId = order.orderNo;
        this.store.markDirty('pointsLedger');
      }
    }

    return order;
  }

  /** 支付订单：mock模式直接标记已支付 */
  async pay(orderId, memberId, openid) {
    const order = this.store.findById('orders', orderId);
    if (!order) throw new Error('订单不存在');
    if (order.memberId !== memberId) throw new Error('无权操作此订单');
    if (order.status !== 'pending') throw new Error('订单状态不允许支付');
    if (new Date(order.expiresAt).getTime() < Date.now()) throw new Error('订单已超时，请重新下单');

    let payResult;
    if (this.wechat.config.mock) {
      payResult = {
        mock: true,
        transactionId: 'MOCK' + Date.now(),
        paidAt: new Date().toISOString()
      };
      this._onPaid(order, payResult);
      return { success: true, mock: true, order };
    } else {
      // 真实微信支付：返回给小程序调起 wx.requestPayment 的参数
      payResult = await this.wechat.createJsapiOrder({
        orderNo: order.orderNo,
        amount: order.payAmount,
        description: '邻里团订单-' + order.orderNo,
        openid
      });
      // 实际状态变更由支付回调 notify 触发
      return { success: true, mock: false, payParams: payResult, order };
    }
  }

  /** 支付成功回调（mock 或微信支付异步通知） */
  _onPaid(order, payInfo) {
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    order.payInfo = payInfo;

    // 核销优惠券
    if (order.couponId) this.coupons.use(order.couponId);

    // 累计会员消费
    this.members.recordSpending(order.memberId, order.payAmount / 100);

    // 消费返积分
    this.points.earnByOrder(order.memberId, order.orderNo, order.payAmount / 100);

    this.store.markDirty('orders');
  }

  /** 微信支付回调处理（真实模式） */
  handlePayNotify(orderNo, transactionId) {
    const order = this.store.find('orders', o => o.orderNo === orderNo)[0];
    if (!order) return false;
    if (order.status === 'pending') {
      this._onPaid(order, { transactionId, paidAt: new Date().toISOString() });
    }
    return true;
  }

  /** 取消订单（用户或系统） */
  cancel(orderId, memberId, reason) {
    const order = this.store.findById('orders', orderId);
    if (!order) throw new Error('订单不存在');
    if (memberId && order.memberId !== memberId) throw new Error('无权操作此订单');
    if (!['pending', 'paid'].includes(order.status)) throw new Error('当前状态不可取消');

    // 回滚库存
    for (const it of order.items) {
      this.products.restoreStock(it.productId, it.quantity);
    }

    // 返还积分抵扣
    if (order.pointsUsed > 0) {
      this.points.change(order.memberId, order.pointsUsed, '取消订单返还积分', order.orderNo);
    }
    // 若已支付：返还积分奖励
    if (order.status === 'paid') {
      const earned = Math.floor((order.payAmount / 100) * (this.points.config.ratePerYuan || 0));
      if (earned > 0) this.points.change(order.memberId, -earned, '取消订单扣回积分', order.orderNo);
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
