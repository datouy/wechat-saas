/* 经营台领域模块：operations */
(function (A) {
  'use strict';
  var state = A.state;
  var ROUTES = A.ROUTES;
  var STATUS = A.STATUS;
  var byId = A.byId, esc = A.esc, money = A.money, yuan = A.yuan, canManage = A.canManage;
  var isOwner = A.isOwner, todayString = A.todayString, shortDate = A.shortDate, fullDate = A.fullDate;
  var safeAssetUrl = A.safeAssetUrl, percent = A.percent, statusTag = A.statusTag, orderStatusTag = A.orderStatusTag;
  var paramsObject = A.paramsObject, routeHref = A.routeHref, navigate = A.navigate, readRoute = A.readRoute;
  var request = A.request, requestAll = A.requestAll, categories = A.categories, applySession = A.applySession;
  var toast = A.toast, setHeader = A.setHeader, button = A.button, linkButton = A.linkButton;
  var loading = A.loading, empty = A.empty, errorState = A.errorState, pageInfo = A.pageInfo;
  var field = A.field, searchForm = A.searchForm, openDialog = A.openDialog, closeDialog = A.closeDialog;
  var closeAndRefresh = A.closeAndRefresh, loadRoute = A.loadRoute, logout = A.logout;

async function renderReports(params) {
    var days = Number(params.get('days') || 30);
    var data = await request('/api/admin/reports?days=' + encodeURIComponent(days));
    var operations = data.operations || {};
    var stores = data.stores || {};
    var maxDaily = Math.max.apply(null, (operations.daily || []).map(function (item) { return Number(item.count) || 0; }).concat([1]));
    var daily = (operations.daily || []).map(function (item) {
      return '<div class="report-bar-wrap"><div class="report-bar" style="height:' + Math.max(5, Math.round(Number(item.count) / maxDaily * 100)) + '%" title="' + esc(item.date) + ' · ' + Number(item.count) + ' 次"></div><span>' + esc(item.date.slice(5)) + '</span></div>';
    }).join('');
    var actions = (operations.actions || []).map(function (item) {
      return '<div class="report-action-row"><span>' + esc(AUDIT_LABELS[item.action] || item.action) + '</span><strong>' + Number(item.count) + '</strong></div>';
    }).join('') || empty('当前周期没有操作记录');
    var storeRows = (stores.locations || []).map(function (store) {
      return '<tr><td><div class="cell-primary">' + esc(store.name) + '</div><div class="cell-meta">' + esc(store.code || '') + '</div></td>' +
        '<td>' + Number(store.orders || 0) + '</td><td>' + Number(store.buyers || 0) + '</td><td>' + yuan(store.revenue || 0) + '</td><td>' + yuan(store.averageOrder || 0) + '</td>' +
        '<td><div class="share-meter"><span style="width:' + Number(store.share || 0) + '%"></span></div>' + Number(store.share || 0) + '%</td></tr>';
    }).join('');
    var rangeOptions = [7, 30, 90].map(function (value) { return '<a class="filter-tab ' + (value === days ? 'active' : '') + '" href="' + routeHref('reports', params, { days: value }) + '">近 ' + value + ' 天</a>'; }).join('');
    byId('content').innerHTML = '<div class="page-intro"><div class="filter-tabs">' + rangeOptions + '</div></div>' +
      '<div class="report-grid"><section class="panel-card"><div class="panel-head"><h3>近 ' + Number(days) + ' 天关键动作</h3><strong>' + Number(operations.total || 0) + '<small>次</small></strong></div><div class="report-chart">' + daily + '</div><div class="report-action-list">' + actions + '</div></section>' +
      '<section class="panel-card"><div class="panel-head"><h3>导出与责任边界</h3></div><div class="capability-grid"><div class="metric-note"><span>有导出权限</span><strong>所有者 / 经营管理员</strong></div><div class="metric-note"><span>导出留痕</span><strong>写入审计链</strong></div><div class="metric-note"><span>操作者</span><strong>' + Number(operations.uniqueActors || 0) + ' 人</strong></div><div class="metric-note"><span>审计完整性</span><strong>可在审计页核验</strong></div></div></section></div>' +
      '<div class="section-heading"><h3>履约门店对比</h3><span>收入按扣除已完成退款后的订单实付统计</span></div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>门店 / 渠道</th><th>订单</th><th>成交客户</th><th>净收入</th><th>客单价</th><th>收入占比</th></tr></thead><tbody>' + (storeRows || '<tr><td colspan="6">' + empty('当前周期没有可对比数据') + '</td></tr>') + '</tbody></table></div></div>';
  }

  var AUDIT_LABELS = {
    'admin.login': '登录后台', 'admin.login-failed': '后台登录失败', 'store.update': '更新门店资料', 'product.create': '新增商品', 'product.update': '更新商品',
    'product.delete': '删除商品', 'category.create': '新增分类', 'category.update': '更新分类', 'category.delete': '删除分类',
    'order.deliver': '订单发货', 'order.batch-deliver': '批量发货', 'order.verify-pickup': '自提核销', 'order.refund': '订单退款',
    'order.create': '创建订单', 'order.pay': '订单支付', 'order.cancel': '取消订单', 'order.complete': '订单完成',
    'refund.submit': '发起退款', 'refund.complete': '退款完成', 'points.change': '积分变动',
    'coupon.claim': '领取优惠券', 'coupon.reserve': '预留优惠券', 'coupon.release': '释放优惠券', 'coupon.use': '核销优惠券',
    'order.export': '导出订单', 'coupon.create': '新增优惠券', 'coupon.update': '更新优惠券', 'coupon.delete': '删除优惠券',
    'groupbuy.create': '发起团购', 'groupbuy.update': '调整团购', 'groupbuy.cancel': '结束团购', 'form.update': '更新问卷',
    'appointment-service.update': '更新预约服务', 'appointment.complete': '完成预约', 'appointment.cancel': '取消预约',
    'member.points-adjust': '调整会员积分', 'member.coupon-grant': '发放优惠券', 'admin.create': '新增员工',
    'admin.update': '更新员工', 'admin.revoke-sessions': '撤销员工会话', 'admin.revoke-own-sessions': '撤销本账号会话',
    'inventory.adjust': '调整库存', 'inventory.adjust-undo': '撤销库存调整',
    'after-sales.create': '提交售后', 'after-sales.cancel': '撤回售后', 'after-sales.approved': '受理售后',
    'after-sales.rejected': '拒绝售后', 'after-sales.resolved': '完成售后', 'after-sales.resolve': '更新售后',
    'notification.template-update': '更新消息模板', 'notification.test': '测试消息模板',
    'location.create': '新增履约门店', 'location.update': '更新履约门店', 'customer.view': '查看客户档案',
    'demo.reset': '重置演示数据'
  };

async function renderAuditLogs(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    if (!q.action) delete q.action;
    if (!q.actorType) delete q.actorType;
    var result = await Promise.all([
      request('/api/admin/audit-logs?' + new URLSearchParams(q).toString()),
      request('/api/admin/audit-logs/verify')
    ]);
    var data = result[0];
    var verify = result[1];
    var rows = (data.list || []).map(function (item) {
      var detail = item.detail || '';
      try {
        var parsed = detail ? JSON.parse(detail) : null;
        if (parsed && typeof parsed === 'object') detail = JSON.stringify(parsed);
      } catch (error) {}
      return '<tr><td class="cell-primary">' + esc(AUDIT_LABELS[item.action] || item.action) + '<div class="cell-meta">' + esc(item.action) + '</div></td>' +
        '<td>' + esc(item.actorName || item.actorType || '系统') + '</td><td>' + esc(item.resource || '—') + '<div class="cell-meta">' + esc(item.resourceId || '') + '</div></td>' +
        '<td class="audit-detail">' + esc(detail || '—') + '</td><td class="cell-nowrap">' + shortDate(item.createdAt) + '</td></tr>';
    }).join('');
    var actionOptions = '<option value="">全部操作</option>' + Object.keys(AUDIT_LABELS).map(function (key) {
      return '<option value="' + esc(key) + '" ' + (params.get('action') === key ? 'selected' : '') + '>' + esc(AUDIT_LABELS[key]) + '</option>';
    }).join('');
    var chainState = '<section class="audit-chain ' + (verify.valid ? 'valid' : 'invalid') + '"><div><span>' + (verify.valid ? '审计链完整' : '检测到审计链异常') + '</span><strong>' + Number(verify.checked || 0) + ' 条记录已核验</strong><small>' + (verify.headHash ? '链头 ' + esc(verify.headHash.slice(0, 16)) + '…' : '尚未产生审计记录') + '</small></div>' +
      ((verify.problems || []).length ? '<div class="audit-problems">' + verify.problems.map(function (item) { return '<p>' + esc(item.message) + ' · ' + esc(item.id || '') + '</p>'; }).join('') + '</div>' : '<b>SHA-256 链式校验通过</b>') + '</section>';
    byId('content').innerHTML = chainState + '<div class="toolbar">' +
      '<label class="inline-field"><span>操作类型</span><select id="auditActionFilter">' + actionOptions + '</select></label>' +
      '<label class="inline-field"><span>操作者</span><select id="auditActorFilter"><option value="">全部</option><option value="admin" ' + (params.get('actorType') === 'admin' ? 'selected' : '') + '>管理员</option><option value="member" ' + (params.get('actorType') === 'member' ? 'selected' : '') + '>顾客</option><option value="system" ' + (params.get('actorType') === 'system' ? 'selected' : '') + '>系统</option><option value="anonymous" ' + (params.get('actorType') === 'anonymous' ? 'selected' : '') + '>未登录</option></select></label>' +
      button('筛选', 'audit-filter', false) + '</div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>操作</th><th>操作者</th><th>对象</th><th>详情</th><th>时间</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5">' + empty('暂无审计记录') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('audit', params, { page: page }); }) + '</div>';
  }

