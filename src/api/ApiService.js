/**
 * REST API 服务
 * 分两组：
 *  - /api/admin/*   管理后台（商家使用，需管理员令牌）
 *  - /api/wx/*      小程序端（微信用户使用，需会员令牌；公开目录除外）
 * 会员与管理员身份一律从签名令牌推导，不再信任客户端自报的 memberId / X-Tenant-Id
 */
const { toAppError, business } = require('../errors');
const { validate } = require('../validation');
class ApiService {
  constructor(app, deps) {
    this.app = app;
    this.deps = deps;
  }

  registerRoutes() {
    const { app } = this;
    const { store, config, tenantManager, auth, adminService, productManager: pm, orderManager: om,
            memberManager: mm, pointsManager: pts, couponManager: cm, groupBuyManager: gbm,
            formManager: fm, appointmentManager: am, statsService: stats, todayService,
            notifications, auditLog, reconciliation, wechat } = this.deps;

    // ---------- 通用工具 ----------
    const ok = (res, data) => res.json({ success: true, data });
    const fail = (req, res, err) => {
      const appErr = toAppError(err);
      res.status(appErr.status).json({
        success: false,
        code: appErr.code,
        error: appErr.message,
        ...(appErr.details ? { details: appErr.details } : {}),
        requestId: req.id || null
      });
    };
    const wrap = (fn) => async (req, res) => {
      try { await fn(req, res); } catch (e) { fail(req, res, e); }
    };
    const bearer = (req) => {
      const h = req.headers['authorization'] || '';
      if (typeof h !== 'string') return null;
      const m = h.match(/^Bearer\s+(.+)$/i);
      return m ? m[1] : null;
    };
    const unauthorized = (req, res, msg) => res.status(401).json({ success: false, code: 'UNAUTHORIZED', error: msg || '未登录或登录已过期', requestId: req.id || null });

    const authMember = (req, res, next) => {
      const payload = auth.verify(bearer(req), 'member');
      if (!payload) return unauthorized(req, res);
      req.auth = payload;
      req.memberId = payload.sub;
      req.tenantId = payload.tenantId;
      next();
    };

    const authAdmin = (req, res, next) => {
      const payload = auth.verify(bearer(req), 'admin');
      if (!payload) return unauthorized(req, res);
      if (!adminService.getById(payload.sub, payload.tenantId)) return unauthorized(req, res);
      req.auth = payload;
      req.adminId = payload.sub;
      req.tenantId = payload.tenantId;
      next();
    };

    const paginate = (req, arr) => {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
      const total = arr.length;
      const start = (page - 1) * pageSize;
      return { list: arr.slice(start, start + pageSize), total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    };

    const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
    const audit = (req, action, resource, resourceId, detail) => {
      auditLog.record({
        tenantId: req.tenantId,
        actorType: req.auth ? req.auth.typ : 'admin',
        actorId: req.adminId || req.memberId || '',
        action,
        resource,
        resourceId: resourceId || '',
        detail,
        ip: clientIp(req)
      });
    };

    const memberOf = (req) => {
      const m = mm.get(req.memberId);
      if (!m || m.tenantId !== req.tenantId) return null;
      return m;
    };

    const orderDetail = (order) => {
      const member = mm.get(order.memberId);
      const refundable = Math.max(0, Number(order.payAmount) - Number(order.refundedAmount || 0));
      const actions = [];
      if (order.status === 'paid' && order.deliveryType !== 'pickup') {
        actions.push({ id: 'deliver', label: '发货', method: 'POST', href: '/api/admin/orders/' + order.id + '/deliver' });
      }
      if (order.status === 'paid' && order.deliveryType === 'pickup') {
        actions.push({ id: 'verify-pickup', label: '核销取货', method: 'POST', href: '/api/admin/orders/' + order.id + '/verify-pickup' });
      }
      if (['paid', 'delivering', 'completed'].includes(order.status) && refundable > 0) {
        actions.push({ id: 'refund', label: '退款', method: 'POST', href: '/api/admin/orders/' + order.id + '/refund' });
      }
      return {
        ...order,
        refundableAmount: refundable,
        member: member ? {
          id: member.id,
          nickname: member.nickname,
          phone: member.phone,
          avatar: member.avatar
        } : null,
        availableActions: actions
      };
    };

    // 公开目录仍可无登录访问，用于商户展示；敏感身份接口均需鉴权
    // 租户必须命中注册表，拒绝客户端自报的任意 tenantId
    const tenantOf = (req) => {
      const id = req.headers['x-tenant-id'] || config.tenant.defaultId;
      if (!tenantManager.exists(id)) throw business('租户不存在或已停用');
      return id;
    };

    // ============ 小程序端 API ============

    // 微信登录（仅此接口不需要会员令牌）
    app.post('/api/wx/login', wrap(async (req, res) => {
      const body = validate('login', req.body);
      const tenantId = tenantOf(req);
      const member = await mm.loginByWechatCode(body.code, tenantId);
      ok(res, {
        memberId: member.id,
        nickname: member.nickname,
        isNew: false,
        mock: wechat.mock,
        token: auth.issueMemberToken(member)
      });
    }));

    app.get('/api/wx/home', wrap(async (req, res) => {
      const tenantId = tenantOf(req);
      ok(res, {
        tenant: { id: tenantId, name: config.tenant.defaultName },
        categories: pm.listCategories(tenantId),
        products: pm.list(tenantId, { onSaleOnly: true }).slice(0, 20).map(p => this._priceView(p)),
        groupBuys: gbm.list(tenantId, 'active').slice(0, 10)
      });
    }));

    app.get('/api/wx/products', wrap(async (req, res) => {
      const list = pm.list(tenantOf(req), {
        onSaleOnly: true,
        categoryId: req.query.categoryId,
        keyword: req.query.keyword
      }).map(p => this._priceView(p));
      ok(res, list);
    }));

    app.get('/api/wx/products/:id', wrap(async (req, res) => {
      const tenantId = tenantOf(req);
      const p = pm.get(req.params.id);
      if (!p || p.tenantId !== tenantId) throw business('商品不存在');
      ok(res, this._priceView(p));
    }));

    // 会员资料（身份来自令牌，路径 :id 必须与令牌一致）
    app.get('/api/wx/member/:id', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      const m = memberOf(req);
      if (!m) return unauthorized(req, res);
      ok(res, {
        id: m.id, nickname: m.nickname, avatar: m.avatar, phone: m.phone,
        addresses: m.addresses, totalSpent: m.totalSpent, orderCount: m.orderCount,
        points: pts.getBalance(m.id)
      });
    }));

