/**
 * 订单管理（核心交易模块）
 * 状态流转:
 *   pending 待支付 -> paid 已支付 -> delivering 配送中 -> completed 已完成
 *   pending -> cancelled 已取消（释放库存、释放优惠券、返还积分）
 *   paid/delivering/completed -> refunding -> refunded 已退款（回补库存、回退销量、返还积分）
 * 支付成功后：核销优惠券、累计消费、发放积分、累加商品销量
 */

const { business, AppError } = require('../errors');
const { randomUUID: uuidv4, randomInt, randomBytes } = require('crypto');

class OrderManager {
  constructor(store, deps) {
    this.store = store;
    this.products = deps.productManager;
    this.points = deps.pointsManager;
    this.coupons = deps.couponManager;
    this.members = deps.memberManager;
    this.wechat = deps.wechatService;
    this.notifications = deps.notifications || null;
    this.groupBuys = deps.groupBuyManager || null;
    this.locations = deps.locationService || null;
    this.auditLog = deps.auditLog || null;
    this.analytics = deps.analytics || null;
    this.config = deps.config || { payTimeoutMinutes: 30, offlinePaymentTimeoutMinutes: 1440, autoCompleteDays: 3, deliveryFee: 0, pickupReminderHours: 12 };
    this.timer = null;
  }

  initialize() {
    if (this.config.housekeepingEnabled === false) return;
    this.timer = setInterval(() => this._housekeeping().catch(error => console.error('[Order] 定时任务失败:', error.message)), 60000);
    if (this.timer.unref) this.timer.unref();
  }