async function renderReconciliation(params) {
    var date = params.get('date') || todayString();
    var data = await request('/api/admin/reconciliation?date=' + encodeURIComponent(date));
    var summary = data.summary || {};
    var discrepancyCount = Number(summary.missingInLocal || 0) + Number(summary.missingInBill || 0) + Number(summary.amountMismatch || 0) + Number(summary.refundMismatch || 0);
    function diffRows(title, list, renderer) {
      if (!list || !list.length) return '';
      return '<div class="diff-block"><div class="diff-title"><strong>' + esc(title) + '</strong><span>' + list.length + ' 项</span></div>' +
        list.map(function (item) { return '<div class="diff-row">' + renderer(item, money) + '</div>'; }).join('') + '</div>';
    }
    var differences = diffRows('账单有、本地无', data.missingInLocal, function (item, fmt) {
      return '<span>' + esc(item.orderNo) + '</span><b>' + fmt(item.amount) + '</b>';
    }) + diffRows('本地有、账单无', data.missingInBill, function (item, fmt) {
      return '<span>' + esc(item.orderNo) + '</span><b>' + fmt(item.amount) + '</b>';
    }) + diffRows('金额不一致', data.amountMismatch, function (item, fmt) {
      return '<span>' + esc(item.orderNo) + '</span><b>本地 ' + fmt(item.local) + ' / 账单 ' + fmt(item.bill) + '</b>';
    }) + diffRows('退款差异', data.refundMismatch, function (item, fmt) {
      return '<span>' + esc(item.orderNo) + '</span><b>本地 ' + fmt(item.localRefund) + ' / 账单 ' + fmt(item.billRefund) + '</b>';
    });
    byId('content').innerHTML = '<div class="page-intro">' +
      '<div class="reconcile-date"><label for="reconDate">交易日期</label><input id="reconDate" type="date" value="' + esc(date) + '">' + button('开始对账', 'reconcile-run', true) + '</div></div>' +
      '<section class="reconcile-result ' + (data.balanced ? 'balanced' : 'unbalanced') + '"><div><span>对账结果</span><strong>' + (data.balanced ? '账目一致' : '发现 ' + discrepancyCount + ' 项差异') + '</strong><small>' + esc(date) + ' · 共读取 ' + Number(summary.billRows || 0) + ' 条账单记录</small></div>' +
      '<div class="reconcile-metrics"><div><span>匹配支付</span><strong>' + Number(summary.matchedPayments || 0) + '</strong></div><div><span>退款记录</span><strong>' + Number(summary.refunds || 0) + '</strong></div><div><span>差异</span><strong>' + discrepancyCount + '</strong></div></div></section>' +
      (differences ? '<div class="section-heading"><h3>差异明细</h3></div><div class="diff-panel">' + differences + '</div>' : '<div class="callout" style="margin-top:18px">当前对账日未发现差异。</div>');
  }