    app.put('/api/wx/member/:id', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      ok(res, mm.updateProfile(req.memberId, validate('memberUpdate', req.body)));
    }));

    app.post('/api/wx/member/:id/addresses', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      ok(res, mm.addAddress(req.memberId, validate('addressCreate', req.body)));
    }));
    app.delete('/api/wx/member/:id/addresses/:addressId', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      ok(res, { removed: mm.removeAddress(req.memberId, req.params.addressId) });
    }));

    app.get('/api/wx/member/:id/points', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      ok(res, {
        balance: pts.getBalance(req.memberId),
        ledger: pts.getLedger(req.memberId)
      });
    }));

    // 小程序在用户点击支付前获取模板 ID；未配置时返回空数组，不影响支付。
    app.get('/api/wx/subscriptions', authMember, wrap(async (req, res) => {
      ok(res, {
        events: notifications.listTemplates(['orderPaid', 'orderDelivered', 'pickupCompleted', 'refundCompleted'])
      });
    }));

    app.get('/api/wx/checkout', authMember, wrap(async (req, res) => {
      ok(res, {
        deliveryFee: Number(config.orders.deliveryFee) || 0,
        points: {
          enabled: config.points.enabled !== false,
          maxPercentPerOrder: Number(config.points.maxPercentPerOrder) || 0
        }
      });
    }));

    app.get('/api/wx/coupons/templates', wrap(async (req, res) => {
      ok(res, cm.listTemplates(tenantOf(req)).filter(t => t.enabled).map(c => this._couponView(c)));
    }));
    app.post('/api/wx/coupons/claim', authMember, wrap(async (req, res) => {
      if (!memberOf(req)) return unauthorized(req, res);
      const tpl = cm.getTemplate(req.body.templateId);
      if (!tpl || tpl.tenantId !== req.tenantId) throw business('优惠券不存在');
      ok(res, cm.claim(req.body.templateId, req.memberId));
    }));
    app.get('/api/wx/member/:id/coupons', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      ok(res, cm.listMine(req.memberId, req.query.status));
    }));

    // 订单
    app.post('/api/wx/orders', authMember, wrap(async (req, res) => {
      if (!memberOf(req)) return unauthorized(req, res);
      const body = validate('orderCreate', req.body);
      const order = om.create(req.tenantId, req.memberId, body.items, body.options);
      ok(res, order);
    }));

    app.post('/api/wx/orders/:id/pay', authMember, wrap(async (req, res) => {
      ok(res, await om.pay(req.params.id, req.memberId));
    }));

    app.post('/api/wx/orders/:id/cancel', authMember, wrap(async (req, res) => {
      ok(res, om.cancel(req.params.id, req.memberId, req.body.reason));
    }));

    app.post('/api/wx/orders/:id/complete', authMember, wrap(async (req, res) => {
      ok(res, om.complete(req.params.id, req.memberId));
    }));

    app.post('/api/wx/orders/:id/refund', authMember, wrap(async (req, res) => {
      const o = om.get(req.params.id);
      if (!o || o.memberId !== req.memberId) throw business('订单不存在');
      const amount = req.body.amount !== undefined ? Math.round(Number(req.body.amount) * 100) : undefined;
      ok(res, await om.refund(req.params.id, req.body.reason, amount));
    }));

    app.get('/api/wx/orders', authMember, wrap(async (req, res) => {
      ok(res, om.listByMember(req.memberId, req.query.status));
    }));

    app.get('/api/wx/orders/:id', authMember, wrap(async (req, res) => {
      const o = om.get(req.params.id);
      if (!o || o.memberId !== req.memberId) throw business('订单不存在');
      ok(res, o);
    }));

    // 团购
    app.get('/api/wx/groupbuys', wrap(async (req, res) => {
      ok(res, gbm.list(tenantOf(req), req.query.status));
    }));
    app.get('/api/wx/groupbuys/:id', wrap(async (req, res) => {
      const tenantId = tenantOf(req);
      const gb = gbm.get(req.params.id);
      if (!gb || gb.tenantId !== tenantId) throw business('团购不存在');
      ok(res, gb);
    }));
    app.post('/api/wx/groupbuys/:id/join', authMember, wrap(async (req, res) => {
      if (!memberOf(req)) return unauthorized(req, res);
      const gb = gbm.get(req.params.id);
      if (!gb || gb.tenantId !== req.tenantId) throw business('团购不存在');
      ok(res, gbm.join(req.params.id, req.memberId));
    }));

    // 表单问卷
    app.get('/api/wx/forms', wrap(async (req, res) => {
      ok(res, fm.list(tenantOf(req)).filter(f => f.status === 'open'));
    }));
    app.get('/api/wx/forms/:id', wrap(async (req, res) => {
      const tenantId = tenantOf(req);
      const f = fm.get(req.params.id);
      if (!f || f.tenantId !== tenantId) throw business('表单不存在');
      ok(res, f);
    }));
    app.post('/api/wx/forms/:id/submit', authMember, wrap(async (req, res) => {
      if (!memberOf(req)) return unauthorized(req, res);
      const f = fm.get(req.params.id);
      if (!f || f.tenantId !== req.tenantId) throw business('表单不存在');
      ok(res, fm.submit(req.params.id, req.memberId, validate('formSubmit', req.body).answers));
    }));

    // 预约
    app.get('/api/wx/appointments/services', wrap(async (req, res) => {
      ok(res, am.listServices(tenantOf(req)).filter(s => s.enabled).map(s => ({ ...s, price: s.price / 100 })));
    }));
    app.get('/api/wx/appointments/slots', wrap(async (req, res) => {
      const tenantId = tenantOf(req);
      const svc = store.findById('appointmentServices', req.query.serviceId);
      if (!svc || svc.tenantId !== tenantId) throw business('服务不存在');
      ok(res, am.querySlots(req.query.serviceId, req.query.date));
    }));
    app.post('/api/wx/appointments', authMember, wrap(async (req, res) => {
      if (!memberOf(req)) return unauthorized(req, res);
      const svc = store.findById('appointmentServices', req.body.serviceId);
      if (!svc || svc.tenantId !== req.tenantId) throw business('服务不存在');
      const body = validate('appointmentBook', req.body);
      ok(res, am.book(body.serviceId, req.memberId, body.date, body.slot, body.note));
    }));
    app.post('/api/wx/appointments/:id/cancel', authMember, wrap(async (req, res) => {
      ok(res, am.cancel(req.params.id, req.memberId));
    }));
    app.get('/api/wx/member/:id/appointments', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      ok(res, am.listByMember(req.memberId));
    }));

    // 微信支付异步通知：真实模式验签+解密+核对金额/商户号/AppID 后入账
    app.post('/api/wx/pay/notify', async (req, res) => {
      try {
        let orderNo, txId, total;
        if (wechat.mock) {
          orderNo = req.body.out_trade_no || (req.body.resource && req.body.resource.out_trade_no);
          txId = req.body.transaction_id || '';
        } else {
          const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
          const payload = wechat.verifyPayNotify(req.headers, rawBody);
          if (payload.mchid && payload.mchid !== wechat.mchId) throw business('商户号不符');
          if (payload.appid && payload.appid !== wechat.appId) throw business('AppID 不符');
          if (payload.trade_state && payload.trade_state !== 'SUCCESS') {
            return res.json({ code: 'SUCCESS', message: '成功' }); // 非成功状态直接确认，避免重复回调
          }
          orderNo = payload.out_trade_no;
          txId = payload.transaction_id;
          total = payload.amount && payload.amount.total;
        }
        if (orderNo) om.handlePayNotifyVerified(orderNo, txId, total);
        res.json({ code: 'SUCCESS', message: '成功' });
      } catch (e) {
        console.error('[支付回调] 处理失败:', e.message);
        res.status(400).json({ code: 'FAIL', message: e.message });
      }
    });

    // 微信退款异步通知：真实模式验签+解密后完成退款
    app.post('/api/wx/pay/refund/notify', async (req, res) => {
      try {
        if (wechat.mock) return res.json({ code: 'SUCCESS', message: '成功' });
        const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
        const payload = wechat.verifyPayNotify(req.headers, rawBody);
        om.handleRefundNotifyVerified(payload);
        res.json({ code: 'SUCCESS', message: '成功' });
      } catch (e) {
        console.error('[退款回调] 处理失败:', e.message);
        res.status(400).json({ code: 'FAIL', message: e.message });
      }
    });

    // ============ 管理后台 API ============

    // 管理员登录
    app.post('/api/admin/login', async (req, res) => {
      try {
        const tenantId = tenantOf(req);
        const admin = adminService.authenticate(req.body.username, tenantId, req.body.password);
        if (!admin) return res.status(401).json({ success: false, error: '用户名或密码错误' });
        auditLog.record({ tenantId, actorType: 'admin', actorId: admin.id, actorName: admin.username, action: 'admin.login', detail: { username: admin.username }, ip: clientIp(req) });
        return ok(res, {
          token: auth.issueAdminToken(admin),
          username: admin.username,
          role: admin.role,
          tenantId
        });
      } catch (e) {
        return fail(req, res, e);
      }
    });

    app.get('/api/admin/stats', authAdmin, wrap(async (req, res) => {
      ok(res, stats.dashboard(req.tenantId));
    }));

    app.get('/api/admin/today', authAdmin, wrap(async (req, res) => {
      ok(res, todayService.dashboard(req.tenantId));
    }));

    app.get('/api/admin/categories', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, pm.listCategories(req.tenantId)));
    }));
    app.post('/api/admin/categories', authAdmin, wrap(async (req, res) => {
      ok(res, pm.createCategory(req.tenantId, req.body));
    }));

    app.get('/api/admin/products', authAdmin, wrap(async (req, res) => {
      let products = pm.list(req.tenantId, { keyword: req.query.keyword });
      if (req.query.stock === 'low') {
        products = products.filter(p => p.onSale && Number(p.stock) <= Number(config.inventory.lowStockThreshold));
      }
      ok(res, paginate(req, products.map(p => this._priceView(p))));
    }));
    app.get('/api/admin/products/:id', authAdmin, wrap(async (req, res) => {
      const p = pm.get(req.params.id);
      if (!p || p.tenantId !== req.tenantId) throw business('商品不存在');
      const category = p.categoryId ? pm.listCategories(req.tenantId).find(c => c.id === p.categoryId) : null;
      ok(res, {
        ...this._priceView(p),
        category: category ? { id: category.id, name: category.name } : null,
        availableActions: [
          { id: 'edit', label: '编辑', method: 'PUT', href: '/api/admin/products/' + p.id },
          { id: p.onSale ? 'take-offline' : 'publish', label: p.onSale ? '下架' : '上架', method: 'PUT', href: '/api/admin/products/' + p.id },
          { id: 'delete', label: '删除', method: 'DELETE', href: '/api/admin/products/' + p.id }
        ]
      });
    }));
    app.post('/api/admin/products', authAdmin, wrap(async (req, res) => {
      const p = pm.create(req.tenantId, validate('productCreate', req.body));
      audit(req, 'product.create', 'product', p.id, { name: p.name });
      ok(res, this._priceView(p));
    }));
    app.put('/api/admin/products/:id', authAdmin, wrap(async (req, res) => {
      const p = pm.get(req.params.id);
      if (!p || p.tenantId !== req.tenantId) throw business('商品不存在');
      const updated = pm.update(req.params.id, validate('productUpdate', req.body));
      audit(req, 'product.update', 'product', req.params.id, { patch: req.body });
      ok(res, this._priceView(updated));
    }));
    app.delete('/api/admin/products/:id', authAdmin, wrap(async (req, res) => {
      const p = pm.get(req.params.id);
      if (!p || p.tenantId !== req.tenantId) throw business('商品不存在');
      ok(res, { removed: pm.remove(req.params.id) });
      audit(req, 'product.delete', 'product', req.params.id, { name: p.name });
    }));

    app.get('/api/admin/orders', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, om.listByTenant(req.tenantId, { status: req.query.status, keyword: req.query.keyword })));
    }));
    app.get('/api/admin/orders/:id', authAdmin, wrap(async (req, res) => {
      const o = om.get(req.params.id);
      if (!o || o.tenantId !== req.tenantId) throw business('订单不存在');
      ok(res, orderDetail(o));
    }));
    app.post('/api/admin/orders/batch-deliver', authAdmin, wrap(async (req, res) => {
      const body = validate('orderBatchDeliver', req.body);
      const result = om.batchDeliver(body.orderIds, {
        company: body.company,
        trackingNo: body.trackingNo
      }, req.tenantId);
      audit(req, 'order.batch-deliver', 'order', body.orderIds.join(','), {
        company: body.company,
        trackingNo: body.trackingNo,
        successCount: result.successCount,
        failureCount: result.failureCount
      });
      ok(res, result);
    }));
    app.post('/api/admin/orders/:id/deliver', authAdmin, wrap(async (req, res) => {
      const o = om.get(req.params.id);
      if (!o || o.tenantId !== req.tenantId) throw business('订单不存在');
      const logistics = validate('orderDeliver', req.body);
      ok(res, om.deliver(req.params.id, logistics));
      audit(req, 'order.deliver', 'order', req.params.id, { orderNo: o.orderNo });
    }));
    app.post('/api/admin/orders/:id/verify-pickup', authAdmin, wrap(async (req, res) => {
      const o = om.get(req.params.id);
      if (!o || o.tenantId !== req.tenantId) throw business('订单不存在');
      const body = validate('orderPickupVerify', req.body);
      const result = om.verifyPickup(req.params.id, body.pickupCode, req.tenantId);
      audit(req, 'order.verify-pickup', 'order', req.params.id, { orderNo: o.orderNo, alreadyCompleted: result.alreadyCompleted });
      ok(res, result);
    }));
    app.post('/api/admin/orders/:id/refund', authAdmin, wrap(async (req, res) => {
      const o = om.get(req.params.id);
      if (!o || o.tenantId !== req.tenantId) throw business('订单不存在');
      const body = validate('orderRefund', req.body);
      const amount = body.amount !== undefined ? Math.round(Number(body.amount) * 100) : undefined;
      ok(res, await om.refund(req.params.id, body.reason, amount));
      audit(req, 'order.refund', 'order', req.params.id, { orderNo: o.orderNo, reason: body.reason, amount });
    }));

    app.get('/api/admin/members', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, mm.listByTenant(req.tenantId, req.query.keyword)));
    }));

    app.get('/api/admin/points/rules', authAdmin, wrap(async (req, res) => {
      ok(res, config.points);
    }));

    app.get('/api/admin/coupons', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, cm.listTemplates(req.tenantId).map(c => this._couponView(c))));
    }));
    app.post('/api/admin/coupons', authAdmin, wrap(async (req, res) => {
      const c = cm.createTemplate(req.tenantId, validate('couponCreate', req.body));
      audit(req, 'coupon.create', 'coupon', c.id, { name: c.name });
      ok(res, c);
    }));

    app.get('/api/admin/groupbuys', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, gbm.list(req.tenantId)));
    }));
    app.post('/api/admin/groupbuys', authAdmin, wrap(async (req, res) => {
      const g = gbm.create(req.tenantId, validate('groupBuyCreate', req.body));
      audit(req, 'groupbuy.create', 'groupbuy', g.id, { title: g.title });
      ok(res, g);
    }));
    app.post('/api/admin/groupbuys/:id/cancel', authAdmin, wrap(async (req, res) => {
      const gb = gbm.get(req.params.id);
      if (!gb || gb.tenantId !== req.tenantId) throw business('团购不存在');
      ok(res, gbm.cancel(req.params.id));
      audit(req, 'groupbuy.cancel', 'groupbuy', req.params.id, { title: gb.title });
    }));

    app.get('/api/admin/forms', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, fm.list(req.tenantId)));
    }));
    app.post('/api/admin/forms', authAdmin, wrap(async (req, res) => {
      ok(res, fm.create(req.tenantId, validate('formCreate', req.body)));
    }));
    app.get('/api/admin/forms/:id/stats', authAdmin, wrap(async (req, res) => {
      const f = fm.get(req.params.id);
      if (!f || f.tenantId !== req.tenantId) throw business('表单不存在');
      ok(res, fm.stats(req.params.id));
    }));

    app.get('/api/admin/appointments/services', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, am.listServices(req.tenantId).map(s => ({ ...s, price: s.price / 100 }))));
    }));
    app.post('/api/admin/appointments/services', authAdmin, wrap(async (req, res) => {
      ok(res, am.createService(req.tenantId, validate('appointmentServiceCreate', req.body)));
    }));
    app.get('/api/admin/appointments', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, am.listByTenant(req.tenantId, { date: req.query.date, status: req.query.status })));
    }));
    app.post('/api/admin/appointments/:id/complete', authAdmin, wrap(async (req, res) => {
      const appointment = store.findById('appointments', req.params.id);
      if (!appointment || appointment.tenantId !== req.tenantId) throw business('预约不存在');
      const updated = am.complete(req.params.id, req.tenantId);
      audit(req, 'appointment.complete', 'appointment', req.params.id, { serviceName: appointment.serviceName });
      ok(res, updated);
    }));
    app.post('/api/admin/appointments/:id/cancel', authAdmin, wrap(async (req, res) => {
      const appointment = store.findById('appointments', req.params.id);
      if (!appointment || appointment.tenantId !== req.tenantId) throw business('预约不存在');
      const updated = am.cancel(req.params.id);
      audit(req, 'appointment.cancel', 'appointment', req.params.id, { serviceName: appointment.serviceName });
      ok(res, updated);
    }));

    app.get('/api/admin/audit-logs', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, auditLog.listByTenant(req.tenantId, { action: req.query.action, actorType: req.query.actorType })));
    }));

    // 对账：下载微信交易对账单并与本地订单比对（admin）
    app.get('/api/admin/reconciliation', authAdmin, wrap(async (req, res) => {
      ok(res, await reconciliation.reconcile(req.query.date));
    }));

    app.get('/api/admin/system', authAdmin, wrap(async (req, res) => {
      ok(res, {
        name: '邻里团SaaS',
        version: '1.0.0',
        wechatMock: wechat.mock,
        tenantId: req.tenantId,
        uptime: process.uptime(),
        nodeVersion: process.version,
        lowStockThreshold: config.inventory.lowStockThreshold,
        endingSoonHours: config.today.endingSoonHours,
        subscribeEvents: notifications.listTemplates()
      });
    }));

    app.get('/api/admin/subscriptions', authAdmin, wrap(async (req, res) => {
      const recent = store.find('notifications', n => n.tenantId === req.tenantId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 20);
      ok(res, { templates: notifications.listTemplates(), recent });
    }));

    // 前端页面
    const path = require('path');
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '..', 'web', 'templates', 'index.html'));
    });
    app.use('/static', require('express').static(path.join(__dirname, '..', 'web', 'static')));

    app.get('/healthz', (req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()), collections: store ? [...store.collections.keys()].length : 0 }));
  }

  _priceView(p) {
    return {
      ...p,
      price: p.price / 100,
      originalPrice: p.originalPrice / 100
    };
  }

  _couponView(c) {
    return {
      ...c,
      threshold: c.threshold / 100,
      amount: c.amount / 100
    };
  }
}

module.exports = ApiService;

