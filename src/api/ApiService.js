/**
 * REST API 服务
 * 分两组：
 *  - /api/admin/*   管理后台（商家使用，需管理员令牌）
 *  - /api/wx/*      小程序端（微信用户使用，需会员令牌；公开目录除外）
 * 会员与管理员身份一律从签名令牌推导，不再信任客户端自报的 memberId / X-Tenant-Id
 */
const { AppError, toAppError, business } = require('../errors');
const { validate } = require('../validation');
const seed = require('../core/seed');
const crypto = require('crypto');
const { randomUUID } = crypto;
class ApiService {
  constructor(app, deps) {
    this.app = app;
    this.deps = deps;
  }

  registerRoutes() {
    const { app } = this;
    const { store, config, tenantManager, storeService, auth, adminService, productManager: pm, orderManager: om,
            memberManager: mm, pointsManager: pts, couponManager: cm, groupBuyManager: gbm,
            formManager: fm, appointmentManager: am, statsService: stats, todayService,
            notifications, auditLog, reconciliation, wechat, monitoring, afterSales, growth, reports,
            onboarding, locations, platform, outbox, assets, auditArchive } = this.deps;

    // ---------- 通用工具 ----------
    const ok = (res, data) => res.json({ success: true, data });
    const fail = (req, res, err) => {
      const appErr = toAppError(err);
      if (appErr.status >= 500 && monitoring) {
        monitoring.recordError('api', err, { requestId: req.id || '', path: req.originalUrl, method: req.method });
      }
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

    const authMember = async (req, res, next) => {
      try {
      const payload = auth.verify(bearer(req), 'member');
      if (!payload) return unauthorized(req, res);
      const tenant = await tenantManager.get(payload.tenantId);
      if (!tenant || ['suspended', 'closed'].includes(tenant.status)) {
        return res.status(403).json({ success: false, code: 'TENANT_UNAVAILABLE', error: '门店已暂停或关闭', requestId: req.id || null });
      }
      req.auth = payload;
      req.memberId = payload.sub;
      req.tenantId = payload.tenantId;
      next();
      } catch (error) { return fail(req, res, error); }
    };

    const authAdmin = async (req, res, next) => {
      try {
      const payload = auth.verify(bearer(req), 'admin');
      if (!payload) return unauthorized(req, res);
      const admin = await adminService.getById(payload.sub, payload.tenantId);
      if (!admin) return unauthorized(req, res);
      if (Number(payload.ver || 0) !== Number(admin.tokenVersion || 0)) return unauthorized(req, res, '登录已撤销，请重新登录');
      const tenant = await tenantManager.get(payload.tenantId);
      if (!tenant || ['suspended', 'closed'].includes(tenant.status)) {
        return res.status(403).json({ success: false, code: 'TENANT_UNAVAILABLE', error: '门店已暂停或关闭', requestId: req.id || null });
      }
      if (tenant.status === 'trialing' && tenant.trialEndsAt && new Date(tenant.trialEndsAt).getTime() <= Date.now()) {
        return res.status(403).json({ success: false, code: 'TRIAL_EXPIRED', error: '试用期已结束，请联系平台续费', requestId: req.id || null });
      }
      req.auth = payload;
      req.adminId = payload.sub;
      req.admin = admin;
      req.adminRole = admin.role;
      req.tenantId = payload.tenantId;
      next();
      } catch (error) { return fail(req, res, error); }
    };

    const authPlatform = async (req, res, next) => {
      try {
        const payload = auth.verify(bearer(req), 'platform');
        if (!payload) return unauthorized(req, res);
        const operator = await platform.getOperator(payload.sub);
        if (!operator || operator.status !== 'active') return unauthorized(req, res);
        if (Number(payload.ver || 0) !== Number(operator.tokenVersion || 0)) return unauthorized(req, res, '平台会话已撤销');
        req.auth = payload;
        req.platformOperator = operator;
        next();
      } catch (error) { return fail(req, res, error); }
    };

    const requireRole = (...roles) => (req, res, next) => {
      if (roles.includes(req.adminRole)) return next();
      return fail(req, res, AppError.forbidden('当前账号没有此操作权限'));
    };

    const paginate = (req, arr) => {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
      const total = arr.length;
      const start = (page - 1) * pageSize;
      return { list: arr.slice(start, start + pageSize), total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    };

    const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
    const audit = async (req, action, resource, resourceId, detail) => {
      return auditLog.record({
        tenantId: req.tenantId,
        actorType: req.auth ? req.auth.typ : 'admin',
        actorId: req.adminId || req.memberId || '',
        actorName: req.admin ? req.admin.username : '',
        action,
        resource,
        resourceId: resourceId || '',
        detail,
        ip: clientIp(req)
      });
    };

    // 管理端写操作要求同源或明确的 CORS 白名单来源。令牌不走 Cookie，Origin 校验作为纵深防御。
    app.use((req, res, next) => {
      const protectedWrite = req.path.startsWith('/api/admin') || req.path.startsWith('/api/platform');
      if (!protectedWrite || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
      const origin = req.headers.origin;
      if (!origin) return next();
      let originHost = '';
      try { originHost = new URL(origin).host; } catch (error) {}
      const sameHost = originHost && originHost === req.headers.host;
      const allowed = (config.cors.origins || []).includes(origin);
      if (!sameHost && !allowed) {
        return res.status(403).json({ success: false, code: 'ORIGIN_FORBIDDEN', error: '不接受的请求来源', requestId: req.id || null });
      }
      next();
    });

    const memberOf = async (req) => {
      const m = await mm.get(req.memberId);
      if (!m || m.tenantId !== req.tenantId) return null;
      return m;
    };

    const orderDetail = async (order) => {
      const [member, allAfterSales] = await Promise.all([
        mm.get(order.memberId),
        afterSales ? afterSales.listByTenant(order.tenantId) : []
      ]);
      const orderAfterSales = allAfterSales.filter(item => item.orderId === order.id);
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
        afterSales: orderAfterSales,
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
    const tenantOf = async (req) => {
      const id = req.headers['x-tenant-id'] || config.tenant.defaultId;
      const tenant = await tenantManager.get(id);
      if (!tenant || ['suspended', 'closed'].includes(tenant.status)) throw business('租户不存在或已停用');
      return id;
    };

    // ============ 小程序端 API ============

    // 微信登录（仅此接口不需要会员令牌）
    app.post('/api/wx/login', wrap(async (req, res) => {
      const body = validate('login', req.body);
      const tenantId = await tenantOf(req);
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
      const tenantId = await tenantOf(req);
      const [profile, publicLocations, categories, products, groupBuys] = await Promise.all([
        storeService.get(tenantId),
        locations ? locations.publicList(tenantId) : [],
        pm.listCategories(tenantId),
        pm.list(tenantId, { onSaleOnly: true }),
        gbm.list(tenantId)
      ]);
      ok(res, {
        tenant: profile,
        locations: publicLocations,
        categories,
        products: products.slice(0, 20).map(p => this._priceView(p)),
        groupBuys: groupBuys
          .filter(group => group.status === 'active' || group.status === 'success')
          .slice(0, 10)
      });
    }));
    app.get('/api/wx/locations', wrap(async (req, res) => {
      ok(res, locations ? await locations.publicList(await tenantOf(req)) : []);
    }));

    app.get('/api/wx/products', wrap(async (req, res) => {
      const list = (await pm.list(await tenantOf(req), {
        onSaleOnly: true,
        categoryId: req.query.categoryId,
        keyword: req.query.keyword
      })).map(p => this._priceView(p));
      ok(res, list);
    }));

    app.get('/api/wx/products/:id', wrap(async (req, res) => {
      const tenantId = await tenantOf(req);
      const p = await pm.get(req.params.id);
      if (!p || p.tenantId !== tenantId) throw business('商品不存在');
      ok(res, this._priceView(p));
    }));

    // 会员资料（身份来自令牌，路径 :id 必须与令牌一致）
    app.get('/api/wx/member/:id', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      const m = await memberOf(req);
      if (!m) return unauthorized(req, res);
      ok(res, {
        id: m.id, nickname: m.nickname, avatar: m.avatar, phone: m.phone,
        addresses: m.addresses, totalSpent: m.totalSpent, orderCount: m.orderCount,
        points: await pts.getBalance(m.id)
      });
    }));

    app.put('/api/wx/member/:id', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      ok(res, await mm.updateProfile(req.memberId, validate('memberUpdate', req.body)));
    }));

    app.post('/api/wx/member/:id/addresses', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      ok(res, await mm.addAddress(req.memberId, validate('addressCreate', req.body)));
    }));
    app.put('/api/wx/member/:id/addresses/:addressId', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      ok(res, await mm.updateAddress(req.memberId, req.params.addressId, validate('addressUpdate', req.body)));
    }));
    app.delete('/api/wx/member/:id/addresses/:addressId', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      ok(res, { removed: await mm.removeAddress(req.memberId, req.params.addressId) });
    }));

    app.get('/api/wx/member/:id/points', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      ok(res, {
        balance: await pts.getBalance(req.memberId),
        ledger: await pts.getLedger(req.memberId)
      });
    }));

    // 小程序在用户点击支付前获取模板 ID；未配置时返回空数组，不影响支付。
    app.get('/api/wx/subscriptions', authMember, wrap(async (req, res) => {
      const latest = (await store.find('subscriptionAuthorizations', item => item.tenantId === req.tenantId && item.memberId === req.memberId))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
      ok(res, {
        events: (await notifications.listTemplates(req.tenantId, ['orderPaid', 'orderDelivered', 'pickupReady', 'pickupReminder', 'pickupCompleted', 'refundSubmitted', 'refundCompleted', 'afterSalesSubmitted', 'afterSalesUpdated']))
          .filter(item => item.configured && item.enabled),
        authorization: latest ? { decisions: latest.decisions, accepted: latest.accepted, createdAt: latest.createdAt } : null
      });
    }));
    app.post('/api/wx/subscriptions/authorize', authMember, wrap(async (req, res) => {
      const body = validate('subscriptionAuthorize', req.body);
      const configured = await notifications.listTemplates(req.tenantId);
      const allowed = new Set(configured.map(item => item.templateId).filter(Boolean));
      const decisions = Object.fromEntries(Object.entries(body.decisions).filter(([templateId]) => allowed.has(templateId)));
      const record = {
        id: randomUUID(), tenantId: req.tenantId, memberId: req.memberId,
        decisions, accepted: Object.values(decisions).filter(value => value === 'accept').length,
        requested: Object.keys(decisions).length, createdAt: new Date().toISOString()
      };
      await store.insert('subscriptionAuthorizations', record);
      ok(res, record);
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
      ok(res, (await cm.listTemplates(await tenantOf(req))).filter(t => t.enabled).map(c => this._couponView(c)));
    }));
    app.post('/api/wx/coupons/claim', authMember, wrap(async (req, res) => {
      if (!(await memberOf(req))) return unauthorized(req, res);
      const tpl = await cm.getTemplate(req.body.templateId);
      if (!tpl || tpl.tenantId !== req.tenantId) throw business('优惠券不存在');
      ok(res, await cm.claim(req.body.templateId, req.memberId));
    }));
    app.get('/api/wx/member/:id/coupons', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      ok(res, await cm.listMine(req.memberId, req.query.status));
    }));

    // 订单
    app.post('/api/wx/orders', authMember, wrap(async (req, res) => {
      if (!(await memberOf(req))) return unauthorized(req, res);
      const body = validate('orderCreate', req.body);
      const order = await om.create(req.tenantId, req.memberId, body.items, body.options);
      ok(res, order);
    }));

    app.post('/api/wx/orders/:id/pay', authMember, wrap(async (req, res) => {
      ok(res, await om.pay(req.params.id, req.memberId));
    }));

    app.post('/api/wx/orders/:id/cancel', authMember, wrap(async (req, res) => {
      ok(res, await om.cancel(req.params.id, req.memberId, req.body.reason));
    }));

    app.post('/api/wx/orders/:id/complete', authMember, wrap(async (req, res) => {
      ok(res, await om.complete(req.params.id, req.memberId));
    }));

    app.post('/api/wx/orders/:id/refund', authMember, wrap(async (req, res) => {
      const o = await om.get(req.params.id);
      if (!o || o.memberId !== req.memberId) throw business('订单不存在');
      const amount = req.body.amount !== undefined ? Math.round(Number(req.body.amount) * 100) : undefined;
      ok(res, await om.refund(req.params.id, req.body.reason, amount));
    }));

    app.get('/api/wx/orders', authMember, wrap(async (req, res) => {
      ok(res, await om.listByMember(req.memberId, req.query.status));
    }));

    app.get('/api/wx/orders/:id', authMember, wrap(async (req, res) => {
      const o = await om.get(req.params.id);
      if (!o || o.memberId !== req.memberId) throw business('订单不存在');
      const memberAfterSales = afterSales ? await afterSales.listByMember(req.memberId) : [];
      ok(res, { ...o, afterSales: memberAfterSales.filter(item => item.orderId === o.id) });
    }));

    app.get('/api/wx/after-sales', authMember, wrap(async (req, res) => {
      ok(res, await afterSales.listByMember(req.memberId));
    }));
    app.post('/api/wx/orders/:id/after-sales', authMember, wrap(async (req, res) => {
      const o = await om.get(req.params.id);
      if (!o || o.memberId !== req.memberId) throw business('订单不存在');
      const body = validate('afterSalesCreate', req.body);
      if (body.amount !== undefined) body.amount = Math.round(Number(body.amount) * 100);
      ok(res, await afterSales.request(req.memberId, req.tenantId, o.id, body));
    }));
    app.post('/api/wx/after-sales/:id/cancel', authMember, wrap(async (req, res) => {
      ok(res, await afterSales.cancel(req.params.id, req.memberId));
    }));

    // 团购
    app.get('/api/wx/groupbuys', wrap(async (req, res) => {
      ok(res, await gbm.list(await tenantOf(req), req.query.status));
    }));
    app.get('/api/wx/groupbuys/:id', wrap(async (req, res) => {
      const tenantId = await tenantOf(req);
      const gb = await gbm.get(req.params.id);
      if (!gb || gb.tenantId !== tenantId) throw business('团购不存在');
      ok(res, gb);
    }));
    app.post('/api/wx/groupbuys/:id/join', authMember, wrap(async (req, res) => {
      if (!(await memberOf(req))) return unauthorized(req, res);
      const gb = await gbm.get(req.params.id);
      if (!gb || gb.tenantId !== req.tenantId) throw business('团购不存在');
      ok(res, await gbm.join(req.params.id, req.memberId));
    }));

    // 表单问卷
    app.get('/api/wx/forms', wrap(async (req, res) => {
      ok(res, (await fm.list(await tenantOf(req))).filter(f => f.status === 'open'));
    }));
    app.get('/api/wx/forms/:id', wrap(async (req, res) => {
      const tenantId = await tenantOf(req);
      const f = await fm.get(req.params.id);
      if (!f || f.tenantId !== tenantId) throw business('表单不存在');
      ok(res, f);
    }));
    app.post('/api/wx/forms/:id/submit', authMember, wrap(async (req, res) => {
      if (!(await memberOf(req))) return unauthorized(req, res);
      const f = await fm.get(req.params.id);
      if (!f || f.tenantId !== req.tenantId) throw business('表单不存在');
      ok(res, await fm.submit(req.params.id, req.memberId, validate('formSubmit', req.body).answers));
    }));

    // 预约
    app.get('/api/wx/appointments/services', wrap(async (req, res) => {
      ok(res, (await am.listServices(await tenantOf(req))).filter(s => s.enabled).map(s => ({ ...s, price: s.price / 100 })));
    }));
    app.get('/api/wx/appointments/slots', wrap(async (req, res) => {
      const tenantId = await tenantOf(req);
      const svc = await store.findById('appointmentServices', req.query.serviceId);
      if (!svc || svc.tenantId !== tenantId) throw business('服务不存在');
      ok(res, await am.querySlots(req.query.serviceId, req.query.date));
    }));
    app.post('/api/wx/appointments', authMember, wrap(async (req, res) => {
      if (!(await memberOf(req))) return unauthorized(req, res);
      const svc = await store.findById('appointmentServices', req.body.serviceId);
      if (!svc || svc.tenantId !== req.tenantId) throw business('服务不存在');
      const body = validate('appointmentBook', req.body);
      ok(res, await am.book(body.serviceId, req.memberId, body.date, body.slot, body.note));
    }));
    app.post('/api/wx/appointments/:id/cancel', authMember, wrap(async (req, res) => {
      ok(res, await am.cancel(req.params.id, req.memberId));
    }));
    app.get('/api/wx/member/:id/appointments', authMember, wrap(async (req, res) => {
      if (req.params.id !== req.memberId) return unauthorized(req, res);
      ok(res, await am.listByMember(req.memberId));
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
        if (orderNo) await om.handlePayNotifyVerified(orderNo, txId, total);
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
        await om.handleRefundNotifyVerified(payload);
        res.json({ code: 'SUCCESS', message: '成功' });
      } catch (e) {
        console.error('[退款回调] 处理失败:', e.message);
        res.status(400).json({ code: 'FAIL', message: e.message });
      }
    });

    // ============ 公开租户开通与平台运营 API ============

    app.post('/api/public/signup', wrap(async (req, res) => {
      if (!config.tenantOps.signupEnabled) throw business('当前未开放自助开通');
      const body = validate('tenantSignup', req.body);
      const result = await platform.signup(body);
      const owner = await adminService.getById(result.owner.id, result.tenant.id);
      await auditLog.record({
        tenantId: '__platform__', actorType: 'platform', actorId: result.owner.id,
        actorName: result.owner.username, action: 'tenant.signup', resourceId: result.tenant.id,
        detail: { planCode: body.planCode }, ip: clientIp(req)
      });
      ok(res, {
        tenant: result.tenant,
        owner: result.owner,
        token: auth.issueAdminToken(owner),
        store: await storeService.get(result.tenant.id)
      });
    }));

    app.post('/api/platform/login', wrap(async (req, res) => {
      const body = validate('platformLogin', req.body);
      const operator = await platform.authenticate(body.username, body.password);
      if (!operator) {
        await auditLog.record({
          tenantId: '__platform__', actorType: 'anonymous', actorName: body.username,
          action: 'platform.login-failed', ip: clientIp(req)
        });
        throw new AppError('平台账号或密码错误', { status: 401, code: 'INVALID_CREDENTIALS' });
      }
      await auditLog.record({
        tenantId: '__platform__', actorType: 'platform', actorId: operator.id, actorName: operator.username,
        action: 'platform.login', ip: clientIp(req)
      });
      ok(res, {
        token: auth.issuePlatformToken(operator),
        operatorId: operator.id,
        username: operator.username
      });
    }));

    app.get('/api/platform/session', authPlatform, wrap(async (req, res) => {
      ok(res, {
        operatorId: req.platformOperator.id,
        username: req.platformOperator.username,
        lastLoginAt: req.platformOperator.lastLoginAt || null
      });
    }));

    app.get('/api/platform/tenants', authPlatform, wrap(async (req, res) => {
      const tenants = await platform.listTenants();
      ok(res, paginate(req, tenants));
    }));
    app.get('/api/platform/tenants/:id', authPlatform, wrap(async (req, res) => {
      ok(res, await platform.getTenant(req.params.id));
    }));
    app.post('/api/platform/tenants', authPlatform, wrap(async (req, res) => {
      const result = await platform.createTenant(validate('platformTenantCreate', req.body));
      await auditLog.record({
        tenantId: '__platform__', actorType: 'platform', actorId: req.platformOperator.id,
        actorName: req.platformOperator.username, action: 'platform.tenant-create', resourceId: result.tenant.id,
        detail: { ownerUsername: result.owner.username }, ip: clientIp(req)
      });
      ok(res, result);
    }));
    app.patch('/api/platform/tenants/:id', authPlatform, wrap(async (req, res) => {
      ok(res, await platform.updateTenant(req.params.id, validate('platformTenantUpdate', req.body)));
    }));
    app.post('/api/platform/tenants/:id/plan', authPlatform, wrap(async (req, res) => {
      ok(res, await platform.changePlan(req.params.id, validate('platformPlanChange', req.body).planCode));
    }));
    app.get('/api/platform/plans', authPlatform, wrap(async (req, res) => {
      ok(res, await platform.plans());
    }));
    app.get('/api/platform/invoices', authPlatform, wrap(async (req, res) => {
      ok(res, paginate(req, await platform.invoices(req.query.tenantId)));
    }));
    app.post('/api/platform/tenants/:id/invoices', authPlatform, wrap(async (req, res) => {
      ok(res, await platform.createInvoice(req.params.id));
    }));
    app.patch('/api/platform/invoices/:id', authPlatform, wrap(async (req, res) => {
      const body = validate('platformInvoiceStatus', req.body);
      ok(res, await platform.markInvoice(req.params.id, body.status, body.note));
    }));

    // ============ 管理后台 API ============

    // 管理员登录
    app.post('/api/admin/login', async (req, res) => {
      try {
        const tenantId = await tenantOf(req);
        const tenant = await tenantManager.get(tenantId);
        if (tenant && ['suspended', 'closed'].includes(tenant.status)) {
          return res.status(403).json({ success: false, code: 'TENANT_UNAVAILABLE', error: '门店已暂停或关闭', requestId: req.id || null });
        }
        if (tenant && tenant.status === 'trialing' && tenant.trialEndsAt && new Date(tenant.trialEndsAt).getTime() <= Date.now()) {
          return res.status(403).json({ success: false, code: 'TRIAL_EXPIRED', error: '试用期已结束，请联系平台续费', requestId: req.id || null });
        }
        const admin = await adminService.authenticate(req.body.username, tenantId, req.body.password);
        if (!admin) {
          await auditLog.record({
            tenantId,
            actorType: 'anonymous',
            actorName: String(req.body.username || '').slice(0, 64),
            action: 'admin.login-failed',
            resource: 'admin',
            detail: { username: String(req.body.username || '').slice(0, 64) },
            ip: clientIp(req)
          });
          return res.status(401).json({
            success: false,
            code: 'INVALID_CREDENTIALS',
            error: '用户名或密码错误',
            requestId: req.id || null
          });
        }
        await auditLog.record({ tenantId, actorType: 'admin', actorId: admin.id, actorName: admin.username, action: 'admin.login', detail: { username: admin.username }, ip: clientIp(req) });
        return ok(res, {
          token: auth.issueAdminToken(admin),
          adminId: admin.id,
          username: admin.username,
          role: admin.role,
          status: admin.status || 'active',
          tenantId,
          store: await storeService.get(tenantId),
          demo: wechat.mock
        });
      } catch (e) {
        return fail(req, res, e);
      }
    });

    app.get('/api/admin/session', authAdmin, wrap(async (req, res) => {
      ok(res, {
        adminId: req.admin.id,
        username: req.admin.username,
        role: req.admin.role,
        status: req.admin.status || 'active',
        tenantId: req.tenantId,
        store: await storeService.get(req.tenantId),
        demo: wechat.mock
      });
    }));

    app.get('/api/admin/stats', authAdmin, wrap(async (req, res) => {
      ok(res, await stats.dashboard(req.tenantId));
    }));

    app.get('/api/admin/today', authAdmin, wrap(async (req, res) => {
      ok(res, await todayService.dashboard(req.tenantId));
    }));

    app.get('/api/admin/onboarding', authAdmin, wrap(async (req, res) => {
      ok(res, await onboarding.get(req.tenantId, req.adminId));
    }));
    app.post('/api/admin/onboarding/:step', authAdmin, wrap(async (req, res) => {
      ok(res, await onboarding.mark(req.tenantId, req.adminId, req.params.step, { name: req.admin.username }));
    }));

    app.get('/api/admin/growth', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      ok(res, await growth.memberInsights(req.tenantId));
    }));
    app.get('/api/admin/growth/materials', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      ok(res, await growth.materials(req.tenantId));
    }));

    app.get('/api/admin/reports', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
      ok(res, await reports.get(req.tenantId, { days, auditLog }));
    }));

    app.get('/api/admin/categories', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, await pm.listCategories(req.tenantId)));
    }));
    app.post('/api/admin/categories', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const category = await pm.createCategory(req.tenantId, validate('categoryCreate', req.body));
      await audit(req, 'category.create', 'category', category.id, { name: category.name });
      ok(res, category);
    }));
    app.put('/api/admin/categories/:id', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const category = (await pm.listCategories(req.tenantId)).find(item => item.id === req.params.id);
      if (!category) throw business('分类不存在');
      const updated = await pm.updateCategory(category.id, validate('categoryUpdate', req.body));
      await audit(req, 'category.update', 'category', category.id, { name: updated.name });
      ok(res, updated);
    }));
    app.delete('/api/admin/categories/:id', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const category = (await pm.listCategories(req.tenantId)).find(item => item.id === req.params.id);
      if (!category) throw business('分类不存在');
      const removed = await pm.removeCategory(category.id);
      await audit(req, 'category.delete', 'category', category.id, { name: category.name });
      ok(res, { removed });
    }));

    app.get('/api/admin/products', authAdmin, wrap(async (req, res) => {
      let products = await pm.list(req.tenantId, { keyword: req.query.keyword });
      if (req.query.stock === 'low') {
        products = products.filter(p => p.onSale && Number(p.stock) <= Number(config.inventory.lowStockThreshold));
      }
      ok(res, paginate(req, products.map(p => this._priceView(p))));
    }));
    app.get('/api/admin/products/:id', authAdmin, wrap(async (req, res) => {
      const p = await pm.get(req.params.id);
      if (!p || p.tenantId !== req.tenantId) throw business('商品不存在');
      const category = p.categoryId ? (await pm.listCategories(req.tenantId)).find(c => c.id === p.categoryId) : null;
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
    app.post('/api/admin/products', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const p = await pm.create(req.tenantId, validate('productCreate', req.body));
      await audit(req, 'product.create', 'product', p.id, { name: p.name });
      ok(res, this._priceView(p));
    }));
    app.put('/api/admin/products/:id', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const p = await pm.get(req.params.id);
      if (!p || p.tenantId !== req.tenantId) throw business('商品不存在');
      const updated = await pm.update(req.params.id, validate('productUpdate', req.body));
      await audit(req, 'product.update', 'product', req.params.id, { patch: req.body });
      ok(res, this._priceView(updated));
    }));
    app.get('/api/admin/products/:id/inventory-adjustments', authAdmin, wrap(async (req, res) => {
      const product = await pm.get(req.params.id);
      if (!product || product.tenantId !== req.tenantId) throw business('商品不存在');
      ok(res, await pm.listInventoryAdjustments(req.tenantId, product.id, 30));
    }));
    app.post('/api/admin/products/:id/inventory-adjustments', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const body = validate('inventoryAdjust', req.body);
      const record = await pm.adjustStock(req.tenantId, req.params.id, body, { id: req.adminId, name: req.admin.username });
      await audit(req, 'inventory.adjust', 'product', req.params.id, record);
      ok(res, record);
    }));
    app.post('/api/admin/inventory-adjustments/:id/undo', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const record = await pm.undoInventoryAdjustment(req.tenantId, req.params.id, { id: req.adminId, name: req.admin.username });
      await audit(req, 'inventory.adjust-undo', 'product', record.productId, record);
      ok(res, record);
    }));
    app.delete('/api/admin/products/:id', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const p = await pm.get(req.params.id);
      if (!p || p.tenantId !== req.tenantId) throw business('商品不存在');
      const removed = await pm.remove(req.params.id);
      await audit(req, 'product.delete', 'product', req.params.id, { name: p.name });
      ok(res, { removed });
    }));

    app.get('/api/admin/orders', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, await om.listByTenant(req.tenantId, { status: req.query.status, keyword: req.query.keyword })));
    }));
    app.get('/api/admin/orders/:id', authAdmin, wrap(async (req, res) => {
      const o = await om.get(req.params.id);
      if (!o || o.tenantId !== req.tenantId) throw business('订单不存在');
      ok(res, await orderDetail(o));
    }));
    app.post('/api/admin/orders/batch-deliver', authAdmin, requireRole('owner', 'manager', 'fulfillment'), wrap(async (req, res) => {
      const body = validate('orderBatchDeliver', req.body);
      const result = await om.batchDeliver(body.orderIds, {
        company: body.company,
        trackingNo: body.trackingNo
      }, req.tenantId);
      await audit(req, 'order.batch-deliver', 'order', body.orderIds.join(','), {
        company: body.company,
        trackingNo: body.trackingNo,
        successCount: result.successCount,
        failureCount: result.failureCount
      });
      ok(res, result);
    }));
    app.post('/api/admin/orders/:id/deliver', authAdmin, requireRole('owner', 'manager', 'fulfillment'), wrap(async (req, res) => {
      const o = await om.get(req.params.id);
      if (!o || o.tenantId !== req.tenantId) throw business('订单不存在');
      const logistics = validate('orderDeliver', req.body);
      const delivered = await om.deliver(req.params.id, logistics);
      await audit(req, 'order.deliver', 'order', req.params.id, { orderNo: o.orderNo });
      ok(res, delivered);
    }));
    app.post('/api/admin/orders/:id/verify-pickup', authAdmin, requireRole('owner', 'manager', 'fulfillment'), wrap(async (req, res) => {
      const o = await om.get(req.params.id);
      if (!o || o.tenantId !== req.tenantId) throw business('订单不存在');
      const body = validate('orderPickupVerify', req.body);
      const result = await om.verifyPickup(req.params.id, body.pickupCode, req.tenantId);
      await audit(req, 'order.verify-pickup', 'order', req.params.id, { orderNo: o.orderNo, alreadyCompleted: result.alreadyCompleted });
      ok(res, result);
    }));
    app.post('/api/admin/orders/:id/refund', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const o = await om.get(req.params.id);
      if (!o || o.tenantId !== req.tenantId) throw business('订单不存在');
      const body = validate('orderRefund', req.body);
      const amount = body.amount !== undefined ? Math.round(Number(body.amount) * 100) : undefined;
      const refunded = await om.refund(req.params.id, body.reason, amount);
      await audit(req, 'order.refund', 'order', req.params.id, { orderNo: o.orderNo, reason: body.reason, amount });
      ok(res, refunded);
    }));

    app.get('/api/admin/members', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, await mm.listByTenant(req.tenantId, req.query.keyword)));
    }));

    app.get('/api/admin/members/:id', authAdmin, wrap(async (req, res) => {
      const member = await mm.get(req.params.id);
      if (!member || member.tenantId !== req.tenantId) throw business('客户不存在');
      const [allOrders, coupons, appointments, formSubmissions, pointsBalance, pointsLedger] = await Promise.all([
        om.listByTenant(req.tenantId),
        cm.listMine(member.id),
        am.listByMember(member.id),
        store.find('formSubmissions', item => item.tenantId === req.tenantId && item.memberId === member.id),
        pts.getBalance(member.id),
        pts.getLedger(member.id, 20)
      ]);
      const orders = allOrders.filter(order => order.memberId === member.id);
      ok(res, {
        member,
        points: { balance: pointsBalance, ledger: pointsLedger },
        orders: orders.slice(0, 20),
        coupons,
        appointments: appointments.slice(0, 20),
        formSubmissions,
        summary: {
          orderCount: orders.length,
          paidAmount: orders.filter(order => ['paid', 'delivering', 'completed'].includes(order.status)).reduce((sum, order) => sum + order.payAmount, 0),
          unusedCoupons: coupons.filter(coupon => coupon.status === 'unused').length,
          upcomingAppointments: appointments.filter(item => item.status === 'booked').length
        }
      });
    }));

    app.post('/api/admin/members/:id/points', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const member = await mm.get(req.params.id);
      if (!member || member.tenantId !== req.tenantId) throw business('客户不存在');
      const body = validate('pointsAdjust', req.body);
      const balance = await pts.change(member.id, body.amount, body.reason, 'admin-adjustment');
      await audit(req, 'member.points-adjust', 'member', member.id, { amount: body.amount, reason: body.reason });
      ok(res, { balance });
    }));

    app.post('/api/admin/members/:id/coupons', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const member = await mm.get(req.params.id);
      if (!member || member.tenantId !== req.tenantId) throw business('客户不存在');
      const template = await cm.getTemplate(String(req.body.templateId || ''));
      if (!template || template.tenantId !== req.tenantId || !template.enabled) throw business('优惠券模板不存在或已停用');
      const coupon = await cm.claim(template.id, member.id);
      await audit(req, 'member.coupon-grant', 'member', member.id, { templateId: template.id, couponId: coupon.id });
      ok(res, coupon);
    }));

    app.get('/api/admin/points/rules', authAdmin, wrap(async (req, res) => {
      ok(res, config.points);
    }));

    app.get('/api/admin/coupons', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, (await cm.listTemplates(req.tenantId)).map(c => this._couponView(c))));
    }));
    app.post('/api/admin/coupons', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const c = await cm.createTemplate(req.tenantId, validate('couponCreate', req.body));
      await audit(req, 'coupon.create', 'coupon', c.id, { name: c.name });
      ok(res, c);
    }));
    app.put('/api/admin/coupons/:id', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const current = await cm.getTemplate(req.params.id);
      if (!current || current.tenantId !== req.tenantId) throw business('优惠券不存在');
      const coupon = await cm.updateTemplate(current.id, validate('couponUpdate', req.body));
      await audit(req, 'coupon.update', 'coupon', coupon.id, { enabled: coupon.enabled, name: coupon.name });
      ok(res, this._couponView(coupon));
    }));
    app.delete('/api/admin/coupons/:id', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const current = await cm.getTemplate(req.params.id);
      if (!current || current.tenantId !== req.tenantId) throw business('优惠券不存在');
      const removed = await cm.removeTemplate(current.id);
      await audit(req, 'coupon.delete', 'coupon', current.id, { name: current.name });
      ok(res, { removed });
    }));

    app.get('/api/admin/groupbuys', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, await gbm.list(req.tenantId)));
    }));
    app.post('/api/admin/groupbuys', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const g = await gbm.create(req.tenantId, validate('groupBuyCreate', req.body));
      await audit(req, 'groupbuy.create', 'groupbuy', g.id, { title: g.title });
      ok(res, g);
    }));
    app.post('/api/admin/groupbuys/:id/cancel', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const gb = await gbm.get(req.params.id);
      if (!gb || gb.tenantId !== req.tenantId) throw business('团购不存在');
      const cancelled = await gbm.cancel(req.params.id);
      await audit(req, 'groupbuy.cancel', 'groupbuy', req.params.id, { title: gb.title });
      ok(res, cancelled);
    }));
    app.put('/api/admin/groupbuys/:id', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const group = await gbm.update(req.params.id, req.tenantId, validate('groupBuyUpdate', req.body));
      await audit(req, 'groupbuy.update', 'groupbuy', group.id, { title: group.title, endAt: group.endAt, maxParticipants: group.maxParticipants });
      ok(res, group);
    }));

    app.get('/api/admin/after-sales', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, await afterSales.listByTenant(req.tenantId, { status: req.query.status, type: req.query.type })));
    }));
    app.put('/api/admin/after-sales/:id', authAdmin, requireRole('owner', 'manager', 'fulfillment'), wrap(async (req, res) => {
      const body = validate('afterSalesResolve', req.body);
      const updated = await afterSales.resolve(req.params.id, req.tenantId, body, { id: req.adminId, name: req.admin.username });
      await audit(req, 'after-sales.resolve', 'after-sales', updated.id, { status: updated.status, orderNo: updated.orderNo });
      ok(res, updated);
    }));

    app.get('/api/admin/forms', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, await fm.list(req.tenantId)));
    }));
    app.post('/api/admin/forms', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      ok(res, await fm.create(req.tenantId, validate('formCreate', req.body)));
    }));
    app.put('/api/admin/forms/:id', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const current = await fm.get(req.params.id);
      if (!current || current.tenantId !== req.tenantId) throw business('表单不存在');
      const form = await fm.update(current.id, validate('formUpdate', req.body));
      await audit(req, 'form.update', 'form', form.id, { title: form.title, status: form.status });
      ok(res, form);
    }));
    app.get('/api/admin/forms/:id/stats', authAdmin, wrap(async (req, res) => {
      const f = await fm.get(req.params.id);
      if (!f || f.tenantId !== req.tenantId) throw business('表单不存在');
      ok(res, await fm.stats(req.params.id));
    }));

    app.get('/api/admin/appointments/services', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, (await am.listServices(req.tenantId)).map(s => ({ ...s, price: s.price / 100 }))));
    }));
    app.post('/api/admin/appointments/services', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      ok(res, await am.createService(req.tenantId, validate('appointmentServiceCreate', req.body)));
    }));
    app.put('/api/admin/appointments/services/:id', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const service = await am.getService(req.params.id);
      if (!service || service.tenantId !== req.tenantId) throw business('服务不存在');
      const updated = await am.updateService(service.id, validate('appointmentServiceUpdate', req.body));
      await audit(req, 'appointment-service.update', 'appointment-service', service.id, { enabled: updated.enabled, name: updated.name });
      ok(res, { ...updated, price: updated.price / 100 });
    }));
    app.get('/api/admin/appointments', authAdmin, wrap(async (req, res) => {
      ok(res, paginate(req, await am.listByTenant(req.tenantId, { date: req.query.date, status: req.query.status })));
    }));
    app.post('/api/admin/appointments/:id/complete', authAdmin, requireRole('owner', 'manager', 'fulfillment'), wrap(async (req, res) => {
      const appointment = await store.findById('appointments', req.params.id);
      if (!appointment || appointment.tenantId !== req.tenantId) throw business('预约不存在');
      const updated = await am.complete(req.params.id, req.tenantId);
      await audit(req, 'appointment.complete', 'appointment', req.params.id, { serviceName: appointment.serviceName });
      ok(res, updated);
    }));
    app.post('/api/admin/appointments/:id/cancel', authAdmin, requireRole('owner', 'manager', 'fulfillment'), wrap(async (req, res) => {
      const appointment = await store.findById('appointments', req.params.id);
      if (!appointment || appointment.tenantId !== req.tenantId) throw business('预约不存在');
      const updated = await am.cancel(req.params.id);
      await audit(req, 'appointment.cancel', 'appointment', req.params.id, { serviceName: appointment.serviceName });
      ok(res, updated);
    }));

    app.get('/api/admin/audit-logs', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      ok(res, paginate(req, await auditLog.listByTenant(req.tenantId, { action: req.query.action, actorType: req.query.actorType })));
    }));
    app.get('/api/admin/audit-logs/verify', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      ok(res, await auditLog.verify(req.tenantId));
    }));

    // 对账：下载微信交易对账单并与本地订单比对（admin）
    app.get('/api/admin/reconciliation', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      ok(res, await reconciliation.reconcile(req.query.date, undefined, req.tenantId));
    }));

    app.get('/api/admin/exports/orders.csv', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const orders = await om.listByTenant(req.tenantId, { status: req.query.status, keyword: req.query.keyword });
      const quote = value => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
      const lines = ['订单号,下单时间,客户,状态,方式,实付金额,商品'];
      for (const order of orders) {
        const member = await mm.get(order.memberId);
        lines.push([
          order.orderNo,
          order.createdAt,
          member ? member.nickname : order.memberId,
          order.status,
          order.deliveryType === 'pickup' ? '自提' : '配送',
          (order.payAmount / 100).toFixed(2),
          (order.items || []).map(item => item.name + 'x' + item.quantity).join('|')
        ].map(quote).join(','));
      }
      await audit(req, 'order.export', 'order', '', { count: orders.length });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="orders-' + new Date().toISOString().slice(0, 10) + '.csv"');
      res.send('\uFEFF' + lines.join('\r\n'));
    }));

    app.get('/api/admin/system', authAdmin, wrap(async (req, res) => {
      const [metrics, storeProfile, subscribeEvents, readiness] = await Promise.all([
        monitoring ? monitoring.snapshot() : null,
        storeService.get(req.tenantId),
        notifications.listTemplates(req.tenantId),
        monitoring ? monitoring.readiness({
          store: async () => !!(await store.ping()),
          authSecret: () => !!config.auth.secret
        }) : null
      ]);
      ok(res, {
        name: '邻里团SaaS',
        version: '1.0.0',
        wechatMock: wechat.mock,
        tenantId: req.tenantId,
        admin: { username: req.admin.username, role: req.admin.role },
        store: storeProfile,
        uptime: process.uptime(),
        nodeVersion: process.version,
        lowStockThreshold: config.inventory.lowStockThreshold,
        endingSoonHours: config.today.endingSoonHours,
        subscribeEvents,
        metrics,
        readiness
      });
    }));

    app.get('/api/admin/system/diagnostics', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const [readiness, auditChain] = await Promise.all([
        monitoring.readiness({ store: async () => !!(await store.ping()) }),
        auditLog.verify(req.tenantId)
      ]);
      ok(res, { metrics: monitoring.snapshot(), readiness, auditChain });
    }));

    app.get('/api/admin/store', authAdmin, wrap(async (req, res) => {
      ok(res, await storeService.get(req.tenantId));
    }));

    app.put('/api/admin/store', authAdmin, requireRole('owner'), wrap(async (req, res) => {
      const storeProfile = await storeService.update(req.tenantId, validate('storeProfileUpdate', req.body));
      await audit(req, 'store.update', 'store', req.tenantId, { name: storeProfile.name });
      ok(res, storeProfile);
    }));

    app.get('/api/admin/admins', authAdmin, requireRole('owner'), wrap(async (req, res) => {
      ok(res, await adminService.listByTenant(req.tenantId));
    }));

    app.post('/api/admin/admins', authAdmin, requireRole('owner'), wrap(async (req, res) => {
      const admin = await adminService.create(req.tenantId, validate('adminCreate', req.body));
      await audit(req, 'admin.create', 'admin', admin.id, { username: admin.username, role: admin.role });
      ok(res, admin);
    }));

    app.put('/api/admin/admins/:id', authAdmin, requireRole('owner'), wrap(async (req, res) => {
      const admin = await adminService.update(req.params.id, req.tenantId, validate('adminUpdate', req.body), req.adminId);
      await audit(req, 'admin.update', 'admin', admin.id, { username: admin.username, role: admin.role, status: admin.status });
      ok(res, admin);
    }));

    app.post('/api/admin/admins/:id/revoke-sessions', authAdmin, requireRole('owner'), wrap(async (req, res) => {
      const admin = await adminService.revokeSessions(req.params.id, req.tenantId);
      await audit(req, 'admin.revoke-sessions', 'admin', admin.id, { username: admin.username });
      ok(res, { revokedAt: admin.sessionsRevokedAt });
    }));
    app.post('/api/admin/session/revoke', authAdmin, wrap(async (req, res) => {
      const admin = await adminService.revokeSessions(req.adminId, req.tenantId);
      await audit(req, 'admin.revoke-own-sessions', 'admin', admin.id, { username: admin.username });
      ok(res, { revokedAt: admin.sessionsRevokedAt });
    }));

    app.post('/api/admin/demo/reset', authAdmin, requireRole('owner'), wrap(async (req, res) => {
      if (!wechat.mock) throw business('仅模拟环境可重置演示数据');
      await seed.resetTenant(store, req.tenantId);
      await seed.run(store, pm, cm, fm, am, config, storeService, req.tenantId);
      await locations.initialize(req.tenantId);
      await audit(req, 'demo.reset', 'tenant', req.tenantId, { source: 'admin-ui' });
      ok(res, { reset: true });
    }));

    app.get('/api/admin/subscriptions', authAdmin, wrap(async (req, res) => {
      const [templates, notificationRows, authorizations] = await Promise.all([
        notifications.listTemplates(req.tenantId),
        store.find('notifications', n => n.tenantId === req.tenantId),
        store.find('subscriptionAuthorizations', item => item.tenantId === req.tenantId)
      ]);
      const recent = notificationRows
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 20);
      const counts = { accept: 0, reject: 0, ban: 0, filter: 0 };
      const members = new Set();
      const templateCounts = Object.fromEntries(templates.map(item => [item.templateId, {
        event: item.event, title: item.title, accept: 0, reject: 0, ban: 0, filter: 0
      }]));
      for (const authorization of authorizations) {
        if (authorization.memberId) members.add(authorization.memberId);
        for (const [templateId, decision] of Object.entries(authorization.decisions || {})) {
          if (!Object.prototype.hasOwnProperty.call(counts, decision)) continue;
          counts[decision] += 1;
          if (templateCounts[templateId]) templateCounts[templateId][decision] += 1;
        }
      }
      const totalDecisions = Object.values(counts).reduce((sum, value) => sum + value, 0);
      ok(res, {
        templates,
        recent,
        events: require('../core/NotificationService').EVENTS,
        authorizations: {
          records: authorizations.length,
          participants: members.size,
          totalDecisions,
          acceptRate: totalDecisions ? counts.accept / totalDecisions : 0,
          counts,
          templates: Object.values(templateCounts),
          latestAt: authorizations
            .map(item => item.createdAt)
            .filter(Boolean)
            .sort((a, b) => new Date(b) - new Date(a))[0] || null
        }
      });
    }));
    app.put('/api/admin/subscriptions/:event', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const template = await notifications.updateTemplate(req.tenantId, req.params.event, validate('notificationTemplateUpdate', req.body));
      await audit(req, 'notification.template-update', 'notification-template', req.params.event, { templateId: template.templateId, enabled: template.enabled });
      ok(res, template);
    }));
    app.post('/api/admin/subscriptions/:event/test', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const result = await notifications.testTemplate(req.tenantId, req.params.event, req.body && req.body.memberId);
      await audit(req, 'notification.test', 'notification-template', req.params.event, { memberId: req.body && req.body.memberId });
      ok(res, result || { mock: wechat.mock, tested: true });
    }));

    app.get('/api/admin/locations', authAdmin, wrap(async (req, res) => {
      ok(res, await locations.list(req.tenantId));
    }));
    app.post('/api/admin/locations', authAdmin, requireRole('owner'), wrap(async (req, res) => {
      const location = await locations.create(req.tenantId, validate('locationCreate', req.body));
      await audit(req, 'location.create', 'location', location.id, { name: location.name, code: location.code });
      ok(res, location);
    }));
    app.put('/api/admin/locations/:id', authAdmin, requireRole('owner'), wrap(async (req, res) => {
      const location = await locations.update(req.params.id, req.tenantId, validate('locationUpdate', req.body));
      await audit(req, 'location.update', 'location', location.id, { name: location.name, status: location.status });
      ok(res, location);
    }));

    // 品牌素材、消息队列和审计归档运维入口。
    app.get('/api/admin/assets', authAdmin, wrap(async (req, res) => {
      ok(res, await assets.list(req.tenantId));
    }));
    app.post('/api/admin/assets', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const asset = await assets.upload(req.tenantId, { id: req.adminId, name: req.admin.username }, validate('assetUpload', req.body));
      await audit(req, 'asset.upload', 'brand-asset', asset.id, { kind: asset.kind, mimeType: asset.mimeType, size: asset.size, sha256: asset.sha256 });
      ok(res, asset);
    }));

    app.get('/api/admin/outbox/stats', authAdmin, wrap(async (req, res) => {
      ok(res, await outbox.stats(req.tenantId));
    }));
    app.get('/api/admin/outbox', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      let records = await store.find('notifications', item => item.tenantId === req.tenantId);
      if (req.query.status) records = records.filter(item => item.status === req.query.status);
      records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const data = paginate(req, records);
      data.list = data.list.map(item => ({
        id: item.id, event: item.event, title: item.title, status: item.status,
        attempts: item.attempts || 0, maxAttempts: item.maxAttempts || 0,
        nextAttemptAt: item.nextAttemptAt || null, error: item.error || '',
        deadLetteredAt: item.deadLetteredAt || null, sentAt: item.sentAt || null,
        createdAt: item.createdAt
      }));
      ok(res, data);
    }));
    app.post('/api/admin/outbox/:id/retry', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const record = await outbox.retry(req.params.id, req.tenantId);
      await audit(req, 'outbox.retry', 'notification', record.id, { event: record.event });
      ok(res, record);
    }));
    app.post('/api/admin/outbox/run', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const result = await outbox.processDue();
      await audit(req, 'outbox.run', 'notification', '', result);
      ok(res, result);
    }));

    app.get('/api/admin/audit-archive', authAdmin, requireRole('owner', 'manager'), wrap(async (req, res) => {
      const [integrity, archives] = await Promise.all([
        auditArchive.verify(req.tenantId),
        store.find('auditArchives', item => item.tenantId === req.tenantId)
      ]);
      ok(res, {
        enabled: !!config.auditArchive.enabled,
        storage: auditArchive.s3Enabled ? 's3-object-lock' : 'local-readonly',
        integrity,
        archives: archives.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20)
      });
    }));
    app.post('/api/admin/audit-archive/run', authAdmin, requireRole('owner'), wrap(async (req, res) => {
      const record = await auditArchive.archiveTenant(req.tenantId);
      await audit(req, 'audit.archive', 'audit-log', record ? record.id : '', { archived: !!record });
      ok(res, record || { archived: false });
    }));

    // 前端页面
    const path = require('path');
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '..', 'web', 'templates', 'index.html'));
    });
    app.get('/shop', (req, res) => {
      res.sendFile(path.join(__dirname, '..', 'web', 'templates', 'shop.html'));
    });
    app.get('/platform', (req, res) => {
      res.sendFile(path.join(__dirname, '..', 'web', 'templates', 'platform.html'));
    });
    app.use('/static', require('express').static(path.join(__dirname, '..', 'web', 'static')));
    app.use('/uploads', require('express').static(path.resolve(config.uploads.dir), {
      fallthrough: false,
      immutable: true,
      maxAge: '30d',
      dotfiles: 'deny',
      index: false,
      setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff')
    }));

    app.get('/metrics', wrap(async (req, res) => {
      const expected = config.observability.metricsToken;
      const actual = bearer(req) || '';
      if (expected) {
        const a = Buffer.from(actual);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return unauthorized(req, res, '指标访问令牌无效');
      }
      const tenants = await tenantManager.list();
      let queued = 0;
      let failed = 0;
      let dead = 0;
      for (const tenant of tenants) {
        const stats = await outbox.stats(tenant.id);
        queued += Number(stats.queued || 0) + Number(stats.processing || 0);
        failed += Number(stats.failed || 0);
        dead += Number(stats.dead || 0);
      }
      monitoring.setGauge('outbox_queued', queued);
      monitoring.setGauge('outbox_failed', failed);
      monitoring.setGauge('outbox_dead_letters', dead);
      monitoring.setGauge('store_up', 1);
      res.type('text/plain').send(monitoring.prometheus());
    }));

    app.get('/healthz', (req, res) => res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    }));
    app.get('/readyz', wrap(async (req, res) => {
      const result = await monitoring.readiness({
        store: async () => !!(await store.ping()),
        auth: () => !!config.auth.secret
      });
      res.status(result.status === 'ok' ? 200 : 503).json(result);
    }));

    app.use('/api', (req, res) => res.status(404).json({
      success: false,
      code: 'NOT_FOUND',
      error: '接口不存在',
      requestId: req.id || null
    }));

    app.use((err, req, res, next) => {
      if (res.headersSent) return next(err);
      const status = Number(err.status || err.statusCode) || 500;
      if (monitoring && status >= 500) monitoring.recordError('express', err, { requestId: req.id || '', path: req.originalUrl });
      if (status === 404) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', error: '资源不存在', requestId: req.id || null });
      }
      if (status >= 400 && status < 500) {
        return res.status(status).json({ success: false, code: err.code || 'BAD_REQUEST', error: err.message || '请求无法处理', requestId: req.id || null });
      }
      res.status(500).json({ success: false, code: 'INTERNAL_ERROR', error: '服务暂时不可用', requestId: req.id || null });
    });
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