async function renderOperations(params) {
    var status = params.get('status') || '';
    var outboxPath = '/api/admin/outbox?page=1&pageSize=20' + (status ? '&status=' + encodeURIComponent(status) : '');
    var results = await Promise.all([
      request('/api/admin/outbox/stats'),
      request(outboxPath),
      request('/api/admin/audit-archive'),
      request('/api/admin/subscriptions'),
      request('/api/admin/assets')
    ]);
    var stats = results[0] || {};
    var outbox = results[1] || { list: [], total: 0 };
    var archive = results[2] || { archives: [], integrity: {} };
    var subscriptions = results[3] || { authorizations: {}, templates: [] };
    var assets = results[4] || [];
    state.assetMap = {};
    assets.forEach(function (asset) { state.assetMap[asset.id] = asset; });
    var statusLabels = {
      queued: ['待发送', 'amber'], failed: ['等待重试', 'amber'], processing: ['发送中', 'blue'],
      dead: ['死信', 'red'], sent: ['已发送', 'green'], mocked: ['模拟完成', 'gray']
    };
    var outboxRows = (outbox.list || []).map(function (item) {
      var meta = statusLabels[item.status] || [item.status, 'gray'];
      var retry = ['failed', 'dead'].indexOf(item.status) >= 0
        ? button('重试', 'outbox-retry', false, 'data-id="' + esc(item.id) + '"')
        : '';
      return '<tr><td><div class="ops-primary"><strong>' + esc(item.title || item.event) + '</strong><small>' + esc(item.event) + '</small></div></td>' +
        '<td><span class="tag ' + meta[1] + '">' + esc(meta[0]) + '</span></td>' +
        '<td>' + Number(item.attempts || 0) + ' / ' + Number(item.maxAttempts || 0) + '</td>' +
        '<td>' + esc(item.error || '—') + '</td><td>' + fullDate(item.createdAt) + '</td><td>' + retry + '</td></tr>';
    }).join('') || '<tr><td colspan="6">' + empty('当前筛选下没有消息记录') + '</td></tr>';
    var authorizations = subscriptions.authorizations || {};
    var templateStats = (subscriptions.templates || []).map(function (item) {
      var matched = (authorizations.templates || []).find(function (stat) { return stat.event === item.event; }) || {};
      var accepted = Number(matched.accept || 0);
      var rejected = Number(matched.reject || 0);
      var blocked = Number(matched.ban || 0);
      var filtered = Number(matched.filter || 0);
      var total = accepted + rejected + blocked + filtered;
      return '<div class="auth-row"><div><strong>' + esc(item.title || item.event) + '</strong><small>' + esc(item.event) + ' · ' + (item.configured ? '模板已配置' : '模板待配置') + '</small></div>' +
        '<span class="auth-meter"><i><b style="width:' + (total ? Math.round(accepted / total * 100) : 0) + '%"></b></i><small>' + (total ? accepted + ' / ' + total + ' 已授权' : '暂无用户反馈') + '</small></span></div>';
    }).join('') || empty('还没有订阅模板');
    var archiveRows = (archive.archives || []).map(function (item) {
      return '<div class="archive-row"><div><strong>' + esc(item.objectKey || item.file || item.id) + '</strong><small>' + esc(item.storage || archive.storage || '') + ' · ' + Number(item.count || 0) + ' 条 · ' + shortDate(item.createdAt) + '</small></div>' +
        '<span class="tag ' + (item.verified === false ? 'red' : 'green') + '">' + (item.verified === false ? '校验异常' : '已归档') + '</span></div>';
    }).join('') || empty('还没有审计归档段，达到记录阈值后可手动归档');
    var assetCards = assets.slice(0, 8).map(function (asset) {
      var url = safeAssetUrl(asset.url);
      return '<article class="asset-card"><div class="asset-preview">' + (url ? '<img src="' + esc(url) + '" alt="' + esc(asset.originalName || asset.kind) + '">' : '无预览') + '</div><strong>' + esc(asset.kind) + '</strong><small>' + Number(asset.size || 0) + ' B · ' + shortDate(asset.createdAt) + '</small>' +
        (url ? button('复制地址', 'asset-copy', false, 'data-url="' + esc(url) + '"') : '') + '</article>';
    }).join('') || empty('还没有上传品牌素材');
    var dead = Number(stats.dead || 0);
    var integrity = archive.integrity || {};
    var filters = [['', '全部'], ['failed', '待重试'], ['dead', '死信'], ['queued', '待发送'], ['sent', '已发送']].map(function (item) {
      return '<a class="filter-tab ' + (status === item[0] ? 'active' : '') + '" href="' + routeHref('operations', null, { status: item[0] }) + '">' + item[1] + '</a>';
    }).join('');
    byId('content').innerHTML = '<div class="page-intro">' +
      '<div class="ops-state ' + (dead ? 'warning' : 'healthy') + '"><span></span><strong>' + (dead ? dead + ' 条死信待处理' : '核心异步链路正常') + '</strong><small>最后检查 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '</small></div></div>' +
      '<section class="ops-summary"><article><span>消息总量</span><strong>' + Number(stats.total || 0) + '</strong><small>待发送 ' + Number(stats.queued || 0) + ' · 发送中 ' + Number(stats.processing || 0) + '</small></article>' +
      '<article><span>待重试</span><strong>' + Number(stats.failed || 0) + '</strong><small>按指数退避自动重试</small></article><article><span>死信</span><strong>' + dead + '</strong><small>' + (dead ? '需要人工重试或核对模板' : '没有积压') + '</small></article>' +
      '<article><span>授权通过率</span><strong>' + percent(authorizations.acceptRate) + '</strong><small>' + Number(authorizations.participants || 0) + ' 位顾客已反馈</small></article></section>' +
      '<section class="settings-section"><div class="section-heading"><div><h3>通知出站队列</h3><span>发送失败不会阻塞订单；死信可人工重试，重复发送由状态锁控制。</span></div>' + button('立即运行一批', 'outbox-run', false) + '</div>' +
      '<div class="filter-bar">' + filters + '</div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>通知</th><th>状态</th><th>尝试</th><th>最近错误</th><th>创建时间</th><th>操作</th></tr></thead><tbody>' + outboxRows + '</tbody></table></div></div></section>' +
      '<div class="ops-grid"><section class="settings-section"><div class="section-heading"><div><h3>审计归档</h3><span>' + (archive.storage === 's3-object-lock' ? 'S3 Object Lock 合规保留' : '本地只读段文件') + '</span></div>' + (isOwner() ? button('立即归档', 'archive-run', false) : '') + '</div>' +
      '<div class="archive-status ' + (integrity.valid ? 'valid' : 'invalid') + '"><strong>' + (integrity.valid ? '审计链与归档段一致' : '发现完整性异常') + '</strong><small>' + Number(integrity.entries || 0) + ' 条已归档 · ' + Number(integrity.archives || 0) + ' 个分段</small></div><div class="archive-list">' + archiveRows + '</div></section>' +
      '<section class="settings-section"><div class="section-heading"><div><h3>顾客订阅授权</h3><span>每次授权回传逐模板结果，支付动作不被订阅弹窗阻塞。</span></div></div><div class="auth-summary"><strong>' + Number(authorizations.records || 0) + '</strong><span>次授权反馈</span><small>接受 ' + Number((authorizations.counts || {}).accept || 0) + ' · 拒绝 ' + Number((authorizations.counts || {}).reject || 0) + ' · 屏蔽 ' + Number((authorizations.counts || {}).ban || 0) + '</small></div><div class="auth-list">' + templateStats + '</div></section></div>' +
      '<section class="settings-section"><div class="section-heading"><div><h3>品牌素材</h3><span>上传会校验真实图片签名并写入租户隔离目录。</span></div><button class="button" data-action="operations-assets">管理素材</button></div><div class="asset-grid">' + assetCards + '</div></section>';
  }

  A.register({
    routes: { reports: renderReports, audit: renderAuditLogs, reconciliation: renderReconciliation, operations: renderOperations },
    headers: { reports: function () { return button('刷新', 'refresh-route', false); },
      audit: function () { return button('刷新', 'refresh-route', false); },
      reconciliation: function () { return button('刷新', 'refresh-route', false); },
      operations: function () { return button('刷新', 'refresh-route', false); } },
    actions: {
      'audit-filter': function () {
        var params = {};
        var action = byId('auditActionFilter').value;
        var actorType = byId('auditActorFilter').value;
        if (action) params.action = action;
        if (actorType) params.actorType = actorType;
        params.page = '1';
        navigate('audit', params);
      },
      'reconcile-run': function () {
        var date = byId('reconDate').value;
        if (!date) throw new Error('请选择交易日期');
        navigate('reconciliation', { date: date });
      },
      'operations-assets': function () { navigate('settings'); },
      'outbox-run': async function () {
        var result = await request('/api/admin/outbox/run', { method: 'POST', body: {} });
        toast('已检查 ' + Number(result.checked || 0) + ' 条消息，成功 ' + Number(result.sent || 0) + ' 条');
        return loadRoute();
      },
      'outbox-retry': async function (node) {
        await request('/api/admin/outbox/' + encodeURIComponent(node.getAttribute('data-id')) + '/retry', { method: 'POST', body: {} });
        toast('消息已重新入队');
        return loadRoute();
      },
      'archive-run': async function () {
        var result = await request('/api/admin/audit-archive/run', { method: 'POST', body: {} });
        toast(result && result.archived === false ? '当前没有新的审计记录可归档' : '审计归档段已完成并校验');
        return loadRoute();
      }
    }
  });
})(window.AdminRuntime);
