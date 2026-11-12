/**
 * REST API 服务
 * 分两组：
 *  - /api/admin/*   管理后台（商家使用）
 *  - /api/wx/*      小程序端（微信用户使用）
 * 多商户通过 X-Tenant-Id 请求头隔离（默认使用配置中的默认商户）
 */
class ApiService {
  constructor(app, deps) {
    this.app = app;
    this.deps = deps; // { store, config, tenantManager, productManager, memberManager, pointsManager,
                      //   couponManager, orderManager, groupBuyManager, formManager, appointmentManager, statsService, wechat }
  }

  registerRoutes() {
    const { app } = this;

    // ---------- 通用工具 ----------
    const tenantOf = (req) => req.headers['x-tenant-id'] || this.deps.config.tenant.defaultId;
    const ok = (res, data) => res.json({ success: true, data });
    const fail = (res, err, code = 400) => res.status(code).json({ success: false, error: err.message || String(err) });
    const wrap = (fn) => async (req, res) => {
      try { await fn(req, res); } catch (e) { fail(res, e); }
    };

    const { productManager: pm, orderManager: om, memberManager: mm, pointsManager: pts,
            couponManager: cm, groupBuyManager: gbm, formManager: fm, appointmentManager: am,
            statsService: stats, wechat } = this.deps;

    // ============ 小程序端 API ============

    // 微信登录
    app.post('/api/wx/login', wrap(async (req, res) => {
      const member = await mm.loginByWechatCode(req.body.code, tenantOf(req));
      ok(res, {
        memberId: member.id,
        nickname: member.nickname,
        isNew: false,
        mock: wechat.mock,
        token: 'mt_' + Buffer.from(member.id).toString('base64')
      });
    }));

    // 店铺首页：分类+商品+进行中的团购
    app.get('/api/wx/home', wrap(async (req, res) => {
      const tenantId = tenantOf(req);
      ok(res, {
        tenant: { id: tenantId, name: this.deps.config.tenant.defaultName },
        categories: pm.listCategories(tenantId),
        products: pm.list(tenantId, { onSaleOnly: true }).slice(0, 20).map(p => this._priceView(p)),
        groupBuys: gbm.list(tenantId, 'active').slice(0, 10)
      });
    }));

    // 商品列表/详情
    app.get('/api/wx/products', wrap(async (req, res) => {
      const list = pm.list(tenantOf(req), {
        onSaleOnly: true,
        categoryId: req.query.categoryId,
        keyword: req.query.keyword
      }).map(p => this._priceView(p));
      ok(res, list);
    }));

    app.get('/api/wx/products/:id', wrap(async (req, res) => {
      const p = pm.get(req.params.id);
      if (!p) throw new Error('商品不存在');
      ok(res, this._priceView(p));
    }));

    // 会员资料
    app.get('/api/wx/member/:id', wrap(async (req, res) => {
      const m = mm.get(req.params.id);
      if (!m) throw new Error('会员不存在');
      ok(res, {
        id: m.id, nickname: m.nickname, avatar: m.avatar, phone: m.phone,
        addresses: m.addresses, totalSpent: m.totalSpent, orderCount: m.orderCount,
        points: pts.getBalance(m.id)
      });
    }));

    app.put('/api/wx/member/:id', wrap(async (req, res) => {
      ok(res, mm.updateProfile(req.params.id, req.body));
    }));

    // 收货地址
    app.post('/api/wx/member/:id/addresses', wrap(async (req, res) => {
      ok(res, mm.addAddress(req.params.id, req.body));
    }));
    app.delete('/api/wx/member/:id/addresses/:addressId', wrap(async (req, res) => {
      ok(res, { removed: mm.removeAddress(req.params.id, req.params.addressId) });
    }));

    // 积分
    app.get('/api/wx/member/:id/points', wrap(async (req, res) => {
      ok(res, {
        balance: pts.getBalance(req.params.id),
        ledger: pts.getLedger(req.params.id)
      });
    }));

    // 优惠券
    app.get('/api/wx/coupons/templates', wrap(async (req, res) => {
      ok(res, cm.listTemplates(tenantOf(req)).filter(t => t.enabled));
    }));
    app.post('/api/wx/coupons/claim', wrap(async (req, res) => {
      ok(res, cm.claim(req.body.templateId, req.body.memberId));
    }));
    app.get('/api/wx/member/:id/coupons', wrap(async (req, res) => {
      ok(res, cm.listMine(req.params.id, req.query.status));
    }));

    // 订单
    app.post('/api/wx/orders', wrap(async (req, res) => {
      const { memberId, items, options } = req.body;
      const order = om.create(tenantOf(req), memberId, items, options || {});
      ok(res, order);
    }));

    app.post('/api/wx/orders/:id/pay', wrap(async (req, res) => {
      const { memberId, openid } = req.body;
      ok(res, await om.pay(req.params.id, memberId, openid));
    }));

    app.post('/api/wx/orders/:id/cancel', wrap(async (req, res) => {
      ok(res, om.cancel(req.params.id, req.body.memberId, req.body.reason));
    }));

    app.post('/api/wx/orders/:id/complete', wrap(async (req, res) => {
      ok(res, om.complete(req.params.id, req.body.memberId));
    }));

    app.get('/api/wx/orders', wrap(async (req, res) => {
      ok(res, om.listByMember(req.query.memberId, req.query.status));
    }));

    app.get('/api/wx/orders/:id', wrap(async (req, res) => {
      const o = om.get(req.params.id);
      if (!o) throw new Error('订单不存在');
      ok(res, o);
    }));

    // 团购
    app.get('/api/wx/groupbuys', wrap(async (req, res) => {
      ok(res, gbm.list(tenantOf(req), req.query.status));
    }));
    app.get('/api/wx/groupbuys/:id', wrap(async (req, res) => {
      const gb = gbm.get(req.params.id);
      if (!gb) throw new Error('团购不存在');
      ok(res, gb);
    }));
    app.post('/api/wx/groupbuys/:id/join', wrap(async (req, res) => {
      ok(res, gbm.join(req.params.id, req.body.memberId));
    }));

    // 表单问卷
    app.get('/api/wx/forms', wrap(async (req, res) => {
      ok(res, fm.list(tenantOf(req)).filter(f => f.status === 'open'));
    }));
    app.get('/api/wx/forms/:id', wrap(async (req, res) => {
      const f = fm.get(req.params.id);
      if (!f) throw new Error('表单不存在');
      ok(res, f);
    }));
    app.post('/api/wx/forms/:id/submit', wrap(async (req, res) => {
      ok(res, fm.submit(req.params.id, req.body.memberId, req.body.answers));
    }));

    // 预约
    app.get('/api/wx/appointments/services', wrap(async (req, res) => {
      ok(res, am.listServices(tenantOf(req)).filter(s => s.enabled).map(s => ({ ...s, price: s.price / 100 })));
    }));
    app.get('/api/wx/appointments/slots', wrap(async (req, res) => {
      ok(res, am.querySlots(req.query.serviceId, req.query.date));
    }));
    app.post('/api/wx/appointments', wrap(async (req, res) => {
      ok(res, am.book(req.body.serviceId, req.body.memberId, req.body.date, req.body.slot, req.body.note));
    }));
    app.post('/api/wx/appointments/:id/cancel', wrap(async (req, res) => {
      ok(res, am.cancel(req.params.id, req.body.memberId));
    }));
    app.get('/api/wx/member/:id/appointments', wrap(async (req, res) => {
      ok(res, am.listByMember(req.params.id));
    }));

    // 微信支付异步通知（真实模式接入点）
    app.post('/api/wx/pay/notify', wrap(async (req, res) => {
      const orderNo = req.body.out_trade_no || (req.body.resource && req.body.resource.out_trade_no);
      const txId = req.body.transaction_id || '';
      if (orderNo) om.handlePayNotify(orderNo, txId);
      res.json({ code: 'SUCCESS', message: '成功' });
    }));

    // ============ 管理后台 API ============

    // 经营看板
    app.get('/api/admin/stats', wrap(async (req, res) => {
      ok(res, stats.dashboard(tenantOf(req)));
    }));

    // 分类
    app.get('/api/admin/categories', wrap(async (req, res) => {
      ok(res, pm.listCategories(tenantOf(req)));
    }));
    app.post('/api/admin/categories', wrap(async (req, res) => {
      ok(res, pm.createCategory(tenantOf(req), req.body));
    }));

    // 商品
    app.get('/api/admin/products', wrap(async (req, res) => {
      ok(res, pm.list(tenantOf(req), { keyword: req.query.keyword }).map(p => this._priceView(p)));
    }));
    app.post('/api/admin/products', wrap(async (req, res) => {
      ok(res, this._priceView(pm.create(tenantOf(req), req.body)));
    }));
    app.put('/api/admin/products/:id', wrap(async (req, res) => {
      ok(res, this._priceView(pm.update(req.params.id, req.body)));
    }));
    app.delete('/api/admin/products/:id', wrap(async (req, res) => {
      ok(res, { removed: pm.remove(req.params.id) });
    }));

    // 订单
    app.get('/api/admin/orders', wrap(async (req, res) => {
      ok(res, om.listByTenant(tenantOf(req), { status: req.query.status, keyword: req.query.keyword }));
    }));
    app.post('/api/admin/orders/:id/deliver', wrap(async (req, res) => {
      ok(res, om.deliver(req.params.id));
    }));

    // 会员
    app.get('/api/admin/members', wrap(async (req, res) => {
      ok(res, mm.listByTenant(tenantOf(req), req.query.keyword));
    }));

    // 积分规则与流水
    app.get('/api/admin/points/rules', wrap(async (req, res) => {
      ok(res, this.deps.config.points);
    }));

    // 优惠券
    app.get('/api/admin/coupons', wrap(async (req, res) => {
      ok(res, cm.listTemplates(tenantOf(req)));
    }));
    app.post('/api/admin/coupons', wrap(async (req, res) => {
      ok(res, cm.createTemplate(tenantOf(req), req.body));
    }));

    // 团购
    app.get('/api/admin/groupbuys', wrap(async (req, res) => {
      ok(res, gbm.list(tenantOf(req)));
    }));
    app.post('/api/admin/groupbuys', wrap(async (req, res) => {
      ok(res, gbm.create(tenantOf(req), req.body));
    }));
    app.post('/api/admin/groupbuys/:id/cancel', wrap(async (req, res) => {
      ok(res, gbm.cancel(req.params.id));
    }));

    // 表单
    app.get('/api/admin/forms', wrap(async (req, res) => {
      ok(res, fm.list(tenantOf(req)));
    }));
    app.post('/api/admin/forms', wrap(async (req, res) => {
      ok(res, fm.create(tenantOf(req), req.body));
    }));
    app.get('/api/admin/forms/:id/stats', wrap(async (req, res) => {
      ok(res, fm.stats(req.params.id));
    }));

    // 预约
    app.get('/api/admin/appointments/services', wrap(async (req, res) => {
      ok(res, am.listServices(tenantOf(req)).map(s => ({ ...s, price: s.price / 100 })));
    }));
    app.post('/api/admin/appointments/services', wrap(async (req, res) => {
      ok(res, am.createService(tenantOf(req), req.body));
    }));
    app.get('/api/admin/appointments', wrap(async (req, res) => {
      ok(res, am.listByTenant(tenantOf(req), {
        date: req.query.date,
        status: req.query.status
      }));
    }));

    // 系统信息
    app.get('/api/admin/system', wrap(async (req, res) => {
      ok(res, {
        name: '邻里团SaaS',
        version: '1.0.0',
        wechatMock: wechat.mock,
        tenantId: tenantOf(req),
        uptime: process.uptime(),
        nodeVersion: process.version
      });
    }));

    // 前端页面
    const path = require('path');
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '..', 'web', 'templates', 'index.html'));
    });
    this.app.use('/static', require('express').static(path.join(__dirname, '..', 'web', 'static')));

    // 健康检查
    this.app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  }

  _priceView(p) {
    return {
      ...p,
      price: p.price / 100,
      originalPrice: p.originalPrice / 100
    };
  }
}

module.exports = ApiService;