  /** 生成订单号: NT + 日期 + 48位随机十六进制，满足微信 32 字符限制并显著降低碰撞概率。 */
  _orderNo() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    const rand = randomBytes(6).toString('hex').toUpperCase();
    return 'NT' + dateStr + rand;
  }

  /** 退款单号：同一订单允许多次部分退款，后缀必须独立随机。 */
  _refundNo(orderNo) {
    return 'RF' + String(orderNo).slice(2) + randomBytes(4).toString('hex').toUpperCase();
  }

  /**
   * 创建订单
   * items: [{productId, quantity}]
   * options: { usePoints, couponId, addressId, remark, groupBuyId, deliveryType }
   */
  async create(tenantId, memberId, items, options = {}) {
    if (!Array.isArray(items) || items.length === 0) throw business('订单商品不能为空');
    const member = await this.members.get(memberId);
    if (!member || member.tenantId !== tenantId) throw business('会员不存在');
    const deliveryType = options.deliveryType === 'pickup' ? 'pickup' : 'delivery';
    const paymentMode = options.paymentMode === 'offline' ? 'offline' : 'wechat';
    let deliveryAddress = null;
    let pickupLocation = null;
    if (deliveryType === 'delivery') {
      if (options.deliveryType === 'delivery' && !options.addressId) throw business('请选择收货地址');
      if (options.addressId) {
        deliveryAddress = (member.addresses || []).find(a => a.id === options.addressId) || null;
        if (!deliveryAddress) throw business('收货地址无效');
      }
    } else if (this.locations) {
      pickupLocation = options.pickupLocationId
        ? await this.locations.get(options.pickupLocationId, tenantId)
        : await this.locations.primary(tenantId);
      if (!pickupLocation || pickupLocation.status !== 'active' || !pickupLocation.pickupEnabled) throw business('自提门店不可用');
    }

    // 1. 校验商品、库存与团购价资格
    const orderItems = [];
    let goodsAmount = 0;
    for (const it of items) {
      const p = await this.products.get(it.productId);
      if (!p || p.tenantId !== tenantId) throw business('商品不存在: ' + it.productId);
      if (!p.onSale) throw business('商品已下架: ' + p.name);
      const qty = Math.floor(Number(it.quantity) || 0);
      if (qty <= 0) throw business('商品数量不合法: ' + p.name);
      if (p.stock < qty) throw business('库存不足: ' + p.name);

      let unitPrice = p.price;
      if (options.groupBuyId) {
        const gb = await this.store.findById('groupBuys', options.groupBuyId);
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
      coupon = await this.coupons.validate(options.couponId, memberId, goodsAmount);
      couponDiscount = Math.min(coupon.amount, goodsAmount);
    }

    // 3. 积分抵扣
    let pointsUsed = 0;
    let pointsDiscount = 0;
    if (options.usePoints && this.points.config.enabled) {
      const calc = await this.points.calcDiscount(memberId, (goodsAmount - couponDiscount) / 100, options.usePoints);
      pointsUsed = calc.pointsUsed;
      pointsDiscount = Math.round(calc.discount * 100);
    }

    // 4. 配送费与实付
    const deliveryFee = deliveryType === 'pickup' ? 0 : (Math.round(Number(this.config.deliveryFee) * 100) || 0);
    const payAmount = Math.max(0, goodsAmount - couponDiscount - pointsDiscount + deliveryFee);

    const now = new Date();
    const orderId = uuidv4();
    const orderNo = this._orderNo();
    const timeoutMinutes = paymentMode === 'offline'
      ? (Number(this.config.offlinePaymentTimeoutMinutes) || 1440)
      : (Number(this.config.payTimeoutMinutes) || 30);

    // 5. 在单个事务中扣库存、扣积分、预占优惠券并创建订单
    if (this.analytics) await this.analytics.ensure(tenantId);
    return this.store.transaction(async () => {
      for (const it of orderItems) {
        if (!await this.products.deductStock(it.productId, it.quantity)) {
          throw business('库存不足: ' + it.name);
        }
      }
      if (pointsUsed > 0) {
        await this.points.change(memberId, -pointsUsed, '订单积分抵扣', orderNo);
      }
      if (coupon) {
        await this.coupons.reserve(coupon.id, orderId);
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
      pickupLocationId: pickupLocation ? pickupLocation.id : null,
      pickupLocation: pickupLocation ? {
        id: pickupLocation.id,
        name: pickupLocation.name,
        address: pickupLocation.address,
        phone: pickupLocation.phone,
        hours: pickupLocation.hours
      } : null,
      deliveryType,
      paymentMode,
      paymentInstructions: String(options.paymentInstructions || '').slice(0, 300),
      pickupCode: deliveryType === 'pickup' ? String(randomInt(100000, 1000000)) : null,
      pickupVerifiedAt: null,
      remark: String(options.remark || '').slice(0, 100),
      groupBuyId: options.groupBuyId || null,
      payInfo: null,
      expiresAt: new Date(now.getTime() + timeoutMinutes * 60000).toISOString(),
      createdAt: now.toISOString(),
      paidAt: null,
      completedAt: null,
      cancelledAt: null
      };
      await this.store.insert('orders', order);
      if (this.analytics) await this.analytics.recordOrderCreated(order);
      await this._audit(order, 'member', 'order.create', memberId, { orderNo, amount: payAmount, deliveryType });
      return order;
    });
  }

  /** 支付订单：mock模式直接标记已支付；真实模式返回 wx.requestPayment 参数（openid 从会员记录推导） */
  async pay(orderId, memberId) {
    const order = await this.store.findById('orders', orderId);
    if (!order) throw business('订单不存在');
    if (order.memberId !== memberId) throw business('无权操作此订单');
    if (order.status === 'paid') {
      return { success: true, alreadyPaid: true, mock: this.wechat.config.mock, order };
    }
    if (order.status !== 'pending') throw business('订单状态不允许支付');
    if (new Date(order.expiresAt).getTime() < Date.now()) throw business('订单已超时，请重新下单');
    if (order.paymentMode === 'offline') throw business('该订单采用线下收款，请等待门店确认到账');

    if (this.wechat.config.mock) {
      const payResult = {
        mock: true,
        transactionId: 'MOCK' + Date.now(),
        paidAt: new Date().toISOString()
      };
      await this._onPaid(order, payResult, { type: 'member', id: memberId });
      return { success: true, mock: true, order: await this.store.findById('orders', orderId) || order };
    }

    if (!this.wechat.config.paymentEnabled) {
      throw new AppError('真实微信支付尚未启用，请使用模拟支付完成试点验收', {
        code: 'PAYMENT_DISABLED', status: 503
      });
    }
    const member = await this.members.get(memberId);
    const payResult = await this.wechat.createJsapiOrder({
      orderNo: order.orderNo,
      amount: order.payAmount,
      description: '邻里团订单-' + order.orderNo,
      openid: member ? member.openid : ''
    });
    return { success: true, mock: false, payParams: payResult, order };
  }

  /** 支付成功回调（mock 或微信支付异步通知），幂等 */
  async _onPaid(order, payInfo, actor = {}) {
    if (this.analytics) await this.analytics.ensure(order.tenantId);
    return this.store.transaction(async () => {
      const current = await this.store.findByIdForUpdate('orders', order.id);
      if (!current || current.status !== 'pending') return false;
      const paymentInfo = {
        ...payInfo,
        method: payInfo && payInfo.method ? payInfo.method : (this.wechat.config.mock ? 'mock' : 'wechat')
      };
      const transactionId = String(paymentInfo.transactionId || '');
      if (transactionId) {
        const existing = await this.store.findById('paymentTransactions', transactionId);
        if (existing && existing.orderId !== current.id) {
          throw business('该微信交易号已绑定其他订单');
        }
        if (!existing) {
          await this.store.insert('paymentTransactions', {
            id: transactionId,
            tenantId: current.tenantId,
            orderId: current.id,
            orderNo: current.orderNo,
            amount: current.payAmount,
            createdAt: new Date().toISOString()
          });
        }
      }
      const paidOrder = await this.store.update('orders', current.id, {
        status: 'paid', paidAt: new Date().toISOString(), payInfo: paymentInfo
      });
      if (this.analytics) await this.analytics.recordOrderPaid(paidOrder);
      if (current.couponId) await this.coupons.use(current.couponId);
      await this.members.recordSpending(current.memberId, current.payAmount / 100);
      await this.points.earnByOrder(current.memberId, current.orderNo, current.payAmount / 100);
      for (const item of current.items) await this.products.increaseSales(item.productId, item.quantity);
      if (this.notifications) {
        await this.notifications.notifyOrder(paidOrder, 'orderPaid', { status: '已支付', time: paidOrder.paidAt });
        if (paidOrder.deliveryType === 'pickup') {
          await this.notifications.notifyOrder(paidOrder, 'pickupReady', {
            status: '待取货', time: paidOrder.paidAt,
            pickupLocation: paidOrder.pickupLocation ? paidOrder.pickupLocation.name : ''
          });
        }
      }
      await this._audit(paidOrder, actor.type || 'member', 'order.pay', actor.id === undefined ? current.memberId : actor.id, {
        orderNo: current.orderNo,
        transactionId: paymentInfo.transactionId || paymentInfo.reference || '',
        method: paymentInfo.method,
        amount: current.payAmount
      });
      return true;
    });
  }

  /** 门店确认线下收款；仅记录线下到账事实，不接触资金。 */
  async confirmOfflinePayment(orderId, tenantId, data = {}, actor = {}) {
    const order = await this.store.findById('orders', orderId);
    if (!order || order.tenantId !== tenantId) throw business('订单不存在');
    if (order.paymentMode !== 'offline') throw business('该订单不是线下收款订单');
    if (order.status === 'paid' || order.status === 'delivering' || order.status === 'completed') {
      return { success: true, alreadyPaid: true, order };
    }
    if (order.status !== 'pending') throw business('当前订单状态不能确认收款');
    if (new Date(order.expiresAt).getTime() < Date.now()) throw business('订单已超时，请让顾客重新下单');
    const reference = String(data.reference || '').trim();
    if (!reference) throw business('请填写收款凭证或说明');
    const confirmedAt = new Date().toISOString();
    const paid = await this._onPaid(order, {
      method: 'offline',
      reference,
      note: String(data.note || '').slice(0, 120),
      confirmedBy: actor.id || '',
      confirmedAt
    }, { type: 'admin', id: actor.id || '' });
    if (!paid) {
      const latest = await this.store.findById('orders', orderId);
      if (latest && ['paid', 'delivering', 'completed'].includes(latest.status)) {
        return { success: true, alreadyPaid: true, order: latest };
      }
      throw business('订单状态已变化，请刷新后重试');
    }
    return {
      success: true,
      alreadyPaid: false,
      order: await this.store.findById('orders', orderId) || order
    };
  }

  /** 微信支付回调处理（真实模式） */
  async handlePayNotify(orderNo, transactionId) {
    const order = (await this.store.find('orders', o => o.orderNo === orderNo))[0];
    if (!order) return false;
    if (order.status === 'paid') return true;
    if (order.status === 'pending') {
      return this._onPaid(order, { transactionId, paidAt: new Date().toISOString() });
    }
    return false;
  }

  /** 微信支付回调（真实模式，已完成验签+解密+金额校验后调用） */
  async handlePayNotifyVerified(outTradeNo, transactionId, totalAmount) {
    const order = (await this.store.find('orders', o => o.orderNo === outTradeNo))[0];
    if (!order) throw business('支付回调对应的订单不存在');
    if (order.paymentMode === 'offline') throw business('线下收款订单不接受微信支付回调');
    if (totalAmount !== undefined && Math.round(Number(totalAmount)) !== order.payAmount) {
      throw business('支付金额与订单不符');
    }
    if (order.status === 'paid' || order.status === 'delivering' || order.status === 'completed') {
      if (order.payInfo && order.payInfo.transactionId && order.payInfo.transactionId !== transactionId) {
        throw business('同一订单收到不同的微信交易号');
      }
      return true;
    }
    if (order.status === 'refunded') {
      if (order.payInfo && order.payInfo.transactionId && order.payInfo.transactionId === transactionId) return true;
      throw business('已退款订单收到未知支付回调');
    }
    if (order.status === 'cancelled') {
      await this._refundLatePayment(order, transactionId, totalAmount);
      return true;
    }
    if (order.status !== 'pending') throw business('订单状态不接受支付回调: ' + order.status);
    return this._onPaid(order, { transactionId, paidAt: new Date().toISOString() });
  }

  /** 订单已取消后才收到支付成功时，保留异常记录并立即原路退款。 */
  async _refundLatePayment(order, transactionId, totalAmount) {
    const amount = Math.round(Number(totalAmount !== undefined ? totalAmount : order.payAmount) || 0);
    if (!(amount > 0)) throw business('异常支付金额无效');
    const claimed = await this.store.transaction(async () => {
      const current = await this.store.findByIdForUpdate('orders', order.id);
      if (!current) throw business('订单不存在');
      if (current.latePayment && current.latePayment.transactionId === transactionId) {
        if (current.latePayment.status === 'refunded') return { alreadyDone: true, current };
        return { alreadyDone: false, current, refundNo: current.latePayment.refundNo };
      }
      const paymentTransaction = await this.store.findById('paymentTransactions', transactionId);
      if (paymentTransaction && paymentTransaction.orderId !== current.id) {
        throw business('该微信交易号已绑定其他订单');
      }
      if (!paymentTransaction) {
        await this.store.insert('paymentTransactions', {
          id: transactionId,
          tenantId: current.tenantId,
          orderId: current.id,
          orderNo: current.orderNo,
          amount,
          latePayment: true,
          createdAt: new Date().toISOString()
        });
      }
      const refundNo = this._refundNo(current.orderNo);
      const updated = await this.store.update('orders', current.id, {
        latePayment: {
          transactionId,
          amount,
          refundNo,
          status: 'refunding',
          receivedAt: new Date().toISOString()
        }
      });
      return { alreadyDone: false, current: updated, refundNo };
    });
    if (claimed.alreadyDone) return true;

    try {
      const result = await this.wechat.refund({
        outTradeNo: order.orderNo,
        outRefundNo: claimed.refundNo,
        total: amount,
        refund: amount,
        reason: '订单取消后到账自动退款'
      });
      const status = result && result.status === 'SUCCESS' ? 'refunded' : 'processing';
      const current = await this.store.findById('orders', order.id);
      if (current && current.latePayment && current.latePayment.refundNo === claimed.refundNo) {
        await this.store.update('orders', order.id, {
          latePayment: { ...current.latePayment, status, providerRefundId: result && result.refund_id || '' }
        });
      }
      await this._audit(order, 'system', 'payment.late-refund', '', {
        orderNo: order.orderNo, transactionId, amount, refundNo: claimed.refundNo, status
      });
      return true;
    } catch (error) {
      const current = await this.store.findById('orders', order.id);
      if (current && current.latePayment && current.latePayment.refundNo === claimed.refundNo) {
        await this.store.update('orders', order.id, {
          latePayment: {
            ...current.latePayment,
            status: 'failed',
            error: String(error.message || error).slice(0, 500),
            failedAt: new Date().toISOString()
          }
        });
      }
      throw new AppError('订单取消后支付，自动退款提交失败: ' + (error.message || '未知错误'), {
        code: 'LATE_PAYMENT_REFUND_FAILED', status: 502
      });
    }
  }

  /** 申请退款（mock 即时退款；真实模式调用微信退款后等待退款回调确认）
   *  refundAmount 为退款金额（分）；缺省为剩余可退金额（全额）。支持部分退款，累计退款不超过实付。 */
  async refund(orderId, reason, refundAmount) {
    const refundOrder = await this.store.findById('orders', orderId);
    if (!refundOrder) throw business('订单不存在');
    if (refundOrder.paymentMode !== 'offline' && !this.wechat.config.mock && !this.wechat.config.paymentEnabled) {
      throw new AppError('真实微信退款尚未启用，请使用模拟退款验收流程', { code: 'PAYMENT_DISABLED', status: 503 });
    }
    if (this.analytics) await this.analytics.ensure(refundOrder.tenantId);

    const claimed = await this.store.transaction(async () => {
      const order = await this.store.findByIdForUpdate('orders', orderId);
      if (!order) throw business('订单不存在');
      if (!['paid', 'delivering', 'completed'].includes(order.status)) throw business('当前订单状态不支持退款');
      if (order.refund && order.refund.status === 'refunding') throw business('该订单已有退款正在处理');

      const alreadyRefunded = Math.round(Number(order.refundedAmount) || 0);
      const refundable = order.payAmount - alreadyRefunded;
      if (refundable <= 0) throw business('订单已全额退款');
      const target = refundAmount === undefined || refundAmount === null
        ? refundable
        : Math.round(Number(refundAmount) || 0);
      if (!(target > 0)) throw business('退款金额必须大于0');
      if (target > refundable) throw business('退款金额超过可退金额');

      const normalizedReason = String(reason || '用户申请退款').slice(0, 80);
      const reusable = order.refund && order.refund.status === 'failed' &&
        Number(order.refund.amount) === target && order.refund.reason === normalizedReason;
      const outRefundNo = reusable ? order.refund.outRefundNo : this._refundNo(order.orderNo);
      const refundInfo = {
        outRefundNo,
        amount: target,
        reason: normalizedReason,
        status: 'refunding',
        attempts: Number(order.refund && order.refund.attempts || 0) + 1,
        createdAt: reusable ? order.refund.createdAt : new Date().toISOString(),
        submittedAt: new Date().toISOString(),
        error: ''
      };
      const updated = await this.store.update('orders', order.id, { refund: refundInfo });
      return { order: updated, target, outRefundNo, refundInfo };
    });

    const order = claimed.order;
    await this._audit(order, 'system', 'refund.submit', '', {
      orderNo: order.orderNo,
      amount: claimed.target,
      reason: claimed.refundInfo.reason,
      refundNo: claimed.outRefundNo
    });
    if (this.notifications) {
      await this.notifications.notifyOrder(order, 'refundSubmitted', {
        status: '退款处理中', amount: (claimed.target / 100).toFixed(2), time: claimed.refundInfo.createdAt
      });
    }

    if (order.paymentMode === 'offline') {
      const finalized = await this._finalizeRefund(order, claimed.outRefundNo, claimed.target);
      return { success: true, mock: false, offline: true, order: finalized };
    }
    if (this.wechat.config.mock) {
      const finalized = await this._finalizeRefund(order, claimed.outRefundNo, claimed.target);
      return { success: true, mock: true, order: finalized };
    }
    try {
      const result = await this.wechat.refund({
        outTradeNo: order.orderNo,
        outRefundNo: claimed.outRefundNo,
        total: order.payAmount,
        refund: claimed.target,
        reason: claimed.refundInfo.reason
      });
      const latest = await this.store.findById('orders', order.id);
      if (latest && latest.refund && latest.refund.outRefundNo === claimed.outRefundNo) {
        await this.store.update('orders', order.id, {
          refund: {
            ...latest.refund,
            providerStatus: result && result.status || 'PROCESSING',
            providerRefundId: result && result.refund_id || ''
          }
        });
      }
      if (result && result.status === 'SUCCESS') {
        const finalized = await this._finalizeRefund(order, claimed.outRefundNo, claimed.target);
        return { success: true, mock: false, refundNo: claimed.outRefundNo, order: finalized };
      }
      return { success: true, mock: false, refundNo: claimed.outRefundNo, order: await this.store.findById('orders', order.id) || order };
    } catch (error) {
      try {
        await this.store.transaction(async () => {
          const current = await this.store.findByIdForUpdate('orders', order.id);
          if (!current || !current.refund || current.refund.outRefundNo !== claimed.outRefundNo) return;
          await this.store.update('orders', order.id, {
            refund: {
              ...current.refund,
              status: 'failed',
              error: String(error.message || error).slice(0, 500),
              failedAt: new Date().toISOString()
            }
          });
        });
        await this._audit(order, 'system', 'refund.failed', '', {
          orderNo: order.orderNo,
          refundNo: claimed.outRefundNo,
          error: String(error.message || error).slice(0, 500)
        });
      } catch (markError) { /* 保留原退款错误 */ }
      throw new AppError('退款提交失败，可安全重试: ' + (error.message || '未知错误'), {
        code: 'REFUND_SUBMIT_FAILED', status: 502
      });
    }
  }

  /** 退款成功回调（真实模式，已验签+解密后调用） */
  async handleRefundNotifyVerified(resource) {
    const order = (await this.store.find('orders', o => o.orderNo === resource.out_trade_no))[0];
    if (!order) throw business('退款回调对应的订单不存在');
    if (!order.refund || order.refund.outRefundNo !== resource.out_refund_no) {
      if (order.latePayment && order.latePayment.refundNo === resource.out_refund_no) {
        await this.store.transaction(async () => {
          const late = await this.store.findByIdForUpdate('orders', order.id);
          if (!late || !late.latePayment || late.latePayment.refundNo !== resource.out_refund_no) return;
          const status = resource.refund_status === 'SUCCESS' ? 'refunded' :
            (['CLOSED', 'ABNORMAL'].includes(resource.refund_status) ? 'failed' : 'processing');
          await this.store.update('orders', order.id, {
            latePayment: { ...late.latePayment, status, providerStatus: resource.refund_status, updatedAt: new Date().toISOString() }
          });
        });
        return true;
      }
      throw business('退款回调与当前退款申请不匹配');
    }
    if (resource.amount && resource.amount.currency && resource.amount.currency !== 'CNY') {
      throw business('退款回调币种不符');
    }
    if (resource.amount && resource.amount.total !== undefined && Math.round(Number(resource.amount.total)) !== order.payAmount) {
      throw business('退款回调订单总额不符');
    }
    if (resource.refund_status === 'SUCCESS') {
      const amount = (resource.amount && resource.amount.refund) || (order.refund && order.refund.amount) || order.payAmount;
      await this._finalizeRefund(order, resource.out_refund_no, amount);
      return true;
    }
    if (['CLOSED', 'ABNORMAL'].includes(resource.refund_status)) {
      await this.store.transaction(async () => {
        const current = await this.store.findByIdForUpdate('orders', order.id);
        if (!current || !current.refund || current.refund.outRefundNo !== resource.out_refund_no) return;
        await this.store.update('orders', order.id, {
          refund: {
            ...current.refund,
            status: 'failed',
            providerStatus: resource.refund_status,
            error: '微信退款状态: ' + resource.refund_status,
            failedAt: new Date().toISOString()
          }
        });
        await this._audit(current, 'system', 'refund.failed', '', {
          orderNo: current.orderNo, refundNo: current.refund.outRefundNo, providerStatus: resource.refund_status
        });
      });
    }
    return true;
  }

  /** 退款完成：累计退款金额；全额退款时回补库存、回退销量、返还积分并结单 */
  async _finalizeRefund(order, refundNo, refundAmount) {
    return this.store.transaction(async () => {
      const current = await this.store.findByIdForUpdate('orders', order.id);
      if (!current) throw business('订单不存在');
      if ((current.completedRefunds || []).some(item => item.refundNo === refundNo)) return current;
      const amount = Math.round(Number(refundAmount) || 0);
      const newRefunded = Math.round(Number(current.refundedAmount) || 0) + amount;
      if (newRefunded > current.payAmount) throw business('退款金额超过订单实付');
      const isFull = newRefunded >= current.payAmount;

      const completedRefunds = (current.completedRefunds || []).concat([{
      refundNo,
      amount,
      completedAt: new Date().toISOString()
    }]);
      const patch = { refundedAmount: newRefunded, completedRefunds };
      if (current.refund) patch.refund = { ...current.refund, status: 'refunded' };

      if (isFull) {
        for (const item of current.items) {
          await this.products.restoreStock(item.productId, item.quantity);
          await this.products.decreaseSales(item.productId, item.quantity);
        }
        if (current.pointsUsed > 0) {
          await this.points.change(current.memberId, current.pointsUsed, '退款返还积分', current.orderNo);
        }
        patch.status = 'refunded';
        patch.refundedAt = new Date().toISOString();
      }
      const updated = await this.store.update('orders', current.id, patch);
      if (isFull && this.analytics) await this.analytics.recordOrderRefunded(updated || current);
      await this._audit(updated || current, 'system', 'refund.complete', '', {
        orderNo: current.orderNo, refundNo, amount, full: isFull
      });
      if (this.notifications) {
        await this.notifications.notifyOrder(updated || { ...current, ...patch }, 'refundCompleted', {
          status: isFull ? '已退款' : '部分退款', amount: (amount / 100).toFixed(2), time: new Date().toISOString()
        });
      }
      return updated;
    });
  }

  /** 取消订单（仅待支付；已支付请走退款流程） */
  async cancel(orderId, memberId, reason, actor = {}) {
    return this.store.transaction(async () => {
    const order = await this.store.findByIdForUpdate('orders', orderId);
    if (!order) throw business('订单不存在');
    if (memberId && order.memberId !== memberId) throw business('无权操作此订单');
    if (order.status !== 'pending') throw business('仅待支付订单可取消，已支付订单请走退款流程');

    if (this.analytics) await this.analytics.ensure(order.tenantId);

    for (const it of order.items) {
      await this.products.restoreStock(it.productId, it.quantity);
    }
    if (order.pointsUsed > 0) {
      await this.points.change(order.memberId, order.pointsUsed, '取消订单返还积分', order.orderNo);
    }
    if (order.couponId) {
      await this.coupons.release(order.couponId, order.id);
    }

    const updated = await this.store.update('orders', order.id, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancelReason: reason || '用户取消' });
    if (this.analytics) await this.analytics.recordOrderCancelled(updated || order);
    await this._audit(
      updated,
      actor.type || (memberId ? 'member' : 'system'),
      'order.cancel',
      actor.id === undefined ? (memberId || '') : actor.id,
      { orderNo: order.orderNo, reason: reason || '用户取消' }
    );
    return updated;
    });
  }

  /** 商家发货/完成配送；可附带物流信息（公司 + 单号） */
  async deliver(orderId, logistics) {
    return this.store.transaction(async () => {
    const order = await this.store.findByIdForUpdate('orders', orderId);
    if (!order) throw business('订单不存在');
    if (order.status !== 'paid') throw business('仅已支付订单可发货');
    const patch = { status: 'delivering', deliveredAt: new Date().toISOString() };
    if (logistics && (logistics.company || logistics.trackingNo)) {
      patch.logistics = {
        company: String(logistics.company || '').slice(0, 50),
        trackingNo: String(logistics.trackingNo || '').slice(0, 64)
      };
    }
    const updated = await this.store.update('orders', order.id, patch);
    await this._audit(updated, 'admin', 'order.deliver', '', { orderNo: order.orderNo });
    if (this.notifications) {
      await this.notifications.notifyOrder(updated || { ...order, ...patch }, 'orderDelivered', {
        status: order.deliveryType === 'pickup' ? '待自提' : '已发货',
        time: patch.deliveredAt
      });
    }
    return updated;
    });
  }

  /** 批量发货；逐单返回结果，单笔失败不会阻断其他订单。 */
  async batchDeliver(orderIds, logistics, tenantId) {
    if (!Array.isArray(orderIds) || orderIds.length === 0) throw business('请选择订单');
    const ids = [...new Set(orderIds.map(String))].slice(0, 100);
    const delivered = [];
    const failures = [];
    for (const id of ids) {
      const order = await this.store.findById('orders', id);
      if (!order || order.tenantId !== tenantId) {
        failures.push({ id, error: '订单不存在' });
        continue;
      }
      try {
        if (order.deliveryType === 'pickup') throw business('自提订单请使用取货码核销');
        delivered.push(await this.deliver(id, logistics));
      } catch (e) {
        failures.push({ id, orderNo: order.orderNo, error: e.message });
      }
    }
    return {
      successCount: delivered.length,
      failureCount: failures.length,
      delivered,
      failures
    };
  }

  /** 自提核销：校验取货码后将已支付订单直接完成。 */
  async verifyPickup(orderId, pickupCode, tenantId) {
    return this.store.transaction(async () => {
    const order = await this.store.findByIdForUpdate('orders', orderId);
    if (!order || (tenantId && order.tenantId !== tenantId)) throw business('订单不存在');
    if (order.deliveryType !== 'pickup') throw business('该订单不是自提订单');
    if (String(order.pickupCode || '') !== String(pickupCode || '')) throw business('取货码不正确');
    if (order.status === 'completed' && order.pickupVerifiedAt) return { alreadyCompleted: true, order };
    if (order.status !== 'paid') throw business('仅待自提订单可核销');
    const now = new Date().toISOString();
    const updated = await this.store.update('orders', order.id, {
      status: 'completed',
      pickupVerifiedAt: now,
      completedAt: now
    });
    await this._audit(updated, 'admin', 'order.verify-pickup', '', { orderNo: order.orderNo });
    if (this.notifications) {
      await this.notifications.notifyOrder(updated || { ...order, status: 'completed' }, 'pickupCompleted', {
        status: '已取货',
        time: now
      });
    }
    return { alreadyCompleted: false, order: updated };
    });
  }

  /** 确认收货 */
  async complete(orderId, memberId) {
    return this.store.transaction(async () => {
    const order = await this.store.findByIdForUpdate('orders', orderId);
    if (!order) throw business('订单不存在');
    if (memberId && order.memberId !== memberId) throw business('无权操作此订单');
    if (order.status !== 'delivering') throw business('仅配送中订单可确认收货');
    const updated = await this.store.update('orders', order.id, { status: 'completed', completedAt: new Date().toISOString() });
    await this._audit(updated, 'member', 'order.complete', memberId || '', { orderNo: order.orderNo });
    return updated;
    });
  }

  async get(orderId) {
    return this.store.findById('orders', orderId);
  }

  async listByMember(memberId, status) {
    let list = await this.store.findByMember('orders', memberId);
    if (status) list = list.filter(o => o.status === status);
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async listByTenant(tenantId, opts = {}) {
    let list = await this.store.findByTenant('orders', tenantId);
    if (opts.status === 'refunding') {
      list = list.filter(o => o.refund && o.refund.status === 'refunding');
    } else if (opts.status) {
      list = list.filter(o => o.status === opts.status);
    }
    if (opts.keyword) {
      const k = opts.keyword.toLowerCase();
      list = list.filter(o => o.orderNo.toLowerCase().includes(k));
    }
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async listByTenantPage(tenantId, opts = {}) {
    const status = String(opts.status || '');
    return this.store.pageByTenant('orders', tenantId, {
      statuses: status && status !== 'refunding' ? [status] : undefined,
      refundStatus: status === 'refunding' ? 'refunding' : undefined,
      keyword: opts.keyword || '',
      keywordField: 'orderNo',
      page: opts.page,
      pageSize: opts.pageSize,
      sortField: 'createdAt',
      sortDirection: 'DESC'
    });
  }

  /** 定时清理：超时未支付自动取消；配送中超时自动完成 */
  async _housekeeping() {
    const now = Date.now();
    const autoDays = this.config.autoCompleteDays || 3;
    const reminderAfter = Math.max(1, Number(this.config.pickupReminderHours) || 12) * 3600000;
    const candidates = await this.store.findHousekeepingOrders({
      pendingExpiresBefore: new Date(now).toISOString(),
      autoCompleteDeliveredBefore: new Date(now - autoDays * 86400000).toISOString(),
      pickupReminderPaidBefore: new Date(now - reminderAfter).toISOString()
    });
    for (const order of candidates) {
      if (order.status === 'pending' && new Date(order.expiresAt).getTime() < now) {
        try { await this.cancel(order.id, null, '超时未支付自动取消'); } catch (e) {}
      }
      if (order.status === 'delivering' && order.deliveredAt) {
        const autoDays = this.config.autoCompleteDays || 3;
        if (now - new Date(order.deliveredAt).getTime() > autoDays * 86400000) {
          await this.store.update('orders', order.id, { status: 'completed', completedAt: new Date().toISOString() });
        }
      }
      if (order.status === 'paid' && order.deliveryType === 'pickup' && order.paidAt && !order.pickupReminderSentAt) {
        const reminderAfter = Math.max(1, Number(this.config.pickupReminderHours) || 12) * 3600000;
        if (now - new Date(order.paidAt).getTime() >= reminderAfter) {
          const updated = await this.store.update('orders', order.id, { pickupReminderSentAt: new Date().toISOString() });
          if (this.notifications) {
            await this.notifications.notifyOrder(updated, 'pickupReminder', {
              status: '等待取货',
              time: new Date().toISOString(),
              pickupLocation: order.pickupLocation ? order.pickupLocation.name : ''
            });
          }
        }
      }
    }
  }

  async _audit(order, actorType, action, actorId, detail) {
    if (!this.auditLog || !order) return;
    try {
      await this.auditLog.record({
        tenantId: order.tenantId,
        actorType,
        actorId: actorId || '',
        action,
        resource: 'order',
        resourceId: order.id,
        detail
      });
    } catch (error) { /* 审计失败不阻断交易主链路 */ }
  }

  shutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = OrderManager;

