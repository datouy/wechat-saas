(function () {
  'use strict';

  var ROUTES = {
    today: '今天',
    products: '商品',
    orders: '订单',
    customers: '客户',
    'group-buys': '团购',
    coupons: '优惠券',
    surveys: '问卷',
    appointments: '预约',
    'after-sales': '售后工单',
    growth: '会员增长',
    reports: '经营报表',
    operations: '运营保障',
    audit: '审计日志',
    reconciliation: '交易对账',
    settings: '设置'
  };
  var ALIASES = {
    dashboard: 'today',
    members: 'customers',
    groupbuys: 'group-buys',
    forms: 'surveys',
    insights: 'growth',
    aftersales: 'after-sales'
  };
  var STATUS = {
    pending: ['待支付', 'amber'],
    paid: ['已支付', 'blue'],
    delivering: ['配送中', 'blue'],
    completed: ['已完成', 'green'],
    cancelled: ['已取消', 'gray'],
    refunded: ['已退款', 'red'],
    refunding: ['退款中', 'red']
  };
  var state = {
    route: 'today',
    categories: null,
    selectedOrders: new Set(),
    selectableOrders: [],
    visibleOrderIds: [],
    surveyFields: [],
    loadId: 0,
    session: null,
    store: null,
    couponMap: {},
    formMap: {},
    serviceMap: {},
    staffMap: {},
    afterSalesMap: {},
    groupBuyMap: {},
    locationMap: {},
    templateMap: {},
    assetMap: {},
    growthMaterials: []
  };
  var ROLE_LABELS = { owner: '所有者', manager: '经营管理员', fulfillment: '履约专员' };
  var toastTimer = null;

  function byId(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function money(cents) { return '¥' + (Number(cents || 0) / 100).toFixed(2); }
  function yuan(value) { return '¥' + Number(value || 0).toFixed(2); }
  function roleAllowed(roles) {
    return !!state.session && roles.split(',').indexOf(state.session.role) >= 0;
  }
  function canManage() { return roleAllowed('owner,manager'); }
  function isOwner() { return roleAllowed('owner'); }
  function todayString() {
    var parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + '-' + values.month + '-' + values.day;
  }
  function shortDate(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return esc(value);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function fullDate(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return esc(value);
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function safeAssetUrl(value) {
    var raw = String(value || '').trim();
    if (/^\/(?:uploads|static)\//.test(raw)) return raw;
    if (/^https:\/\/[^\s]+$/i.test(raw)) return raw;
    return '';
  }
  function percent(value) { return (Number(value || 0) * 100).toFixed(1) + '%'; }
  function statusTag(status) {
    var item = STATUS[status] || [status || '未知', 'gray'];
    return '<span class="tag ' + item[1] + '">' + esc(item[0]) + '</span>';
  }
  function paramsObject(params) {
    var out = {};
    params.forEach(function (value, key) { out[key] = value; });
    return out;
  }
  function routeHref(route, params, changes) {
    var q = new URLSearchParams(params || undefined);
    Object.keys(changes || {}).forEach(function (key) {
      var value = changes[key];
      if (value === undefined || value === null || value === '') q.delete(key);
      else q.set(key, String(value));
    });
    var query = q.toString();
    return '#/' + route + (query ? '?' + query : '');
  }
  function navigate(route, params) {
    var next = routeHref(route, params);
    if (location.hash === next) loadRoute();
    else location.hash = next;
  }
  function readRoute() {
    var raw = location.hash.replace(/^#/, '') || '/today';
    var parts = raw.split('?');
    var key = parts[0].replace(/^\/+/, '') || 'today';
    key = ALIASES[key] || key;
    if (!ROUTES[key]) key = 'today';
    return { key: key, params: new URLSearchParams(parts[1] || '') };
  }

  function token() { return localStorage.getItem('lt-admin-token') || ''; }
  async function request(path, options) {
    options = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (token()) headers.Authorization = 'Bearer ' + token();
    var response = await fetch(path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    var data = null;
    try { data = await response.json(); } catch (error) {}
    if (response.status === 401) {
      state.session = null;
      state.store = null;
      localStorage.removeItem('lt-admin-token');
      showLogin();
      throw new Error('登录已过期');
    }
    if (!response.ok || !data || !data.success) {
      var message = data && data.error ? data.error : '请求失败';
      if (data && data.details) {
        var first = Object.keys(data.details)[0];
        if (first && data.details[first] && data.details[first][0]) message = data.details[first][0];
      }
      if (data && data.requestId) message += '（追踪号 ' + data.requestId + '）';
      throw new Error(message);
    }
    return data.data;
  }
  async function requestAll(path, query) {
    var page = 1;
    var items = [];
    while (true) {
      var q = new URLSearchParams(query || undefined);
      q.set('page', page);
      q.set('pageSize', '100');
      var data = await request(path + '?' + q.toString());
      items = items.concat(data.list || []);
      if (!data.totalPages || page >= data.totalPages) break;
      page += 1;
    }
    return items;
  }

  function applySession(session) {
    state.session = session;
    state.store = session.store || null;
    if (state.store && state.store.name) {
      byId('sidebarStoreName').textContent = state.store.name;
      document.title = ROUTES[state.route] + ' · ' + state.store.name;
      if (/^#[0-9a-f]{6}$/i.test(state.store.brandColor || '')) {
        document.documentElement.style.setProperty('--accent', state.store.brandColor);
      }
    }
    document.querySelectorAll('[data-roles]').forEach(function (node) {
      var roles = String(node.getAttribute('data-roles') || '').split(',');
      node.classList.toggle('hidden', roles.indexOf(session.role) < 0);
    });
    byId('sidebarFoot').innerHTML = '<button type="button" class="sidebar-account" data-action="logout" title="退出登录">' +
      '<span class="status-dot ' + (session.demo ? 'warning' : '') + '"></span><span>' + esc(session.username) +
      ' · ' + esc(ROLE_LABELS[session.role] || session.role) + '</span><span class="account-exit">退出</span></button>';
  }

  async function ensureSession() {
    if (state.session) return state.session;
    var session = await request('/api/admin/session');
    applySession(session);
    return session;
  }
  async function categories() {
    if (state.categories) return state.categories;
    state.categories = await requestAll('/api/admin/categories');
    return state.categories;
  }

  function showLogin() {
    byId('loginOverlay').classList.remove('hidden');
    setTimeout(function () { byId('loginPass').focus(); }, 0);
  }
  function hideLogin() { byId('loginOverlay').classList.add('hidden'); }
  async function login(event) {
    event.preventDefault();
    var errorNode = byId('loginError');
    errorNode.textContent = '';
    try {
      var response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: byId('loginUser').value.trim(),
          password: byId('loginPass').value
        })
      });
      var data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '登录失败');
      localStorage.setItem('lt-admin-token', data.data.token);
      applySession(data.data);
      byId('loginPass').value = '';
      hideLogin();
      loadRoute();
    } catch (error) {
      errorNode.textContent = error.message;
    }
  }

  function toast(message, isError) {
    var node = byId('toast');
    node.textContent = message;
    node.className = 'toast' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.className = 'toast hidden'; }, 3200);
  }
  function setHeader(html) { byId('headerActions').innerHTML = html || ''; }
  function button(label, action, primary, attrs) {
    return '<button type="button" class="button ' + (primary ? 'primary' : '') + '" data-action="' + action + '" ' + (attrs || '') + '>' + label + '</button>';
  }
  function linkButton(label, href, attrs) {
    return '<a class="button" href="' + esc(href) + '" ' + (attrs || '') + '>' + label + '</a>';
  }
  function loading() { byId('content').innerHTML = '<div class="loading-state">正在加载</div>'; }
  function empty(message) { return '<div class="empty-state">' + esc(message) + '</div>'; }
  function errorState(message) {
    return '<div class="error-state">' + esc(message) + button('重试', 'refresh-route', false) + '</div>';
  }
  function pageInfo(data, onHref) {
    var start = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
    var end = Math.min(data.page * data.pageSize, data.total);
    var previous = data.page > 1 ? onHref(data.page - 1) : '';
    var next = data.page < data.totalPages ? onHref(data.page + 1) : '';
    return '<div class="pagination"><span>' + start + '–' + end + ' / ' + data.total + '</span>' +
      '<div class="page-actions">' +
      '<a class="page-link ' + (previous ? '' : 'disabled') + '" ' + (previous ? 'href="' + previous + '"' : 'aria-disabled="true"') + '>上一页</a>' +
      '<span class="page-link">' + data.page + ' / ' + Math.max(1, data.totalPages) + '</span>' +
      '<a class="page-link ' + (next ? '' : 'disabled') + '" ' + (next ? 'href="' + next + '"' : 'aria-disabled="true"') + '>下一页</a>' +
      '</div></div>';
  }
  function field(label, control, full) {
    return '<label class="form-field ' + (full ? 'full' : '') + '"><span class="field-label">' + label + '</span>' + control + '</label>';
  }
  function searchForm(placeholder, params) {
    return '<form class="search-form" data-search><input name="keyword" aria-label="' + esc(placeholder) + '" placeholder="' + esc(placeholder) + '" value="' + esc(params.get('keyword') || '') + '"></form>';
  }
  function openDialog(title, body, footer) {
    var dialog = byId('appDialog');
    byId('dialogTitle').textContent = title;
    byId('dialogBody').innerHTML = body;
    byId('dialogFooter').innerHTML = footer || '';
    if (dialog.open) dialog.close();
    dialog.showModal();
  }
  function closeDialog() {
    var dialog = byId('appDialog');
    if (dialog.open) dialog.close();
  }
  function closeAndRefresh() {
    closeDialog();
    loadRoute();
  }
  function setActive(route) {
    document.querySelectorAll('[data-nav]').forEach(function (node) {
      node.classList.toggle('active', node.getAttribute('data-nav') === route);
    });
    if (['group-buys', 'coupons', 'surveys', 'appointments', 'after-sales', 'growth', 'reports', 'operations', 'audit', 'reconciliation', 'settings'].indexOf(route) >= 0) byId('moreNav').open = true;
  }
  function renderHeader(route) {
    if (route === 'today') setHeader(button('刷新', 'refresh-route', false));
    else if (route === 'products') setHeader(canManage() ? button('分类管理', 'category-manage', false) + button('新增商品', 'product-new', true) : '');
    else if (route === 'orders') setHeader((canManage() ? button('导出 CSV', 'order-export', false) : '') + button('批量发货', 'batch-deliver', false, 'disabled'));
    else if (route === 'group-buys') setHeader(canManage() ? button('发起团购', 'groupbuy-new', true) : '');
    else if (route === 'coupons') setHeader(canManage() ? button('新建优惠券', 'coupon-new', true) : '');
    else if (route === 'surveys') setHeader(canManage() ? button('新建问卷', 'survey-new', true) : '');
    else if (route === 'appointments') setHeader(canManage() ? button('新增服务', 'appointment-service-new', true) : '');
    else if (route === 'after-sales' || route === 'growth' || route === 'reports') setHeader(button('刷新', 'refresh-route', false));
    else if (route === 'audit' || route === 'reconciliation' || route === 'operations') setHeader(button('刷新', 'refresh-route', false));
    else setHeader('');
  }
  function closeMobileNav() {
    document.body.classList.remove('nav-open');
    byId('navToggle').setAttribute('aria-expanded', 'false');
    byId('navToggle').setAttribute('aria-label', '打开导航');
  }

  function enhanceResponsiveTables() {
    var tables = document.querySelectorAll('#content table');
    Array.prototype.forEach.call(tables, function (table) {
      var headers = Array.prototype.map.call(table.querySelectorAll('thead th'), function (cell) {
        return cell.textContent.trim();
      });
      table.classList.add('responsive-table');
      Array.prototype.forEach.call(table.tBodies, function (body) {
        Array.prototype.forEach.call(body.rows, function (row) {
          if (row.cells.length === 1 && row.cells[0].colSpan > 1) return;
          var hasPrimary = false;
          Array.prototype.forEach.call(row.cells, function (cell, index) {
            var label = headers[index] || '';
            if (!label) return;
            cell.setAttribute('data-label', label);
            if (!hasPrimary) {
              cell.classList.add('responsive-primary');
              hasPrimary = true;
            }
          });
        });
      });
    });
  }

  async function loadRoute() {
    var current = readRoute();
    state.route = current.key;
    var loadId = ++state.loadId;
    byId('pageTitle').textContent = ROUTES[current.key];
    document.title = ROUTES[current.key] + ' · 邻里团';
    setActive(current.key);
    closeMobileNav();
    if (!token()) showLogin();
    loading();
    try {
      await ensureSession();
      if (['growth', 'reports', 'operations', 'audit', 'reconciliation'].indexOf(current.key) >= 0 && !canManage()) {
        throw new Error('当前账号无权访问此页面');
      }
      renderHeader(current.key);
      var renderers = {
        today: renderToday,
        products: renderProducts,
        orders: renderOrders,
        customers: renderCustomers,
        'group-buys': renderGroupBuys,
        coupons: renderCoupons,
        surveys: renderSurveys,
        appointments: renderAppointments,
        'after-sales': renderAfterSales,
        growth: renderGrowth,
        reports: renderReports,
        operations: renderOperations,
        audit: renderAuditLogs,
        reconciliation: renderReconciliation,
        settings: renderSettings
      };
      await renderers[current.key](current.params);
      enhanceResponsiveTables();
    } catch (error) {
      if (loadId !== state.loadId) return;
      if (error.message !== '登录已过期') byId('content').innerHTML = errorState(error.message);
    }
  }

  async function renderToday(params) {
    var data = await request('/api/admin/today');
    var processing = (data.tasks || []).reduce(function (sum, task) {
      return sum + (task.id === 'groupbuy' || task.id === 'stock' ? 0 : Number(task.count || 0));
    }, 0);
    var trend = data.trend || [];
    var maxTrend = Math.max.apply(null, trend.map(function (item) { return Number(item.amount) || 0; }).concat([1]));
    var trendBars = trend.map(function (item) {
      var height = Math.max(7, Math.round((Number(item.amount) || 0) / maxTrend * 100));
      return '<div class="trend-bar-wrap"><span class="trend-value">' + (Number(item.amount) ? '¥' + Number(item.amount).toFixed(0) : '') + '</span><div class="trend-bar" style="height:' + height + '%" title="' + esc(item.date) + ' ¥' + Number(item.amount || 0).toFixed(2) + '"></div><span class="trend-day">' + esc(item.date.slice(5)) + '</span></div>';
    }).join('');
    var topProducts = (data.topProducts || []).slice(0, 4).map(function (product, index) {
      return '<div class="rank-row"><span class="rank-index">0' + (index + 1) + '</span><div class="rank-main"><strong>' + esc(product.name) + '</strong><small>售出 ' + Number(product.qty) + ' 件</small></div><span class="rank-amount">¥' + Number(product.amount || 0).toFixed(2) + '</span></div>';
    }).join('') || empty('还没有销售数据');
    var summary = '<div class="summary-grid dashboard-metrics">' +
      '<div class="summary-cell"><div class="summary-label">今日成交</div><div class="summary-value">' + yuan(data.summary.todayAmount) + '</div></div>' +
      '<div class="summary-cell"><div class="summary-label">今日订单</div><div class="summary-value">' + Number(data.summary.todayOrders) + '<small>笔</small></div></div>' +
      '<div class="summary-cell"><div class="summary-label">待处理</div><div class="summary-value">' + processing + '<small>项</small></div></div>' +
      '<div class="summary-cell"><div class="summary-label">新增客户</div><div class="summary-value">' + Number(data.summary.newMembersToday || 0) + '<small>位</small></div></div>' +
      '</div>';
    var tasks = data.tasks || [];
    var taskHtml = tasks.length ? tasks.map(function (task) {
      var items = (task.items || []).map(function (item) {
        var meta = item.meta || '';
        if (item.amount !== undefined) meta = money(item.amount) + (meta ? ' · ' + meta : '');
        return meta;
      }).filter(Boolean).join(' · ');
      var taskClass = task.id === 'refund' || task.id === 'stock' ? 'danger' : task.id === 'groupbuy' ? 'warm' : '';
      return '<a class="task-row ' + taskClass + '" href="' + esc(task.href) + '"><div class="task-main"><div class="task-title"><span>' + esc(task.title) + '</span><span class="count">' + Number(task.count) + '</span></div><div class="task-meta">' + esc(items) + '</div></div><span class="row-arrow">›</span></a>';
    }).join('') : empty('今天没有待办');
    var recommendations = (data.recommendations || []).map(function (item) {
      return '<a class="signal-card ' + esc(item.priority || 'normal') + '" href="' + esc(item.action || '#/today') + '"><strong>' + esc(item.title) + '</strong><p>' + esc(item.detail) + '</p></a>';
    }).join('');
    var anomalies = (data.anomalies || []).map(function (item) {
      return '<div class="anomaly-row"><span class="status-dot"></span><div><strong>' + esc(item.title) + '</strong><small>' + esc(item.detail) + '</small></div><b>' + esc(item.type === 'pickup-overdue' ? '超时' : item.type === 'stockout-risk' ? '缺货' : '差一人') + '</b></div>';
    }).join('');
    var actions = '<section class="quick-actions">' +
      '<button type="button" class="button" data-action="open-shop">打开顾客体验端</button>' +
      (state.session && state.session.demo && isOwner() ? '<button type="button" class="button" data-action="demo-reset">重新载入演示数据</button>' : '') +
      '</section>';
    var insights = [];
    if (recommendations.length) insights.push('<div class="panel-card"><div class="panel-head"><h3>建议</h3></div><div class="signal-card-list">' + recommendations + '</div></div>');
    if (anomalies.length) insights.push('<div class="panel-card"><div class="panel-head"><h3>异常</h3></div><div class="anomaly-list">' + anomalies + '</div></div>');
    byId('content').innerHTML =
      actions +
      (insights.length ? '<section class="insight-grid">' + insights.join('') + '</section>' : '') +
      summary +
      '<div class="dashboard-columns"><section><div class="section-heading"><h3>待办</h3><span>' + tasks.length + ' 组</span></div><div class="task-list">' + taskHtml + '</div></section>' +
      '<aside><div class="panel-card"><div class="panel-head"><h3>近 7 日成交</h3></div><div class="trend-chart">' + trendBars + '</div></div>' +
      '<div class="panel-card"><div class="panel-head"><h3>热销商品</h3></div><div class="rank-list">' + topProducts + '</div></div></aside></div>';
  }

  async function renderProducts(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/products?' + new URLSearchParams(q).toString());
    var rows = (data.list || []).map(function (product) {
      var image = product.image ? '<img class="thumb-small" src="' + esc(product.image) + '" alt="">' : '<span class="product-placeholder">品</span>';
      return '<tr><td><div class="product-cell">' + image + '<div><button class="link-action" data-action="product-detail" data-id="' + esc(product.id) + '">' + esc(product.name) + '</button><div class="cell-meta">' + esc(product.unit || '') + '</div></div></div></td>' +
        '<td>' + yuan(product.price) + '</td><td>' + Number(product.stock || 0) + '</td><td>' + Number(product.sales || 0) + '</td>' +
        '<td>' + (product.onSale ? '<span class="tag green">在售</span>' : '<span class="tag gray">下架</span>') + '</td>' +
        '<td class="cell-actions"><button class="button small" data-action="product-detail" data-id="' + esc(product.id) + '">查看</button></td></tr>';
    }).join('');
    var table = '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>商品</th><th>价格</th><th>库存</th><th>销量</th><th>状态</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">' + empty('没有匹配的商品') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('products', params, { page: page }); }) + '</div>';
    var lowStock = params.get('stock') === 'low' ? '<div class="callout warning" style="margin-bottom:14px">仅显示低库存商品</div>' : '';
    byId('content').innerHTML = '<div class="toolbar">' + searchForm('搜索商品', params) +
      '<a class="filter-tab ' + (params.get('stock') === 'low' ? 'active' : '') + '" href="' + routeHref('products', params, { stock: params.get('stock') === 'low' ? '' : 'low', page: 1 }) + '">低库存</a>' +
      '<span class="toolbar-spacer"></span></div>' + lowStock + table;
  }

  async function openProductDetail(id) {
    var product = await request('/api/admin/products/' + encodeURIComponent(id));
    var image = product.image ? '<img class="thumb-small" style="width:56px;height:56px" src="' + esc(product.image) + '" alt="">' : '<span class="product-placeholder" style="width:56px;height:56px">品</span>';
    openDialog('商品详情', '<div class="detail-hero"><div><div class="detail-title">' + esc(product.name) + '</div><div class="detail-subtitle">' + esc(product.category ? product.category.name : '未分类') + '</div></div>' + image + '</div>' +
      '<div class="detail-section"><div class="detail-grid">' +
      '<div class="detail-item"><div class="detail-label">价格</div><div class="detail-value">' + yuan(product.price) + '</div></div>' +
      '<div class="detail-item"><div class="detail-label">原价</div><div class="detail-value">' + yuan(product.originalPrice) + '</div></div>' +
      '<div class="detail-item"><div class="detail-label">库存</div><div class="detail-value">' + Number(product.stock || 0) + '</div></div>' +
      '<div class="detail-item"><div class="detail-label">销量</div><div class="detail-value">' + Number(product.sales || 0) + '</div></div>' +
      '</div></div>' +
      (product.description ? '<div class="detail-section"><h3>描述</h3><div>' + esc(product.description) + '</div></div>' : '') +
      '<div class="detail-section"><div class="detail-grid">' +
      '<div class="detail-item"><div class="detail-label">状态</div><div class="detail-value">' + (product.onSale ? '在售' : '已下架') + '</div></div>' +
      '<div class="detail-item"><div class="detail-label">单位</div><div class="detail-value">' + esc(product.unit || '份') + '</div></div>' +
      '</div></div>', button('关闭', 'close-dialog') + (canManage() ?
        button('调整库存', 'inventory-adjust', false, 'data-id="' + esc(product.id) + '"') +
        button('库存记录', 'inventory-history', false, 'data-id="' + esc(product.id) + '"') +
        button('删除', 'product-delete', false, 'data-id="' + esc(product.id) + '"') +
        button(product.onSale ? '下架' : '上架', 'product-toggle', false, 'data-id="' + esc(product.id) + '"') +
        button('编辑', 'product-edit', true, 'data-id="' + esc(product.id) + '"') : ''));
  }

  async function openInventoryAdjust(id) {
    var product = await request('/api/admin/products/' + encodeURIComponent(id));
    openDialog('调整库存 · ' + product.name, '<div class="detail-grid"><div class="detail-item"><div class="detail-label">当前可用库存</div><div class="detail-value">' + Number(product.stock || 0) + ' ' + esc(product.unit || '份') + '</div></div><div class="detail-item"><div class="detail-label">调整规则</div><div class="detail-value">正数入库，负数出库</div></div></div>' +
      '<div class="form-grid" style="margin-top:18px">' +
      field('调整数量', '<input id="inventoryDelta" type="number" step="1" placeholder="例如 20 或 -3">') +
      field('调整原因', '<input id="inventoryReason" maxlength="100" placeholder="补货、盘点、破损等">', true) +
      '</div><p class="form-help">每次调整都会生成独立流水，并写入不可跳号的审计链。误操作可在库存记录中撤销。</p>',
      button('取消', 'close-dialog') + button('确认调整', 'inventory-save', true, 'data-id="' + esc(product.id) + '"'));
  }

  async function saveInventoryAdjust(id) {
    var delta = Number(byId('inventoryDelta').value);
    var reason = byId('inventoryReason').value.trim();
    if (!delta) throw new Error('调整数量不能为 0');
    if (!reason) throw new Error('请填写调整原因');
    await request('/api/admin/products/' + encodeURIComponent(id) + '/inventory-adjustments', {
      method: 'POST', body: { delta: delta, reason: reason }
    });
    toast('库存已调整并留下流水');
    closeAndRefresh();
  }

  async function openInventoryHistory(id) {
    var rows = await request('/api/admin/products/' + encodeURIComponent(id) + '/inventory-adjustments');
    var body = rows.length ? '<div class="inventory-timeline">' + rows.map(function (item) {
      var undone = !!item.undoneAt || !!item.reversedAdjustmentId;
      return '<div class="inventory-row"><div><strong>' + (item.delta > 0 ? '+' : '') + Number(item.delta) + ' ' + esc(item.productName) + '</strong><small>' + esc(item.reason) + ' · ' + shortDate(item.createdAt) + ' · ' + esc(item.actorName || '系统') + '</small></div><span>' + Number(item.before) + ' → ' + Number(item.after) + '</span>' +
        (canManage() && !undone ? button('撤销', 'inventory-undo', false, 'data-id="' + esc(item.id) + '"') : '<span class="tag gray">' + (undone ? '已撤销' : '只读') + '</span>') + '</div>';
    }).join('') + '</div>' : empty('还没有库存调整记录');
    openDialog('库存调整记录', body, button('关闭', 'close-dialog'));
  }

  async function undoInventoryAdjustment(id) {
    if (!confirm('撤销这次库存调整？系统会生成一条反向流水。')) return;
    await request('/api/admin/inventory-adjustments/' + encodeURIComponent(id) + '/undo', { method: 'POST', body: {} });
    toast('库存调整已撤销');
    closeAndRefresh();
  }

  async function openProductForm(product) {
    var cats = await categories();
    product = product || { onSale: true, unit: '份' };
    var options = '<option value="">未分类</option>' + cats.map(function (cat) {
      return '<option value="' + esc(cat.id) + '" ' + (cat.id === product.categoryId ? 'selected' : '') + '>' + esc(cat.name) + '</option>';
    }).join('');
    openDialog(product.id ? '编辑商品' : '新增商品', '<div class="form-grid">' +
      field('名称', '<input id="productName" maxlength="50" value="' + esc(product.name || '') + '">', true) +
      field('价格', '<input id="productPrice" type="number" min="0.01" step="0.01" value="' + esc(product.price || '') + '">') +
      field('原价', '<input id="productOriginal" type="number" min="0" step="0.01" value="' + esc(product.originalPrice || '') + '">') +
      field('库存', '<input id="productStock" type="number" min="0" step="1" value="' + esc(product.stock || 0) + '">') +
      field('单位', '<input id="productUnit" maxlength="10" value="' + esc(product.unit || '份') + '">') +
      field('分类', '<select id="productCategory">' + options + '</select>') +
      field('图片', '<input id="productImage" maxlength="2048" value="' + esc(product.image || '') + '">', true) +
      field('描述', '<textarea id="productDescription" maxlength="500">' + esc(product.description || '') + '</textarea>', true) +
      field('状态', '<label class="checkbox-row"><input id="productOnSale" type="checkbox" ' + (product.onSale !== false ? 'checked' : '') + '> 在售</label>', true) +
      '</div>', button('取消', 'close-dialog') + button(product.id ? '保存' : '创建', 'product-save', true, 'data-id="' + esc(product.id || '') + '"'));
  }

  async function saveProduct(id) {
    var body = {
      name: byId('productName').value.trim(),
      price: Number(byId('productPrice').value),
      originalPrice: Number(byId('productOriginal').value || byId('productPrice').value),
      stock: Number(byId('productStock').value || 0),
      unit: byId('productUnit').value.trim() || '份',
      categoryId: byId('productCategory').value,
      image: byId('productImage').value.trim(),
      description: byId('productDescription').value.trim(),
      onSale: byId('productOnSale').checked
    };
    if (id) await request('/api/admin/products/' + encodeURIComponent(id), { method: 'PUT', body: body });
    else await request('/api/admin/products', { method: 'POST', body: body });
    toast(id ? '商品已保存' : '商品已创建');
    closeAndRefresh();
  }

  async function toggleProduct(id, onSale) {
    await request('/api/admin/products/' + encodeURIComponent(id), { method: 'PUT', body: { onSale: !onSale } });
    toast(onSale ? '商品已下架' : '商品已上架');
    closeAndRefresh();
  }
  async function removeProduct(id) {
    if (!confirm('删除这个商品？')) return;
    await request('/api/admin/products/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('商品已删除');
    closeAndRefresh();
  }

  async function openCategoryManager() {
    state.categories = null;
    var list = await categories();
    var rows = list.map(function (category) {
      return '<div class="management-row"><div><strong>' + esc(category.name) + '</strong><small>排序 ' + Number(category.sort || 0) + '</small></div>' +
        '<div class="row-actions">' + button('编辑', 'category-edit', false, 'data-id="' + esc(category.id) + '"') +
        button('删除', 'category-delete', false, 'data-id="' + esc(category.id) + '"') + '</div></div>';
    }).join('') || empty('还没有商品分类');
    openDialog('商品分类', '<div class="management-list">' + rows + '</div>',
      button('关闭', 'close-dialog') + button('新增分类', 'category-edit', true));
  }

  async function openCategoryForm(category) {
    var list = await categories();
    category = category ? list.find(function (item) { return item.id === category; }) : null;
    category = category || { name: '', sort: list.length + 1 };
    openDialog(category.id ? '编辑商品分类' : '新增商品分类', '<div class="form-grid">' +
      field('名称', '<input id="categoryName" maxlength="20" value="' + esc(category.name) + '">', true) +
      field('排序', '<input id="categorySort" type="number" step="1" value="' + Number(category.sort || 0) + '">') +
      '</div><p class="form-help">排序数字越小越靠前；已有商品使用的分类不能删除。</p>',
      button('返回分类', 'category-manage') + button(category.id ? '保存' : '创建', 'category-save', true, 'data-id="' + esc(category.id || '') + '"'));
  }

  async function saveCategory(id) {
    var body = { name: byId('categoryName').value.trim(), sort: Number(byId('categorySort').value || 0) };
    if (id) await request('/api/admin/categories/' + encodeURIComponent(id), { method: 'PUT', body: body });
    else await request('/api/admin/categories', { method: 'POST', body: body });
    state.categories = null;
    toast(id ? '分类已保存' : '分类已创建');
    closeAndRefresh();
  }

  async function removeCategory(id) {
    if (!confirm('删除这个分类？已有商品使用时系统会阻止删除。')) return;
    await request('/api/admin/categories/' + encodeURIComponent(id), { method: 'DELETE' });
    state.categories = null;
    toast('分类已删除');
    loadRoute();
  }

  async function renderOrders(params) {
    state.selectedOrders.clear();
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/orders?' + new URLSearchParams(q).toString());
    state.selectableOrders = (data.list || []).filter(function (order) {
      return order.status === 'paid' && order.deliveryType !== 'pickup';
    }).map(function (order) { return order.id; });
    state.visibleOrderIds = (data.list || []).map(function (order) { return order.id; });
    var rows = (data.list || []).map(function (order) {
      var selectable = order.status === 'paid' && order.deliveryType !== 'pickup';
      var items = (order.items || []).map(function (item) { return item.name + '×' + item.quantity; }).join('、');
      return '<tr><td class="cell-check"><input class="order-select" type="checkbox" aria-label="选择订单 ' + esc(order.orderNo) + '" data-id="' + esc(order.id) + '" ' + (selectable ? '' : 'disabled') + '></td>' +
        '<td><button class="link-action" data-action="order-detail" data-id="' + esc(order.id) + '">' + esc(order.orderNo) + '</button><div class="cell-meta">' + esc(items) + '</div></td>' +
        '<td>' + money(order.payAmount) + '</td><td>' + statusTag(order.refund && order.refund.status === 'refunding' ? 'refunding' : order.status) + '</td>' +
        '<td>' + (order.deliveryType === 'pickup' ? '自提' : '配送') + '</td><td class="cell-nowrap">' + shortDate(order.createdAt) + '</td>' +
        '<td class="cell-actions"><button class="button small" data-action="order-detail" data-id="' + esc(order.id) + '">查看</button></td></tr>';
    }).join('');
    var statusItems = [['', '全部'], ['pending', '待支付'], ['paid', '待发货'], ['delivering', '配送中'], ['refunding', '退款中'], ['completed', '已完成']];
    var filters = statusItems.map(function (item) {
      var active = (params.get('status') || '') === item[0];
      return '<a class="filter-tab ' + (active ? 'active' : '') + '" href="' + routeHref('orders', params, { status: item[0], page: 1 }) + '">' + item[1] + '</a>';
    }).join('');
    var head = '<div class="toolbar">' + searchForm('搜索订单号', params) + '<div class="filter-tabs">' + filters + '</div></div>';
    var table = '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th class="cell-check"><input id="selectAllOrders" type="checkbox" aria-label="全选当前页"></th><th>订单</th><th>实付</th><th>状态</th><th>方式</th><th>下单时间</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7">' + empty('没有匹配的订单') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('orders', params, { page: page }); }) + '</div>';
    byId('content').innerHTML = head + table;
    updateBatchButton();
  }

  function selectedOrderIds() { return Array.from(state.selectedOrders); }
  function updateBatchButton() {
    var node = document.querySelector('[data-action="batch-deliver"]');
    if (node) node.disabled = state.selectedOrders.size === 0;
  }
  function toggleVisibleOrders(checked) {
    state.selectableOrders.forEach(function (id) {
      if (checked) state.selectedOrders.add(id);
      else state.selectedOrders.delete(id);
    });
    document.querySelectorAll('.order-select:not(:disabled)').forEach(function (node) { node.checked = checked; });
    updateBatchButton();
  }
  function syncOrderSelection() {
    var count = document.querySelectorAll('.order-select:checked').length;
    var selectable = document.querySelectorAll('.order-select:not(:disabled)').length;
    var all = byId('selectAllOrders');
    if (all) {
      all.checked = count > 0 && count === selectable;
      all.indeterminate = count > 0 && count < selectable;
    }
    updateBatchButton();
  }

  async function openOrderDetail(id) {
    var order = await request('/api/admin/orders/' + encodeURIComponent(id));
    var member = order.member || {};
    var actions = order.availableActions || [];
    var has = function (action) { return actions.some(function (item) { return item.id === action; }); };
    var itemRows = (order.items || []).map(function (item) {
      return '<div class="line-item"><span>' + esc(item.name) + ' × ' + Number(item.quantity) + '</span><span>' + money(item.subtotal) + '</span></div>';
    }).join('');
    var address = order.deliveryType === 'pickup' ?
      '<div class="detail-item"><div class="detail-label">自提</div><div class="detail-value">取货码 <strong>' + esc(order.pickupCode || '—') + '</strong></div></div>' :
      '<div class="detail-item full"><div class="detail-label">收货地址</div><div class="detail-value">' + (order.address ? esc(order.address.name + ' ' + order.address.phone + ' · ' + order.address.detail) : '未填写') + '</div></div>';
    var actionHtml = '';
    if (has('deliver')) {
      actionHtml += '<div class="action-box"><h4>发货</h4><div class="form-grid">' +
        field('物流公司', '<input id="orderCompany" maxlength="50" placeholder="可选">') +
        field('物流单号', '<input id="orderTracking" maxlength="64" placeholder="可选">') +
        '</div>' + button('确认发货', 'order-deliver', true, 'data-id="' + esc(order.id) + '"') + '</div>';
    }
    if (has('verify-pickup')) {
      actionHtml += '<div class="action-box"><h4>核销取货</h4><div class="form-grid">' +
        field('取货码', '<input id="orderPickupCode" maxlength="6" inputmode="numeric" placeholder="输入 6 位取货码">', true) +
        '</div>' + button('核销', 'order-verify-pickup', true, 'data-id="' + esc(order.id) + '"') + '</div>';
    }
    if (has('refund') && canManage()) {
      actionHtml += '<div class="action-box"><h4>退款</h4><div class="form-grid">' +
        field('金额', '<input id="orderRefundAmount" type="number" min="0.01" step="0.01" value="' + (Number(order.refundableAmount || 0) / 100).toFixed(2) + '">') +
        field('原因', '<input id="orderRefundReason" maxlength="80" value="商家退款">') +
        '</div>' + button('提交退款', 'order-refund', true, 'data-id="' + esc(order.id) + '"') + '</div>';
    }
    var logistics = order.logistics ? '<div class="detail-item full"><div class="detail-label">物流</div><div class="detail-value">' + esc((order.logistics.company || '') + ' ' + (order.logistics.trackingNo || '')) + '</div></div>' : '';
    var refund = order.refund ? '<div class="detail-item full"><div class="detail-label">退款</div><div class="detail-value">' + esc(order.refund.status === 'refunding' ? '处理中' : order.refund.status === 'refunded' ? '已完成' : order.refund.status) + ' · ' + money(order.refundedAmount || order.refund.amount) + '</div></div>' : '';
    openDialog('订单 ' + order.orderNo, '<div class="detail-hero"><div><div class="detail-title">' + money(order.payAmount) + '</div><div class="detail-subtitle">' + shortDate(order.createdAt) + '</div></div>' + statusTag(order.refund && order.refund.status === 'refunding' ? 'refunding' : order.status) + '</div>' +
      '<div class="detail-section"><div class="detail-grid">' +
      '<div class="detail-item"><div class="detail-label">客户</div><div class="detail-value">' + esc(member.nickname || '会员') + '</div></div>' +
      '<div class="detail-item"><div class="detail-label">手机号</div><div class="detail-value">' + esc(member.phone || '—') + '</div></div>' +
      address + '</div></div>' +
      '<div class="detail-section"><h3>商品</h3>' + itemRows + '<div class="amount-summary">' +
      '<div class="amount-row"><span>商品</span><span>' + money(order.goodsAmount) + '</span></div>' +
      (order.couponDiscount ? '<div class="amount-row"><span>优惠</span><span>-' + money(order.couponDiscount) + '</span></div>' : '') +
      (order.pointsDiscount ? '<div class="amount-row"><span>积分</span><span>-' + money(order.pointsDiscount) + '</span></div>' : '') +
      (order.deliveryFee ? '<div class="amount-row"><span>配送</span><span>' + money(order.deliveryFee) + '</span></div>' : '') +
      '<div class="amount-row total"><span>实付</span><span>' + money(order.payAmount) + '</span></div></div></div>' +
      '<div class="detail-section"><div class="detail-grid">' + logistics + refund +
      '<div class="detail-item full"><div class="detail-label">备注</div><div class="detail-value">' + esc(order.remark || '—') + '</div></div></div></div>' +
      (actionHtml ? '<div class="detail-section"><h3>操作</h3>' + actionHtml + '</div>' : ''),
      button('关闭', 'close-dialog'));
  }

  async function deliverOrder(id) {
    await request('/api/admin/orders/' + encodeURIComponent(id) + '/deliver', {
      method: 'POST',
      body: {
        company: byId('orderCompany').value.trim(),
        trackingNo: byId('orderTracking').value.trim()
      }
    });
    toast('订单已发货');
    closeAndRefresh();
  }
  async function verifyPickup(id) {
    await request('/api/admin/orders/' + encodeURIComponent(id) + '/verify-pickup', {
      method: 'POST',
      body: { pickupCode: byId('orderPickupCode').value.trim() }
    });
    toast('取货码已核销');
    closeAndRefresh();
  }
  async function refundOrder(id) {
    if (!confirm('确认提交退款？')) return;
    await request('/api/admin/orders/' + encodeURIComponent(id) + '/refund', {
      method: 'POST',
      body: {
        amount: Number(byId('orderRefundAmount').value),
        reason: byId('orderRefundReason').value.trim()
      }
    });
    toast('退款已提交');
    closeAndRefresh();
  }
  function openBatchDeliver() {
    var ids = selectedOrderIds();
    if (!ids.length) return toast('请选择待发货订单', true);
    openDialog('批量发货', '<div class="callout">已选择 ' + ids.length + ' 笔订单</div><div class="form-grid" style="margin-top:16px">' +
      field('物流公司', '<input id="batchCompany" maxlength="50" placeholder="可选">') +
      field('物流单号', '<input id="batchTracking" maxlength="64" placeholder="可选">') +
      '</div>', button('取消', 'close-dialog') + button('确认发货', 'batch-submit', true));
  }
  async function submitBatchDeliver() {
    var result = await request('/api/admin/orders/batch-deliver', {
      method: 'POST',
      body: {
        orderIds: selectedOrderIds(),
        company: byId('batchCompany').value.trim(),
        trackingNo: byId('batchTracking').value.trim()
      }
    });
    state.selectedOrders.clear();
    await loadRoute();
    if (!result.failureCount) {
      toast('已发货 ' + result.successCount + ' 笔订单');
      closeDialog();
      return;
    }
    var failures = result.failures.map(function (item) {
      return '<div class="distribution-row"><span>' + esc(item.orderNo || item.id) + '</span><span>' + esc(item.error) + '</span></div>';
    }).join('');
    openDialog('批量发货结果', '<div class="callout">成功 ' + result.successCount + ' 笔，失败 ' + result.failureCount + ' 笔</div><div class="detail-section">' + failures + '</div>', button('关闭', 'close-dialog'));
  }

  async function exportOrdersCsv() {
    var current = readRoute();
    var q = paramsObject(current.params);
    var query = new URLSearchParams();
    if (q.status) query.set('status', q.status);
    if (q.keyword) query.set('keyword', q.keyword);
    var response = await fetch('/api/admin/exports/orders.csv' + (query.toString() ? '?' + query.toString() : ''), {
      headers: token() ? { Authorization: 'Bearer ' + token() } : {}
    });
    if (response.status === 401) {
      localStorage.removeItem('lt-admin-token');
      state.session = null;
      showLogin();
      throw new Error('登录已过期');
    }
    if (!response.ok) throw new Error('订单导出失败');
    var blob = await response.blob();
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'orders-' + todayString() + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast('订单 CSV 已导出');
  }

  async function renderCustomers(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/members?' + new URLSearchParams(q).toString());
    var rows = (data.list || []).map(function (member) {
      return '<tr><td><button class="link-action" data-action="member-detail" data-id="' + esc(member.id) + '">' + esc(member.nickname || '微信用户') + '</button><div class="cell-meta">' + esc(member.id) + '</div></td>' +
        '<td>' + esc(member.phone || '—') + '</td><td>' + Number(member.orderCount || 0) + '</td><td>' + yuan(member.totalSpent || 0) + '</td>' +
        '<td class="cell-nowrap">' + shortDate(member.lastLoginAt || member.createdAt) + '</td>' +
        '<td class="cell-actions">' + button('查看档案', 'member-detail', false, 'data-id="' + esc(member.id) + '"') + '</td></tr>';
    }).join('');
    byId('content').innerHTML = '<div class="toolbar">' + searchForm('搜索昵称或手机号', params) + '</div>' +
      '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>客户</th><th>手机号</th><th>订单</th><th>累计消费</th><th>最近登录</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">' + empty('没有匹配的客户') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('customers', params, { page: page }); }) + '</div>';
  }

  async function openMemberDetail(id) {
    var requests = [request('/api/admin/members/' + encodeURIComponent(id))];
    if (canManage()) requests.push(requestAll('/api/admin/coupons'));
    var result = await Promise.all(requests);
    var data = result[0];
    request('/api/admin/onboarding/customer', { method: 'POST', body: {} }).catch(function () {});
    var templates = (result[1] || []).filter(function (coupon) { return coupon.enabled; });
    var member = data.member || {};
    var summary = data.summary || {};
    var orders = (data.orders || []).slice(0, 5).map(function (order) {
      return '<button type="button" class="history-row" data-action="order-detail" data-id="' + esc(order.id) + '"><span><strong>' + esc(order.orderNo) + '</strong><small>' + shortDate(order.createdAt) + '</small></span>' + statusTag(order.status) + '<b>' + money(order.payAmount) + '</b></button>';
    }).join('') || '<div class="detail-empty">还没有订单</div>';
    var ledger = (data.points.ledger || []).slice(0, 5).map(function (item) {
      return '<div class="history-row static"><span><strong>' + esc(item.reason) + '</strong><small>' + shortDate(item.createdAt) + '</small></span><b class="' + (item.change > 0 ? 'positive' : 'negative') + '">' + (item.change > 0 ? '+' : '') + Number(item.change) + '</b></div>';
    }).join('') || '<div class="detail-empty">暂无积分流水</div>';
    var coupons = (data.coupons || []).slice(0, 5).map(function (coupon) {
      return '<div class="history-row static"><span><strong>' + esc(coupon.name) + '</strong><small>' + (coupon.status === 'unused' ? '可使用' : coupon.status === 'used' ? '已使用' : '已过期') + '</small></span><b>减 ' + money(coupon.amount) + '</b></div>';
    }).join('') || '<div class="detail-empty">暂无优惠券</div>';
    var templateOptions = templates.map(function (coupon) {
      return '<option value="' + esc(coupon.id) + '">' + esc(coupon.name + ' · 满 ' + yuan(coupon.threshold) + ' 减 ' + yuan(coupon.amount)) + '</option>';
    }).join('');
    var operations = canManage() ? '<div class="detail-section"><h3>会员运营</h3><div class="operation-grid">' +
      '<div class="action-box"><h4>调整积分</h4><p class="action-help">正数增加，负数扣减；每次调整都会写入积分流水与审计日志。</p><div class="form-grid">' +
      field('积分变化', '<input id="memberPointsAmount" type="number" step="1" placeholder="例如 100 或 -50">') +
      field('调整原因', '<input id="memberPointsReason" maxlength="80" placeholder="例如 线下活动补发">') +
      '</div>' + button('确认调整', 'member-points', true, 'data-id="' + esc(member.id) + '"') + '</div>' +
      '<div class="action-box"><h4>发放优惠券</h4><p class="action-help">从当前启用的优惠券模板中发放，可用于召回和复购活动。</p>' +
      (templates.length ? '<label class="form-field"><span class="field-label">优惠券</span><select id="memberCouponTemplate">' + templateOptions + '</select></label>' + button('立即发放', 'member-coupon', true, 'data-id="' + esc(member.id) + '"') : '<div class="detail-empty">没有可用优惠券模板</div>') +
      '</div></div></div>' : '';
    openDialog('客户档案', '<div class="member-head"><div class="member-avatar">' + esc((member.nickname || '邻').slice(0, 1)) + '</div><div><h3>' + esc(member.nickname || '微信用户') + '</h3><p>' + esc(member.phone || '未留手机号') + ' · ' + esc((member.addresses || []).length) + ' 个收货地址</p></div><span class="member-points">' + Number((data.points || {}).balance || 0) + '<small>积分</small></span></div>' +
      '<div class="member-metrics"><div><span>累计消费</span><strong>' + money(summary.paidAmount || 0) + '</strong></div><div><span>订单</span><strong>' + Number(summary.orderCount || 0) + '</strong></div><div><span>可用券</span><strong>' + Number(summary.unusedCoupons || 0) + '</strong></div><div><span>待履约预约</span><strong>' + Number(summary.upcomingAppointments || 0) + '</strong></div></div>' +
      '<div class="detail-section"><h3>最近订单</h3><div class="history-list">' + orders + '</div></div>' +
      '<div class="detail-grid history-columns"><div class="detail-section"><h3>积分流水</h3><div class="history-list">' + ledger + '</div></div><div class="detail-section"><h3>优惠券</h3><div class="history-list">' + coupons + '</div></div></div>' + operations,
      button('关闭', 'close-dialog'));
  }

  async function adjustMemberPoints(id) {
    var amount = Number(byId('memberPointsAmount').value);
    var reason = byId('memberPointsReason').value.trim();
    if (!Number.isInteger(amount) || amount === 0) throw new Error('请输入非零整数积分');
    if (!reason) throw new Error('请填写积分调整原因');
    await request('/api/admin/members/' + encodeURIComponent(id) + '/points', { method: 'POST', body: { amount: amount, reason: reason } });
    toast('积分已调整');
    await openMemberDetail(id);
  }

  async function grantMemberCoupon(id) {
    var templateId = byId('memberCouponTemplate').value;
    if (!templateId) throw new Error('请选择优惠券');
    await request('/api/admin/members/' + encodeURIComponent(id) + '/coupons', { method: 'POST', body: { templateId: templateId } });
    toast('优惠券已发放');
    await openMemberDetail(id);
  }

  async function renderGroupBuys(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/groupbuys?' + new URLSearchParams(q).toString());
    state.groupBuyMap = {};
    (data.list || []).forEach(function (group) { state.groupBuyMap[group.id] = group; });
    var rows = (data.list || []).map(function (group) {
      var status = { active: ['进行中', 'blue'], success: ['已成团', 'green'], closed: ['已结束', 'gray'], cancelled: ['已取消', 'red'] }[group.status] || [group.status, 'gray'];
      return '<tr><td><div class="cell-primary">' + esc(group.title) + '</div><div class="cell-meta">' + esc(group.product ? group.product.name : '商品已删除') + '</div></td>' +
        '<td>' + money(group.groupPrice) + '</td><td>' + group.participantCount + ' / ' + group.minParticipants + '</td>' +
        '<td><span class="tag ' + status[1] + '">' + status[0] + '</span></td><td class="cell-nowrap">' + fullDate(group.endAt) + '</td>' +
        '<td class="cell-actions">' + (group.status === 'active' && canManage() ? '<button type="button" class="button small" data-action="groupbuy-edit" data-id="' + esc(group.id) + '">改期</button> <button type="button" class="button small danger" data-action="groupbuy-cancel" data-id="' + esc(group.id) + '">结束</button>' : '') + '</td></tr>';
    }).join('');
    byId('content').innerHTML = '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>活动</th><th>团购价</th><th>人数</th><th>状态</th><th>截止</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">' + empty('还没有团购活动') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('group-buys', params, { page: page }); }) + '</div>';
  }
  async function openGroupBuyForm() {
    var products = await requestAll('/api/admin/products', { keyword: '' });
    if (!products.length) return toast('请先创建商品', true);
    var options = products.map(function (product) { return '<option value="' + esc(product.id) + '">' + esc(product.name + ' · ' + yuan(product.price)) + '</option>'; }).join('');
    openDialog('发起团购', '<div class="form-grid">' +
      field('商品', '<select id="groupProduct">' + options + '</select>', true) +
      field('活动名称', '<input id="groupTitle" maxlength="50">', true) +
      field('团购价', '<input id="groupPrice" type="number" min="0.01" step="0.01">') +
      field('成团人数', '<input id="groupMin" type="number" min="2" value="3">') +
      field('持续小时', '<input id="groupHours" type="number" min="1" value="24">') +
      '</div>', button('取消', 'close-dialog') + button('发起', 'groupbuy-save', true));
  }
  async function saveGroupBuy() {
    await request('/api/admin/groupbuys', {
      method: 'POST',
      body: {
        productId: byId('groupProduct').value,
        title: byId('groupTitle').value.trim(),
        groupPrice: Number(byId('groupPrice').value),
        minParticipants: Number(byId('groupMin').value),
        durationHours: Number(byId('groupHours').value)
      }
    });
    toast('团购已发起');
    closeAndRefresh();
  }
  async function cancelGroupBuy(id) {
    if (!confirm('结束这个团购活动？')) return;
    await request('/api/admin/groupbuys/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: {} });
    toast('团购已结束');
    loadRoute();
  }
  function openGroupBuyUpdate(id) {
    var group = state.groupBuyMap[id];
    if (!group) return;
    openDialog('调整团购 · ' + group.title, '<div class="detail-grid"><div class="detail-item"><div class="detail-label">当前截止</div><div class="detail-value">' + fullDate(group.endAt) + '</div></div><div class="detail-item"><div class="detail-label">当前人数</div><div class="detail-value">' + Number(group.participantCount || 0) + ' / ' + Number(group.maxParticipants || 100) + '</div></div></div>' +
      '<div class="form-grid" style="margin-top:18px">' + field('延长小时', '<input id="groupExtendHours" type="number" min="1" max="720" value="24">') +
      field('人数上限', '<input id="groupMaxParticipants" type="number" min="2" value="' + Number(group.maxParticipants || 100) + '">') + '</div>' +
      '<p class="form-help">延期从原截止时间继续计算；人数上限不能低于当前参团人数和成团人数。</p>',
      button('取消', 'close-dialog') + button('保存调整', 'groupbuy-update-save', true, 'data-id="' + esc(id) + '"'));
  }
  async function saveGroupBuyUpdate(id) {
    var body = {
      extendHours: Number(byId('groupExtendHours').value),
      maxParticipants: Number(byId('groupMaxParticipants').value)
    };
    await request('/api/admin/groupbuys/' + encodeURIComponent(id), { method: 'PUT', body: body });
    toast('团购截止时间和人数上限已更新');
    closeAndRefresh();
  }

  async function renderCoupons(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/coupons?' + new URLSearchParams(q).toString());
    state.couponMap = {};
    (data.list || []).forEach(function (coupon) { state.couponMap[coupon.id] = coupon; });
    var rows = (data.list || []).map(function (coupon) {
      return '<tr><td class="cell-primary">' + esc(coupon.name) + '</td><td>满 ' + yuan(coupon.threshold) + '</td><td>减 ' + yuan(coupon.amount) + '</td>' +
        '<td>' + coupon.validDays + ' 天</td><td>' + coupon.limitPerMember + ' 张/人</td><td>' + (coupon.enabled ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>') + '</td>' +
        '<td class="cell-actions">' + (canManage() ? button('编辑', 'coupon-edit', false, 'data-id="' + esc(coupon.id) + '"') +
        button(coupon.enabled ? '停用' : '启用', 'coupon-toggle', false, 'data-id="' + esc(coupon.id) + '"') +
        button('删除', 'coupon-delete', false, 'data-id="' + esc(coupon.id) + '"') : '') + '</td></tr>';
    }).join('');
    byId('content').innerHTML =
      '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>名称</th><th>门槛</th><th>优惠</th><th>有效期</th><th>领取上限</th><th>状态</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7">' + empty('还没有优惠券') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('coupons', params, { page: page }); }) + '</div>';
  }
  function openCouponForm(coupon) {
    coupon = coupon || { validDays: 30, limitPerMember: 1, threshold: 0, enabled: true };
    openDialog(coupon.id ? '编辑优惠券' : '新建优惠券', '<div class="form-grid">' +
      field('名称', '<input id="couponName" maxlength="30" value="' + esc(coupon.name || '') + '">', true) +
      field('使用门槛', '<input id="couponThreshold" type="number" min="0" step="0.01" value="' + Number(coupon.threshold || 0) + '">') +
      field('优惠金额', '<input id="couponAmount" type="number" min="0.01" step="0.01" value="' + Number(coupon.amount || '') + '">') +
      field('有效期', '<input id="couponDays" type="number" min="1" value="' + Number(coupon.validDays || 30) + '">') +
      field('每人限领', '<input id="couponLimit" type="number" min="1" value="' + Number(coupon.limitPerMember || 1) + '">') +
      field('状态', '<label class="checkbox-row"><input id="couponEnabled" type="checkbox" ' + (coupon.enabled !== false ? 'checked' : '') + '> 启用并可领取</label>', true) +
      '</div>', button('取消', 'close-dialog') + button(coupon.id ? '保存' : '创建', 'coupon-save', true, 'data-id="' + esc(coupon.id || '') + '"'));
  }
  async function saveCoupon(id) {
    var body = {
      name: byId('couponName').value.trim(),
      threshold: Number(byId('couponThreshold').value || 0),
      amount: Number(byId('couponAmount').value),
      validDays: Number(byId('couponDays').value || 30),
      limitPerMember: Number(byId('couponLimit').value || 1),
      enabled: byId('couponEnabled').checked
    };
    await request('/api/admin/coupons' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PUT' : 'POST', body: body });
    toast(id ? '优惠券已保存' : '优惠券已创建');
    closeAndRefresh();
  }

  async function toggleCoupon(id) {
    var coupon = state.couponMap[id];
    if (!coupon) throw new Error('优惠券不存在');
    await request('/api/admin/coupons/' + encodeURIComponent(id), { method: 'PUT', body: { enabled: !coupon.enabled } });
    toast(coupon.enabled ? '优惠券已停用' : '优惠券已启用');
    loadRoute();
  }

  async function removeCoupon(id) {
    if (!confirm('删除这个优惠券模板？已发放的券会使删除操作被系统阻止。')) return;
    await request('/api/admin/coupons/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('优惠券已删除');
    loadRoute();
  }

  async function renderSurveys(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/forms?' + new URLSearchParams(q).toString());
    state.formMap = {};
    (data.list || []).forEach(function (form) { state.formMap[form.id] = form; });
    var rows = (data.list || []).map(function (form) {
      return '<tr><td><div class="cell-primary">' + esc(form.title) + '</div><div class="cell-meta">' + esc(form.description || '') + '</div></td>' +
        '<td>' + form.fields.length + '</td><td>' + (form.status === 'open' ? '<span class="tag green">收集中</span>' : '<span class="tag gray">已关闭</span>') + '</td>' +
        '<td class="cell-nowrap">' + shortDate(form.createdAt) + '</td><td class="cell-actions">' + button('统计', 'survey-stats', false, 'data-id="' + esc(form.id) + '"') +
        (canManage() ? button('编辑', 'survey-edit', false, 'data-id="' + esc(form.id) + '"') + button(form.status === 'open' ? '停止收集' : '重新开放', 'survey-toggle', false, 'data-id="' + esc(form.id) + '"') : '') + '</td></tr>';
    }).join('');
    byId('content').innerHTML = '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>问卷</th><th>题数</th><th>状态</th><th>创建时间</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5">' + empty('还没有问卷') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('surveys', params, { page: page }); }) + '</div>';
  }
  function openSurveyForm(form) {
    state.surveyEditingId = form ? form.id : '';
    state.surveyFields = form ? form.fields.map(function (item) {
      return { label: item.label, type: item.type, options: (item.options || []).join(', '), required: !!item.required };
    }) : [{ label: '', type: 'text', options: '', required: false }];
    openDialog(form ? '编辑问卷' : '新建问卷', '<div class="form-grid">' +
      field('标题', '<input id="surveyTitle" maxlength="50" value="' + esc(form ? form.title : '') + '">', true) +
      field('说明', '<input id="surveyDescription" maxlength="300" value="' + esc(form ? form.description || '' : '') + '">', true) +
      '</div><div class="section-heading"><h3>问题</h3><button type="button" class="button small" data-action="survey-add-field">添加问题</button></div><div class="survey-fields" id="surveyFieldEditor"></div>',
      button('取消', 'close-dialog') + button(form ? '保存' : '创建', 'survey-save', true));
    renderSurveyFields();
  }
  function renderSurveyFields() {
    var editor = byId('surveyFieldEditor');
    if (!editor) return;
    editor.innerHTML = state.surveyFields.map(function (item, index) {
      var types = [['text', '单行文字'], ['textarea', '多行文字'], ['radio', '单选'], ['checkbox', '多选'], ['rating', '评分'], ['number', '数字']].map(function (type) {
        return '<option value="' + type[0] + '" ' + (item.type === type[0] ? 'selected' : '') + '>' + type[1] + '</option>';
      }).join('');
      return '<div class="survey-field"><input aria-label="问题 ' + (index + 1) + '" placeholder="问题" value="' + esc(item.label) + '" data-survey-index="' + index + '" data-survey-prop="label">' +
        '<select aria-label="类型" data-survey-index="' + index + '" data-survey-prop="type">' + types + '</select>' +
        '<input class="survey-options" aria-label="选项" placeholder="选项，以逗号分隔" value="' + esc(item.options) + '" data-survey-index="' + index + '" data-survey-prop="options">' +
        '<label class="checkbox-row"><input type="checkbox" data-survey-index="' + index + '" data-survey-prop="required" ' + (item.required ? 'checked' : '') + '>必填</label>' +
        '<button type="button" class="button small remove" data-action="survey-remove-field" data-index="' + index + '" aria-label="删除问题">×</button></div>';
    }).join('');
  }
  function addSurveyField() {
    state.surveyFields.push({ label: '', type: 'text', options: '', required: false });
    renderSurveyFields();
  }
  function removeSurveyField(index) {
    state.surveyFields.splice(index, 1);
    renderSurveyFields();
  }
  async function saveSurvey() {
    var title = byId('surveyTitle').value.trim();
    var fields = state.surveyFields.map(function (item) {
      return {
        label: item.label.trim(),
        type: item.type,
        options: item.options.split(',').map(function (value) { return value.trim(); }).filter(Boolean),
        required: !!item.required
      };
    });
    var id = state.surveyEditingId || '';
    await request('/api/admin/forms' + (id ? '/' + encodeURIComponent(id) : ''), {
      method: id ? 'PUT' : 'POST',
      body: { title: title, description: byId('surveyDescription').value.trim(), fields: fields }
    });
    toast(id ? '问卷已保存' : '问卷已创建');
    closeAndRefresh();
  }
  async function toggleSurvey(id) {
    var form = state.formMap[id];
    if (!form) throw new Error('问卷不存在');
    await request('/api/admin/forms/' + encodeURIComponent(id), {
      method: 'PUT',
      body: { status: form.status === 'open' ? 'closed' : 'open' }
    });
    toast(form.status === 'open' ? '问卷已停止收集' : '问卷已重新开放');
    loadRoute();
  }
  async function showSurveyStats(id) {
    var data = await request('/api/admin/forms/' + encodeURIComponent(id) + '/stats');
    var blocks = data.fields.map(function (item) {
      var distribution = Object.keys(item.distribution || {}).map(function (key) {
        return '<div class="distribution-row"><span>' + esc(key) + '</span><span>' + esc(item.distribution[key]) + '</span></div>';
      }).join('');
      var average = item.average !== null && item.average !== undefined ? '<div class="distribution-row"><span>平均分</span><span>' + item.average + '</span></div>' : '';
      return '<div class="stat-block"><h4>' + esc(item.label) + '</h4>' + (distribution || average || '<div class="distribution-row"><span>暂无回答</span><span>0</span></div>') + '</div>';
    }).join('');
    openDialog('问卷统计', '<div class="callout">' + data.total + ' 份提交</div><div class="stats-list" style="margin-top:18px">' + blocks + '</div>', button('关闭', 'close-dialog'));
  }

  async function renderAppointments(params) {
    var serviceParams = new URLSearchParams();
    serviceParams.set('page', params.get('sp') || '1');
    serviceParams.set('pageSize', '20');
    var appointmentParams = new URLSearchParams();
    appointmentParams.set('page', params.get('ap') || '1');
    appointmentParams.set('pageSize', '20');
    if (params.get('status')) appointmentParams.set('status', params.get('status'));
    var result = await Promise.all([
      request('/api/admin/appointments/services?' + serviceParams.toString()),
      request('/api/admin/appointments?' + appointmentParams.toString())
    ]);
    var services = result[0];
    var appointments = result[1];
    state.serviceMap = {};
    (services.list || []).forEach(function (service) { state.serviceMap[service.id] = service; });
    var serviceRows = (services.list || []).map(function (service) {
      return '<tr><td><div class="cell-primary">' + esc(service.name) + '</div><div class="cell-meta">' + esc((service.slots || []).join('、')) + '</div></td>' +
        '<td>' + yuan(service.price) + '</td><td>' + service.durationMinutes + ' 分钟</td><td>' + service.capacityPerSlot + ' 人/时段</td>' +
        '<td>' + (service.enabled !== false ? '<span class="tag green">可预约</span>' : '<span class="tag gray">已停用</span>') + '</td>' +
        '<td class="cell-actions">' + (canManage() ? button('编辑', 'appointment-service-edit', false, 'data-id="' + esc(service.id) + '"') +
        button(service.enabled !== false ? '停用' : '启用', 'appointment-service-toggle', false, 'data-id="' + esc(service.id) + '"') : '') + '</td></tr>';
    }).join('');
    var statusMap = { booked: ['已预约', 'blue'], completed: ['已完成', 'green'], cancelled: ['已取消', 'gray'] };
    var appointmentRows = (appointments.list || []).map(function (item) {
      var status = statusMap[item.status] || [item.status, 'gray'];
      return '<tr><td class="cell-primary">' + esc(item.serviceName) + '</td><td>' + esc(item.date) + ' ' + esc(item.slot) + '</td>' +
        '<td><span class="tag ' + status[1] + '">' + status[0] + '</span></td><td>' + esc(item.note || '—') + '</td>' +
        '<td class="cell-actions">' + (item.status === 'booked' ? '<button type="button" class="button small" data-action="appointment-complete" data-id="' + esc(item.id) + '">完成</button> <button type="button" class="button small danger" data-action="appointment-cancel" data-id="' + esc(item.id) + '">取消</button>' : '') + '</td></tr>';
    }).join('');
    var statusTabs = [['', '全部'], ['booked', '已预约'], ['completed', '已完成'], ['cancelled', '已取消']].map(function (item) {
      return '<a class="filter-tab ' + ((params.get('status') || '') === item[0] ? 'active' : '') + '" href="' + routeHref('appointments', params, { status: item[0], ap: 1 }) + '">' + item[1] + '</a>';
    }).join('');
    byId('content').innerHTML =
      '<div class="section-heading"><h3>服务</h3></div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>服务</th><th>价格</th><th>时长</th><th>容量</th><th>状态</th><th></th></tr></thead><tbody>' +
      (serviceRows || '<tr><td colspan="6">' + empty('还没有服务') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(services, function (page) { return routeHref('appointments', params, { sp: page }); }) + '</div>' +
      '<div class="section-heading"><h3>预约</h3><div class="filter-tabs">' + statusTabs + '</div></div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>服务</th><th>时间</th><th>状态</th><th>备注</th><th></th></tr></thead><tbody>' +
      (appointmentRows || '<tr><td colspan="5">' + empty('没有预约记录') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(appointments, function (page) { return routeHref('appointments', params, { ap: page }); }) + '</div>';
  }
  function openAppointmentServiceForm(service) {
    service = service || { durationMinutes: 60, capacityPerSlot: 1, enabled: true };
    openDialog(service.id ? '编辑预约服务' : '新增预约服务', '<div class="form-grid">' +
      field('服务名称', '<input id="serviceName" maxlength="30" value="' + esc(service.name || '') + '">', true) +
      field('价格', '<input id="servicePrice" type="number" min="0.01" step="0.01" value="' + Number(service.price || '') + '">') +
      field('时长（分钟）', '<input id="serviceDuration" type="number" min="1" value="' + Number(service.durationMinutes || 60) + '">') +
      field('每时段容量', '<input id="serviceCapacity" type="number" min="1" value="' + Number(service.capacityPerSlot || 1) + '">') +
      field('可约时段', '<input id="serviceSlots" value="' + esc((service.slots || []).join(', ')) + '" placeholder="09:00, 10:00, 14:00">', true) +
      field('状态', '<label class="checkbox-row"><input id="serviceEnabled" type="checkbox" ' + (service.enabled !== false ? 'checked' : '') + '> 对顾客开放预约</label>', true) +
      '</div>', button('取消', 'close-dialog') + button(service.id ? '保存' : '创建', 'appointment-service-save', true, 'data-id="' + esc(service.id || '') + '"'));
  }
  async function saveAppointmentService(id) {
    await request('/api/admin/appointments/services' + (id ? '/' + encodeURIComponent(id) : ''), {
      method: id ? 'PUT' : 'POST',
      body: {
        name: byId('serviceName').value.trim(),
        price: Number(byId('servicePrice').value),
        durationMinutes: Number(byId('serviceDuration').value || 60),
        capacityPerSlot: Number(byId('serviceCapacity').value || 1),
        slots: byId('serviceSlots').value.split(',').map(function (value) { return value.trim(); }).filter(Boolean),
        enabled: byId('serviceEnabled').checked
      }
    });
    toast(id ? '预约服务已保存' : '预约服务已创建');
    closeAndRefresh();
  }
  async function toggleAppointmentService(id) {
    var service = state.serviceMap[id];
    if (!service) throw new Error('预约服务不存在');
    await request('/api/admin/appointments/services/' + encodeURIComponent(id), {
      method: 'PUT',
      body: { enabled: service.enabled === false }
    });
    toast(service.enabled === false ? '预约服务已启用' : '预约服务已停用');
    loadRoute();
  }
  async function finishAppointment(id, action) {
    await request('/api/admin/appointments/' + encodeURIComponent(id) + '/' + action, { method: 'POST', body: {} });
    toast(action === 'complete' ? '预约已完成' : '预约已取消');
    loadRoute();
  }

  var AFTER_SALES_STATUS = {
    pending: ['待受理', 'amber'], approved: ['已受理', 'blue'], resolved: ['已完成', 'green'],
    rejected: ['已拒绝', 'red'], closed: ['已关闭', 'gray']
  };
  var AFTER_SALES_TYPES = { refund: '退款', return: '退货', complaint: '投诉建议' };

  async function renderAfterSales(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    if (!q.status) delete q.status;
    var data = await request('/api/admin/after-sales?' + new URLSearchParams(q).toString());
    state.afterSalesMap = {};
    var rows = (data.list || []).map(function (item) {
      state.afterSalesMap[item.id] = item;
      var status = AFTER_SALES_STATUS[item.status] || [item.status, 'gray'];
      var member = item.member || {};
      return '<tr><td><button class="link-action" data-action="after-sales-detail" data-id="' + esc(item.id) + '">' + esc(item.orderNo) + '</button><div class="cell-meta">' + esc(item.id.slice(0, 8)) + '</div></td>' +
        '<td>' + esc(member.nickname || '会员') + '<div class="cell-meta">' + esc(member.phone || item.memberId.slice(0, 8)) + '</div></td>' +
        '<td>' + esc(AFTER_SALES_TYPES[item.type] || item.type) + '</td><td>' + (Number(item.requestedAmount) ? money(item.requestedAmount) : '—') + '</td>' +
        '<td class="aftersales-reason">' + esc(item.reason) + '</td><td><span class="tag ' + status[1] + '">' + status[0] + '</span></td>' +
        '<td class="cell-nowrap">' + shortDate(item.createdAt) + '</td><td class="cell-actions">' + button('查看', 'after-sales-detail', false, 'data-id="' + esc(item.id) + '"') +
        (item.status === 'pending' ? button('受理', 'after-sales-approve', true, 'data-id="' + esc(item.id) + '"') : '') + '</td></tr>';
    }).join('');
    var tabs = [['', '全部'], ['pending', '待受理'], ['approved', '已受理'], ['resolved', '已完成'], ['rejected', '已拒绝'], ['closed', '已关闭']].map(function (item) {
      return '<a class="filter-tab ' + ((params.get('status') || '') === item[0] ? 'active' : '') + '" href="' + routeHref('after-sales', params, { status: item[0], page: 1 }) + '">' + item[1] + '</a>';
    }).join('');
    byId('content').innerHTML =
      '<div class="toolbar"><div class="filter-tabs">' + tabs + '</div><span class="toolbar-spacer"></span><span class="section-note">建议在 2 小时内完成首次响应</span></div>' +
      '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>工单 / 订单</th><th>客户</th><th>类型</th><th>申请金额</th><th>原因</th><th>状态</th><th>提交时间</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8">' + empty(params.get('status') ? '当前筛选下没有售后工单' : '还没有售后工单') + '</td></tr>') +
      '</tbody></table></div>' + pageInfo(data, function (page) { return routeHref('after-sales', params, { page: page }); }) + '</div>';
  }

  function openAfterSalesDetail(id) {
    var item = state.afterSalesMap[id];
    if (!item) return;
    var status = AFTER_SALES_STATUS[item.status] || [item.status, 'gray'];
    var member = item.member || {};
    var active = item.status === 'pending' || item.status === 'approved';
    var footer = button('关闭', 'close-dialog') + button('查看订单', 'order-detail', false, 'data-id="' + esc(item.orderId) + '"');
    if (item.status === 'pending') footer += button('拒绝', 'after-sales-reject', false, 'data-id="' + esc(item.id) + '"') + button('受理申请', 'after-sales-approve', true, 'data-id="' + esc(item.id) + '"');
    if (item.status === 'approved') footer += button('标记完成', 'after-sales-finish', true, 'data-id="' + esc(item.id) + '"');
    openDialog('售后工单 · ' + item.orderNo, '<div class="detail-hero"><div><div class="detail-title">' + esc(AFTER_SALES_TYPES[item.type] || item.type) + '</div><div class="detail-subtitle">' + shortDate(item.createdAt) + '</div></div><span class="tag ' + status[1] + '">' + status[0] + '</span></div>' +
      '<div class="detail-section"><div class="detail-grid">' +
      '<div class="detail-item"><div class="detail-label">客户</div><div class="detail-value">' + esc(member.nickname || '会员') + '</div></div>' +
      '<div class="detail-item"><div class="detail-label">联系电话</div><div class="detail-value">' + esc(member.phone || '—') + '</div></div>' +
      '<div class="detail-item"><div class="detail-label">申请金额</div><div class="detail-value">' + (Number(item.requestedAmount) ? money(item.requestedAmount) : '不涉及退款') + '</div></div>' +
      '<div class="detail-item"><div class="detail-label">处理人</div><div class="detail-value">' + esc(item.resolvedByName || '—') + '</div></div></div></div>' +
      '<div class="detail-section"><h3>问题说明</h3><div class="message-box"><strong>' + esc(item.reason) + '</strong><p>' + esc(item.description || '顾客未补充详细说明。') + '</p></div></div>' +
      (item.resolution ? '<div class="detail-section"><h3>处理结论</h3><div class="message-box"><p>' + esc(item.resolution) + '</p></div></div>' : '') +
      (active ? '<div class="callout warning">退款资金仍应在订单详情中确认后发起，售后受理不会自动扣款或退款。</div>' : ''), footer);
  }

  function openAfterSalesAction(id, status) {
    var labels = { approved: '受理售后申请', rejected: '拒绝售后申请', resolved: '完成售后申请' };
    openDialog(labels[status] || '更新售后', '<div class="form-grid">' + field('处理说明', '<textarea id="afterSalesResolution" maxlength="500" placeholder="记录与顾客沟通的结果、退款安排或拒绝原因"></textarea>', true) + '</div><p class="form-help">处理说明会同步给顾客的消息记录，并写入审计日志。</p>',
      button('取消', 'close-dialog') + button('确认', 'after-sales-resolve-save', true, 'data-id="' + esc(id) + '" data-status="' + esc(status) + '"'));
  }

  async function saveAfterSalesAction(id, status) {
    var resolution = byId('afterSalesResolution').value.trim();
    if (!resolution && status !== 'approved') throw new Error('请填写处理说明');
    await request('/api/admin/after-sales/' + encodeURIComponent(id), {
      method: 'PUT', body: { status: status, resolution: resolution }
    });
    toast(status === 'approved' ? '售后申请已受理' : status === 'rejected' ? '售后申请已拒绝' : '售后申请已完成');
    closeAndRefresh();
  }

  async function renderGrowth() {
    var result = await Promise.all([
      request('/api/admin/growth'),
      request('/api/admin/growth/materials')
    ]);
    var data = result[0];
    var materialData = result[1];
    var summary = data.summary || {};
    state.growthMaterials = materialData.items || [];
    var metrics = '<div class="summary-grid growth-metrics">' +
      '<div class="summary-cell"><div class="summary-label">会员成交率</div><div class="summary-value">' + Number(summary.buyers || 0) + '<small>/ ' + Number(summary.memberCount || 0) + ' 位</small></div></div>' +
      '<div class="summary-cell"><div class="summary-label">复购率</div><div class="summary-value">' + Number(summary.repurchaseRate || 0) + '<small>%</small></div></div>' +
      '<div class="summary-cell"><div class="summary-label">客单价</div><div class="summary-value compact">' + yuan(summary.averageOrderValue || 0) + '</div></div>' +
      '<div class="summary-cell"><div class="summary-label">累计会员收入</div><div class="summary-value compact">' + yuan(summary.lifetimeRevenue || 0) + '</div></div></div>';
    var segments = (data.segments || []).map(function (segment) {
      return '<article class="growth-segment"><div><span>' + esc(segment.label) + '</span><strong>' + Number(segment.count || 0) + '</strong></div><div class="segment-members">' +
        ((segment.members || []).slice(0, 5).map(function (member) { return '<button type="button" data-action="member-detail" data-id="' + esc(member.id) + '">' + esc(member.nickname) + '<small>' + (member.orderCount ? member.orderCount + ' 单 · ' + yuan(member.totalSpent) : '未成交') + '</small></button>'; }).join('') || '<small>暂无会员</small>') + '</div></article>';
    }).join('');
    var recallRows = (data.recallCandidates || []).map(function (member) {
      return '<tr><td><button class="link-action" data-action="member-detail" data-id="' + esc(member.id) + '">' + esc(member.nickname) + '</button><div class="cell-meta">' + esc(member.phone || member.id.slice(0, 8)) + '</div></td>' +
        '<td>' + esc(member.segment === 'dormant' ? '沉睡会员' : '即将沉睡') + '</td><td>' + (member.inactiveDays == null ? '—' : Number(member.inactiveDays) + ' 天') + '</td><td>' + yuan(member.totalSpent) + '</td></tr>';
    }).join('');
    var materials = state.growthMaterials.map(function (item) {
      return '<article class="material-card"><span>' + esc(item.type) + '</span><h4>' + esc(item.title) + '</h4><p>' + esc(item.content) + '</p>' + button('复制素材', 'growth-copy', false, 'data-id="' + esc(item.id) + '"') + '</article>';
    }).join('');
    byId('content').innerHTML = metrics +
      '<div class="section-heading"><h3>会员分层</h3><span>最近一次成交距今 21 / 45 天为预警边界</span></div><div class="growth-segments">' + (segments || empty('还缺少会员数据')) + '</div>' +
      '<div class="section-heading"><h3>需要主动联系</h3><span>按最近成交时间和历史消费排序</span></div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>会员</th><th>分层</th><th>未成交</th><th>净消费</th></tr></thead><tbody>' + (recallRows || '<tr><td colspan="4">' + empty('当前没有沉睡风险会员') + '</td></tr>') + '</tbody></table></div></div>' +
      '<div class="section-heading"><h3>群运营素材</h3><span>直接复制到微信群，减少临时写文案的时间</span></div><div class="material-grid">' + (materials || empty('当前没有可生成的活动素材')) + '</div>';
  }

  async function copyGrowthMaterial(id) {
    var item = state.growthMaterials.find(function (entry) { return entry.id === id; });
    if (!item) throw new Error('素材不存在');
    var text = item.title + '\n' + item.content;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      var node = document.createElement('textarea');
      node.value = text;
      node.style.position = 'fixed';
      node.style.opacity = '0';
      document.body.appendChild(node);
      node.select();
      document.execCommand('copy');
      node.remove();
    }
    toast('素材已复制');
  }

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

  async function renderSettings() {
    var jobs = [
      { key: 'system', path: '/api/admin/system' },
      { key: 'profile', path: '/api/admin/store' },
      { key: 'subscriptions', path: '/api/admin/subscriptions' },
      { key: 'locations', path: '/api/admin/locations' }
    ];
    if (canManage()) {
      jobs.push({ key: 'diagnostics', path: '/api/admin/system/diagnostics' });
      jobs.push({ key: 'auditVerify', path: '/api/admin/audit-logs/verify' });
      jobs.push({ key: 'assets', path: '/api/admin/assets' });
    }
    if (isOwner()) jobs.push({ key: 'admins', path: '/api/admin/admins' });
    var results = await Promise.all(jobs.map(function (job) { return request(job.path); }));
    var response = {};
    jobs.forEach(function (job, index) { response[job.key] = results[index]; });
    var system = response.system;
    var profile = response.profile;
    var subscriptions = response.subscriptions;
    var locations = response.locations || [];
    var diagnostics = response.diagnostics || null;
    var verify = response.auditVerify || null;
    var admins = response.admins || [];
    var assets = response.assets || [];
    state.store = profile;
    state.staffMap = {};
    state.locationMap = {};
    state.templateMap = {};
    state.assetMap = {};
    admins.forEach(function (admin) { state.staffMap[admin.id] = admin; });
    locations.forEach(function (location) { state.locationMap[location.id] = location; });
    assets.forEach(function (asset) { state.assetMap[asset.id] = asset; });
    var locationRows = locations.map(function (location) {
      state.locationMap[location.id] = location;
      return '<article class="location-card ' + (location.status === 'disabled' ? 'disabled' : '') + '"><div class="location-mark" style="--location-color:' + esc(location.brandColor || '#b84a35') + '">' + esc((location.name || '店').slice(0, 1)) + '</div><div><div class="location-title"><strong>' + esc(location.name) + '</strong>' + (location.isPrimary ? '<span class="tag green">主门店</span>' : '') + (location.status === 'disabled' ? '<span class="tag gray">停用</span>' : '') + '</div><small>' + esc(location.address) + '</small><p>' + esc(location.hours || '') + ' · ' + (location.pickupEnabled ? '可自提' : '不可自提') + ' · ' + (location.deliveryEnabled ? '可配送' : '不配送') + '</p></div>' +
        (isOwner() ? '<div class="row-actions">' + button('编辑', 'location-edit', false, 'data-id="' + esc(location.id) + '"') + '</div>' : '') + '</article>';
    }).join('') || empty('还没有履约门店');
    var templateRows = (subscriptions.templates || []).map(function (item) {
      state.templateMap[item.event] = item;
      return '<div class="template-row"><div><strong>' + esc(item.title || item.event) + '</strong><small>' + esc(item.event) + ' · ' + (item.source === 'tenant' ? '门店配置' : item.source === 'environment' ? '环境变量' : '未配置') + '</small></div><span class="tag ' + (item.enabled && item.configured ? 'green' : item.configured ? 'gray' : 'amber') + '">' + (item.enabled && item.configured ? '启用' : item.configured ? '停用' : '待配置') + '</span><div class="row-actions">' + (canManage() ? button('编辑', 'template-edit', false, 'data-id="' + esc(item.event) + '"') + button(item.enabled ? '停用' : '启用', 'template-toggle', false, 'data-id="' + esc(item.event) + '"') + button('测试', 'template-test', false, 'data-id="' + esc(item.event) + '"') : '') + '</div></div>';
    }).join('') || empty('还没有订阅消息事件');
    var notificationRows = (subscriptions.recent || []).map(function (item) {
      var status = { sent: ['已发送', 'green'], mocked: ['模拟', 'gray'], failed: ['失败', 'red'], sending: ['发送中', 'blue'] }[item.status] || [item.status, 'gray'];
      return '<tr><td>' + esc(item.title || item.event) + '</td><td><span class="tag ' + status[1] + '">' + status[0] + '</span></td><td>' + shortDate(item.createdAt) + '</td></tr>';
    }).join('');
    var staffRows = admins.map(function (admin) {
      return '<div class="staff-row"><div class="staff-identity"><span class="staff-avatar">' + esc(admin.username.slice(0, 1).toUpperCase()) + '</span><span><strong>' + esc(admin.username) + '</strong><small>' + esc(ROLE_LABELS[admin.role] || admin.role) + ' · ' + (admin.status === 'active' ? '正常' : '已停用') + '</small></span></div>' +
        '<div class="row-actions">' + button('编辑', 'staff-edit', false, 'data-id="' + esc(admin.id) + '"') + button('撤销会话', 'staff-revoke', false, 'data-id="' + esc(admin.id) + '"') +
        (admin.role !== 'owner' ? button(admin.status === 'active' ? '停用' : '启用', 'staff-toggle', false, 'data-id="' + esc(admin.id) + '"') : '') + '</div></div>';
    }).join('');
    var staffSection = isOwner() ? '<section class="settings-section"><div class="section-heading"><div><h3>团队与权限</h3><span>密码修改、停用账号或主动撤销会话后会立即失效。</span></div>' + button('新增员工', 'staff-new', true) + '</div><div class="staff-list">' + (staffRows || empty('还没有员工账号')) + '</div></section>' : '';
    var monitoring = diagnostics ? diagnostics.metrics : system.metrics;
    var readiness = diagnostics ? diagnostics.readiness : system.readiness;
    var alerts = (monitoring && monitoring.alerts || []).map(function (item) { return '<div class="monitor-alert ' + esc(item.level) + '"><strong>' + esc(item.title) + '</strong><span>' + esc(item.detail) + '</span></div>'; }).join('');
    var routeRows = ((monitoring && monitoring.routes) || []).slice(0, 8).map(function (item) {
      return '<tr><td><code>' + esc(item.route) + '</code></td><td>' + Number(item.count) + '</td><td>' + Number(item.p95Ms) + ' ms</td><td>' + Number(item.errors) + '</td></tr>';
    }).join('');
    var errors = ((monitoring && monitoring.recentErrors) || []).slice(0, 5).map(function (item) {
      return '<div class="error-row"><strong>' + esc(item.source) + '</strong><span>' + esc(item.message) + '</span><small>' + esc(item.requestId || '无请求号') + ' · ' + shortDate(item.createdAt) + '</small></div>';
    }).join('');
    var readinessHtml = ((readiness && readiness.checks) || []).map(function (item) {
      return '<div class="health-row"><span class="status-dot ' + (item.status === 'up' ? '' : 'warning') + '"></span><strong>' + esc(item.name) + '</strong><small>' + esc(typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail || '')) + '</small></div>';
    }).join('');
    var chainHtml = verify ? '<div class="security-inline ' + (verify.valid ? 'valid' : 'invalid') + '"><span>' + (verify.valid ? '审计链完整' : '审计链异常') + '</span><small>' + Number(verify.checked || 0) + ' 条记录 · 链头 ' + esc(String(verify.headHash || '—').slice(0, 16)) + '</small></div>' : '';
    var companySection = canManage() ? '<section class="settings-section"><div class="section-heading"><div><h3>企业能力</h3><span>关键操作留痕，交易与账单定期核对。</span></div></div><div class="capability-grid">' +
      '<a class="capability-card" href="#/audit"><span>审计日志</span><strong>查看谁在什么时候改了什么</strong><small>进入审计日志</small></a>' +
      '<a class="capability-card" href="#/reports"><span>经营报表</span><strong>查看操作量与门店收入对比</strong><small>查看经营报表</small></a>' +
      '<a class="capability-card" href="#/reconciliation"><span>交易对账</span><strong>识别漏单、金额和退款差异</strong><small>开始核对账单</small></a></div></section>' : '';
    var logoUrl = safeAssetUrl(profile.logoUrl);
    var bannerUrl = safeAssetUrl(profile.brandImageUrl);
    var brandAssetCards = assets.slice(0, 6).map(function (asset) {
      var url = safeAssetUrl(asset.url);
      return '<article class="brand-asset-card"><div class="brand-asset-preview">' + (url ? '<img src="' + esc(url) + '" alt="' + esc(asset.originalName || asset.kind) + '">' : '<span>无预览</span>') + '</div><div><strong>' + esc(asset.kind) + '</strong><small>' + Number(asset.size || 0) + ' B · ' + shortDate(asset.createdAt) + '</small></div></article>';
    }).join('') || empty('还没有上传素材');
    var brandAssetSection = '<section class="settings-section"><div class="section-heading"><div><h3>品牌视觉素材</h3><span>Logo 建议 1:1；Banner 建议 16:9。上传后自动写入当前品牌配置。</span></div>' +
      (isOwner() ? '<div class="upload-actions"><label class="button file-button">上传 Logo<input id="logoAssetInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon" data-asset-kind="logo"></label><label class="button file-button">上传 Banner<input id="bannerAssetInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-asset-kind="banner"></label></div>' : '<span class="tag gray">只读</span>') + '</div>' +
      '<div class="brand-current"><div class="brand-current-preview logo-preview" id="logoCurrentPreview">' + (logoUrl ? '<img src="' + esc(logoUrl) + '" alt="当前 Logo">' : '<span>Logo</span>') + '</div><div class="brand-current-preview banner-preview" id="bannerCurrentPreview">' + (bannerUrl ? '<img src="' + esc(bannerUrl) + '" alt="当前 Banner">' : '<span>Banner</span>') + '</div><div><strong>当前品牌画面</strong><small>素材地址会随门店资料保存，可用于后续小程序装修与分享卡片。</small></div></div>' +
      '<div class="brand-asset-list">' + brandAssetCards + '</div></section>';
    byId('content').innerHTML =
      '<section class="settings-section"><div class="section-heading"><h3>品牌与小程序</h3><span>' + (isOwner() ? '仅所有者可修改' : '只读') + '</span></div><div class="settings-card"><fieldset ' + (isOwner() ? '' : 'disabled') + '><div class="form-grid">' +
      field('门店名称', '<input id="storeNameInput" maxlength="40" value="' + esc(profile.name || '') + '">') + field('品牌色', '<input id="storeBrandColor" type="color" value="' + esc(profile.brandColor || '#b84a35') + '">') +
      field('经营口号', '<input id="storeTagline" maxlength="80" value="' + esc(profile.tagline || '') + '">', true) + field('门店介绍', '<textarea id="storeDescription" maxlength="300">' + esc(profile.description || '') + '</textarea>', true) +
      field('公告', '<input id="storeAnnouncement" maxlength="160" value="' + esc(profile.announcement || '') + '">', true) + field('联系电话', '<input id="storePhone" maxlength="30" value="' + esc(profile.contactPhone || '') + '">') +
      field('默认自提地址', '<input id="storePickup" maxlength="120" value="' + esc(profile.pickupAddress || '') + '">') + field('配送说明', '<input id="storeDelivery" maxlength="160" value="' + esc(profile.deliveryNotice || '') + '">', true) +
      field('小程序标题', '<input id="miniProgramTitle" maxlength="60" value="' + esc(profile.miniProgramTitle || '') + '">') + field('小程序 AppID', '<input id="miniProgramAppId" maxlength="64" value="' + esc(profile.miniProgramAppId || '') + '">') +
      field('客服电话', '<input id="customerServicePhone" maxlength="30" value="' + esc(profile.customerServicePhone || '') + '">', true) +
      field('Logo 地址', '<input id="storeLogoUrl" maxlength="2048" value="' + esc(profile.logoUrl || '') + '" placeholder="/uploads/租户/logo.png">', true) + field('Banner 地址', '<input id="storeBannerUrl" maxlength="2048" value="' + esc(profile.brandImageUrl || '') + '" placeholder="/uploads/租户/banner.png">', true) + '</div></fieldset>' + (isOwner() ? '<div class="settings-actions">' + button('保存品牌与小程序配置', 'store-save', true) + '</div>' : '') + '</div></section>' +
      brandAssetSection +
      '<section class="settings-section"><div class="section-heading"><div><h3>履约门店</h3><span>试点租户最多 20 个门店，自提结算时可选择可用门店。</span></div>' + (isOwner() ? button('新增门店', 'location-new', true) : '') + '</div><div class="location-list">' + locationRows + '</div></section>' +
      staffSection + companySection +
      '<section class="settings-section"><div class="section-heading"><h3>订阅消息模板</h3><span>模板 ID 可由环境变量兜底，可在门店级覆盖。</span></div><div class="template-list">' + templateRows + '</div></section>' +
      '<section class="settings-section"><div class="section-heading"><h3>最近发送</h3><span>发送失败不会阻断支付或履约主链路</span></div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>事件</th><th>状态</th><th>时间</th></tr></thead><tbody>' + (notificationRows || '<tr><td colspan="3">' + empty('暂无发送记录') + '</td></tr>') + '</tbody></table></div></div></section>' +
      '<section class="settings-section"><div class="section-heading"><h3>运行监控</h3><span>Prometheus 指标端点已就绪，多实例指标由外部系统聚合</span></div><div class="environment-grid"><div><span>微信能力</span><strong>' + (system.wechatMock ? '本地模拟' : '正式对接') + '</strong></div><div><span>请求总数</span><strong>' + Number(monitoring && monitoring.totalRequests || 0) + '</strong></div><div><span>错误率</span><strong>' + (Number(monitoring && monitoring.errorRate || 0) * 100).toFixed(2) + '%</strong></div><div><span>就绪状态</span><strong>' + (readiness && readiness.status === 'ok' ? '正常' : '需检查') + '</strong></div></div>' +
      (alerts ? '<div class="monitor-alerts">' + alerts + '</div>' : '<div class="callout" style="margin-top:12px">当前没有触发运行告警。</div>') + '<div class="monitor-health">' + readinessHtml + '</div>' +
      '<div class="data-panel" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>接口</th><th>请求</th><th>P95</th><th>错误</th></tr></thead><tbody>' + (routeRows || '<tr><td colspan="4">' + empty('还没有接口指标') + '</td></tr>') + '</tbody></table></div></div>' +
      (errors ? '<div class="section-heading"><h3>最近错误</h3><span>包含请求追踪号</span></div><div class="error-list">' + errors + '</div>' : '') + '</section>' +
      '<section class="settings-section"><div class="section-heading"><h3>会话与安全</h3><span>令牌按账号版本即时撤销</span></div><div class="security-card"><div><strong>撤销当前账号的全部会话</strong><small>包括当前浏览器，下一步需要重新登录。</small>' + chainHtml + '</div>' + button('撤销并退出', 'session-revoke', false) + '</div></section>' +
      (state.session && state.session.demo && isOwner() ? '<section class="settings-section demo-settings"><div><h3>演示环境</h3><p>重置后恢复 6 个商品、2 个团购、5 位客户和完整经营待办。</p></div>' + button('重新载入演示数据', 'demo-reset', false) + '</section>' : '');
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('读取图片失败')); };
      reader.readAsDataURL(file);
    });
  }

  async function uploadBrandAsset(input) {
    if (!isOwner()) throw new Error('仅所有者可修改品牌素材');
    var file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error('图片不能超过 2 MB');
    var mimeMap = { 'image/vnd.microsoft.icon': 'image/x-icon' };
    var mimeType = mimeMap[file.type] || file.type;
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon'].indexOf(mimeType) < 0) {
      throw new Error('仅支持 PNG、JPEG、WebP、GIF 或 ICO 图片');
    }
    var kind = input.getAttribute('data-asset-kind') || 'brand';
    input.disabled = true;
    try {
      var data = await readFileAsDataUrl(file);
      var asset = await request('/api/admin/assets', { method: 'POST', body: {
        filename: file.name, mimeType: mimeType, data: data, kind: kind
      } });
      var url = safeAssetUrl(asset.url);
      var patch = kind === 'logo' ? { logoUrl: url } : { brandImageUrl: url };
      var updated = await request('/api/admin/store', { method: 'PUT', body: patch });
      state.store = Object.assign({}, state.store || {}, updated);
      var fieldNode = byId(kind === 'logo' ? 'storeLogoUrl' : 'storeBannerUrl');
      var previewNode = byId(kind === 'logo' ? 'logoCurrentPreview' : 'bannerCurrentPreview');
      if (fieldNode) fieldNode.value = url;
      if (previewNode) previewNode.innerHTML = url ? '<img src="' + esc(url) + '" alt="当前 ' + esc(kind) + '">' : '<span>暂无预览</span>';
      toast(kind === 'logo' ? 'Logo 已上传并应用' : 'Banner 已上传并应用');
    } finally {
      input.disabled = false;
      input.value = '';
    }
  }

  async function copyAssetUrl(url) {
    if (!url) throw new Error('素材地址为空');
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(url);
    else {
      var area = document.createElement('textarea');
      area.value = url;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast('素材地址已复制');
  }

  async function saveStoreProfile() {
    var updated = await request('/api/admin/store', {
      method: 'PUT',
      body: {
        name: byId('storeNameInput').value.trim(), tagline: byId('storeTagline').value.trim(),
        description: byId('storeDescription').value.trim(), announcement: byId('storeAnnouncement').value.trim(),
        contactPhone: byId('storePhone').value.trim(), pickupAddress: byId('storePickup').value.trim(),
        deliveryNotice: byId('storeDelivery').value.trim(), brandColor: byId('storeBrandColor').value,
        miniProgramTitle: byId('miniProgramTitle').value.trim(), miniProgramAppId: byId('miniProgramAppId').value.trim(),
        customerServicePhone: byId('customerServicePhone').value.trim(),
        logoUrl: byId('storeLogoUrl').value.trim(), brandImageUrl: byId('storeBannerUrl').value.trim()
      }
    });
    if (state.session) applySession(Object.assign({}, state.session, { store: updated }));
    toast('门店资料已保存');
  }

  function openStaffForm(admin) {
    admin = admin || { role: 'manager', status: 'active' };
    var roleOptions = [['manager', '经营管理员'], ['fulfillment', '履约专员']].map(function (item) {
      return '<option value="' + item[0] + '" ' + (admin.role === item[0] ? 'selected' : '') + '>' + item[1] + '</option>';
    }).join('');
    openDialog(admin.id ? '编辑员工' : '新增员工', '<div class="form-grid">' +
      field('用户名', '<input id="staffUsername" maxlength="32" value="' + esc(admin.username || '') + '" ' + (admin.id ? 'readonly' : '') + '>') +
      field('角色', '<select id="staffRole" ' + (admin.role === 'owner' ? 'disabled' : '') + '>' + (admin.role === 'owner' ? '<option>所有者</option>' : roleOptions) + '</select>') +
      field(admin.id ? '重置密码（可选）' : '初始密码', '<input id="staffPassword" type="password" minlength="10" autocomplete="new-password" placeholder="至少 10 位，含大小写字母和数字">', true) +
      '</div><p class="form-help">密码至少 10 位，必须包含大小写字母和数字，且不能包含用户名。修改密码会立即撤销该账号旧会话。</p>',
      button('取消', 'close-dialog') + button(admin.id ? '保存' : '创建', 'staff-save', true, 'data-id="' + esc(admin.id || '') + '"'));
  }

  async function saveStaff(id) {
    var password = byId('staffPassword').value;
    if (!id) {
      await request('/api/admin/admins', {
        method: 'POST',
        body: { username: byId('staffUsername').value.trim(), password: password, role: byId('staffRole').value }
      });
    } else {
      var body = {};
      var roleNode = byId('staffRole');
      if (!roleNode.disabled) body.role = roleNode.value;
      if (password) body.password = password;
      if (!Object.keys(body).length) throw new Error('没有需要保存的修改');
      await request('/api/admin/admins/' + encodeURIComponent(id), { method: 'PUT', body: body });
    }
    toast(id ? '员工账号已保存' : '员工账号已创建');
    closeAndRefresh();
  }

  async function toggleStaff(id) {
    var admin = state.staffMap[id];
    if (!admin) throw new Error('员工账号不存在');
    await request('/api/admin/admins/' + encodeURIComponent(id), {
      method: 'PUT',
      body: { status: admin.status === 'active' ? 'disabled' : 'active' }
    });
    toast(admin.status === 'active' ? '员工账号已停用' : '员工账号已启用');
    loadRoute();
  }

  function openLocationForm(location) {
    location = location || { pickupEnabled: true, deliveryEnabled: true, status: 'active', brandColor: '#b84a35', hours: '每日 09:00-20:00' };
    openDialog(location.id ? '编辑履约门店' : '新增履约门店', '<div class="form-grid">' +
      field('门店名称', '<input id="locationName" maxlength="40" value="' + esc(location.name || '') + '">') + field('门店编码', '<input id="locationCode" maxlength="20" value="' + esc(location.code || '') + '" placeholder="例如 EAST">') +
      field('详细地址', '<input id="locationAddress" maxlength="160" value="' + esc(location.address || '') + '">', true) + field('联系电话', '<input id="locationPhone" maxlength="30" value="' + esc(location.phone || '') + '">') +
      field('营业时间', '<input id="locationHours" maxlength="80" value="' + esc(location.hours || '') + '">') + field('品牌色', '<input id="locationBrandColor" type="color" value="' + esc(location.brandColor || '#b84a35') + '">') +
      field('能力', '<div class="check-row"><label><input id="locationPickup" type="checkbox" ' + (location.pickupEnabled !== false ? 'checked' : '') + '> 支持自提</label><label><input id="locationDelivery" type="checkbox" ' + (location.deliveryEnabled !== false ? 'checked' : '') + '> 支持配送</label></div>', true) +
      field('状态', '<select id="locationStatus"><option value="active" ' + (location.status !== 'disabled' ? 'selected' : '') + '>启用</option><option value="disabled" ' + (location.status === 'disabled' ? 'selected' : '') + '>停用</option></select>') +
      field('主门店', '<label class="checkbox-row"><input id="locationPrimary" type="checkbox" ' + (location.isPrimary ? 'checked' : '') + '> 设为默认履约门店</label>') +
      '</div>', button('取消', 'close-dialog') + button(location.id ? '保存' : '创建', 'location-save', true, 'data-id="' + esc(location.id || '') + '"'));
  }

  async function saveLocation(id) {
    var body = {
      name: byId('locationName').value.trim(), code: byId('locationCode').value.trim(),
      address: byId('locationAddress').value.trim(), phone: byId('locationPhone').value.trim(),
      hours: byId('locationHours').value.trim(), brandColor: byId('locationBrandColor').value,
      pickupEnabled: byId('locationPickup').checked, deliveryEnabled: byId('locationDelivery').checked,
      status: byId('locationStatus').value, isPrimary: byId('locationPrimary').checked
    };
    await request('/api/admin/locations' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PUT' : 'POST', body: body });
    toast(id ? '履约门店已更新' : '履约门店已创建');
    closeAndRefresh();
  }

  function openTemplateForm(event) {
    var item = state.templateMap[event];
    if (!item) return;
    var dataJson = JSON.stringify(item.data || {}, null, 2);
    openDialog('订阅消息 · ' + (item.title || event), '<div class="form-grid">' +
      field('事件标识', '<input value="' + esc(item.event) + '" readonly>') + field('模板 ID', '<input id="templateIdInput" maxlength="128" value="' + esc(item.templateId || '') + '">') +
      field('点击跳转页面', '<input id="templatePage" maxlength="200" value="' + esc(item.page || '') + '" placeholder="pages/order/detail?id={orderId}">', true) +
      field('字段映射 JSON', '<textarea id="templateData" class="code-input" maxlength="8000">' + esc(dataJson) + '</textarea>', true) +
      field('状态', '<label class="checkbox-row"><input id="templateEnabled" type="checkbox" ' + (item.enabled !== false ? 'checked' : '') + '> 启用此事件</label>') +
      '</div><p class="form-help">字段映射示例：{"thing1":{"value":"订单 {orderNo}"},"amount2":{"value":"{amount}"}}。模板 ID 留空会覆盖环境变量配置为空，请谨慎保存。</p>',
      button('取消', 'close-dialog') + button('保存模板', 'template-save', true, 'data-id="' + esc(event) + '"'));
  }

  async function saveTemplate(event) {
    var raw = byId('templateData').value.trim() || '{}';
    var data;
    try { data = JSON.parse(raw); } catch (error) { throw new Error('字段映射必须是有效 JSON'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('字段映射必须是 JSON 对象');
    await request('/api/admin/subscriptions/' + encodeURIComponent(event), { method: 'PUT', body: {
      templateId: byId('templateIdInput').value.trim(), page: byId('templatePage').value.trim(),
      data: data, enabled: byId('templateEnabled').checked
    } });
    toast('订阅消息模板已保存');
    closeAndRefresh();
  }

  async function testTemplate(event) {
    var result = await request('/api/admin/subscriptions/' + encodeURIComponent(event) + '/test', { method: 'POST', body: {} });
    toast(result && result.mock ? '测试消息已写入模拟发送记录' : '测试消息已发送');
    loadRoute();
  }

  async function toggleTemplate(event) {
    var item = state.templateMap[event];
    if (!item) throw new Error('消息模板不存在');
    await request('/api/admin/subscriptions/' + encodeURIComponent(event), { method: 'PUT', body: {
      templateId: item.templateId || '', page: item.page || '', data: item.data || {}, enabled: !item.enabled
    } });
    toast(item.enabled ? '消息事件已停用' : '消息事件已启用');
    loadRoute();
  }

  async function revokeStaffSessions(id) {
    var admin = state.staffMap[id];
    if (!admin) throw new Error('员工账号不存在');
    if (!confirm('撤销 ' + admin.username + ' 的全部登录会话？对方需要重新登录。')) return;
    await request('/api/admin/admins/' + encodeURIComponent(id) + '/revoke-sessions', { method: 'POST', body: {} });
    toast('该账号的全部会话已撤销');
  }

  async function revokeOwnSessions() {
    if (!confirm('撤销当前账号的全部会话？当前页面也会退出，需要重新登录。')) return;
    await request('/api/admin/session/revoke', { method: 'POST', body: {} });
    logout();
    toast('会话已撤销，请重新登录');
  }

  function openShopExperience() {
    var shopWindow = window.open('/shop', '_blank');
    if (shopWindow) shopWindow.opener = null;
  }

  async function resetDemoData() {
    if (!confirm('重新载入演示数据？当前演示订单、会员和团购数据会被替换。')) return;
    await request('/api/admin/demo/reset', { method: 'POST', body: {} });
    localStorage.removeItem('lt-shop-token');
    localStorage.removeItem('lt-shop-member-id');
    state.session = null;
    state.store = null;
    closeDialog();
    toast('演示数据已重新载入，顾客端会从全新体验开始');
    loadRoute();
  }

  function logout() {
    localStorage.removeItem('lt-admin-token');
    state.session = null;
    state.store = null;
    closeDialog();
    showLogin();
    byId('content').innerHTML = '';
  }

  var actions = {
    'refresh-route': function () { loadRoute(); },
    'close-dialog': function () { closeDialog(); },
    'fill-demo': function () {
      byId('loginUser').value = 'admin';
      byId('loginPass').value = 'admin123';
      byId('loginPass').focus();
    },
    'logout': function () { logout(); },
    'open-shop': function () { openShopExperience(); },
    'demo-reset': function () { return resetDemoData(); },
    'category-manage': function () { return openCategoryManager(); },
    'category-edit': function (node) { return openCategoryForm(node.getAttribute('data-id')); },
    'category-save': function (node) { return saveCategory(node.getAttribute('data-id')); },
    'category-delete': function (node) { return removeCategory(node.getAttribute('data-id')); },
    'product-new': function () { return openProductForm(null); },
    'product-detail': function (node) { return openProductDetail(node.getAttribute('data-id')); },
    'product-edit': async function (node) {
      var id = node.getAttribute('data-id');
      closeDialog();
      var product = await request('/api/admin/products/' + encodeURIComponent(id));
      return openProductForm(product);
    },
    'product-save': function (node) { return saveProduct(node.getAttribute('data-id')); },
    'product-toggle': async function (node) {
      var id = node.getAttribute('data-id');
      var product = await request('/api/admin/products/' + encodeURIComponent(id));
      return toggleProduct(id, product.onSale);
    },
    'product-delete': function (node) { return removeProduct(node.getAttribute('data-id')); },
    'inventory-adjust': function (node) { return openInventoryAdjust(node.getAttribute('data-id')); },
    'inventory-save': function (node) { return saveInventoryAdjust(node.getAttribute('data-id')); },
    'inventory-history': function (node) { return openInventoryHistory(node.getAttribute('data-id')); },
    'inventory-undo': function (node) { return undoInventoryAdjustment(node.getAttribute('data-id')); },
    'order-detail': function (node) { return openOrderDetail(node.getAttribute('data-id')); },
    'order-deliver': function (node) { return deliverOrder(node.getAttribute('data-id')); },
    'order-verify-pickup': function (node) { return verifyPickup(node.getAttribute('data-id')); },
    'order-refund': function (node) { return refundOrder(node.getAttribute('data-id')); },
    'order-export': function () { return exportOrdersCsv(); },
    'batch-deliver': function () { openBatchDeliver(); },
    'batch-submit': function () { return submitBatchDeliver(); },
    'member-detail': function (node) { return openMemberDetail(node.getAttribute('data-id')); },
    'member-points': function (node) { return adjustMemberPoints(node.getAttribute('data-id')); },
    'member-coupon': function (node) { return grantMemberCoupon(node.getAttribute('data-id')); },
    'groupbuy-new': function () { return openGroupBuyForm(); },
    'groupbuy-save': function () { return saveGroupBuy(); },
    'groupbuy-edit': function (node) { openGroupBuyUpdate(node.getAttribute('data-id')); },
    'groupbuy-update-save': function (node) { return saveGroupBuyUpdate(node.getAttribute('data-id')); },
    'groupbuy-cancel': function (node) { return cancelGroupBuy(node.getAttribute('data-id')); },
    'coupon-new': function () { openCouponForm(null); },
    'coupon-edit': function (node) { return openCouponForm(state.couponMap[node.getAttribute('data-id')]); },
    'coupon-save': function (node) { return saveCoupon(node.getAttribute('data-id')); },
    'coupon-toggle': function (node) { return toggleCoupon(node.getAttribute('data-id')); },
    'coupon-delete': function (node) { return removeCoupon(node.getAttribute('data-id')); },
    'survey-new': function () { openSurveyForm(); },
    'survey-edit': function (node) { return openSurveyForm(state.formMap[node.getAttribute('data-id')]); },
    'survey-toggle': function (node) { return toggleSurvey(node.getAttribute('data-id')); },
    'survey-add-field': function () { addSurveyField(); },
    'survey-remove-field': function (node) { removeSurveyField(Number(node.getAttribute('data-index'))); },
    'survey-save': function () { return saveSurvey(); },
    'survey-stats': function (node) { return showSurveyStats(node.getAttribute('data-id')); },
    'appointment-service-new': function () { openAppointmentServiceForm(); },
    'appointment-service-edit': function (node) { return openAppointmentServiceForm(state.serviceMap[node.getAttribute('data-id')]); },
    'appointment-service-save': function (node) { return saveAppointmentService(node.getAttribute('data-id')); },
    'appointment-service-toggle': function (node) { return toggleAppointmentService(node.getAttribute('data-id')); },
    'appointment-complete': function (node) { return finishAppointment(node.getAttribute('data-id'), 'complete'); },
    'appointment-cancel': function (node) {
      if (!confirm('取消这次预约？')) return;
      return finishAppointment(node.getAttribute('data-id'), 'cancel');
    },
    'after-sales-detail': function (node) { openAfterSalesDetail(node.getAttribute('data-id')); },
    'after-sales-approve': function (node) { openAfterSalesAction(node.getAttribute('data-id'), 'approved'); },
    'after-sales-reject': function (node) { openAfterSalesAction(node.getAttribute('data-id'), 'rejected'); },
    'after-sales-finish': function (node) { openAfterSalesAction(node.getAttribute('data-id'), 'resolved'); },
    'after-sales-resolve-save': function (node) { return saveAfterSalesAction(node.getAttribute('data-id'), node.getAttribute('data-status')); },
    'growth-copy': function (node) { return copyGrowthMaterial(node.getAttribute('data-id')); },
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
    },
    'asset-copy': function (node) { return copyAssetUrl(node.getAttribute('data-url')); },
    'store-save': function () { return saveStoreProfile(); },
    'staff-new': function () { openStaffForm(null); },
    'staff-edit': function (node) { openStaffForm(state.staffMap[node.getAttribute('data-id')]); },
    'staff-save': function (node) { return saveStaff(node.getAttribute('data-id')); },
    'staff-toggle': function (node) { return toggleStaff(node.getAttribute('data-id')); },
    'staff-revoke': function (node) { return revokeStaffSessions(node.getAttribute('data-id')); },
    'location-new': function () { openLocationForm(null); },
    'location-edit': function (node) { openLocationForm(state.locationMap[node.getAttribute('data-id')]); },
    'location-save': function (node) { return saveLocation(node.getAttribute('data-id')); },
    'template-edit': function (node) { openTemplateForm(node.getAttribute('data-id')); },
    'template-save': function (node) { return saveTemplate(node.getAttribute('data-id')); },
    'template-toggle': function (node) { return toggleTemplate(node.getAttribute('data-id')); },
    'template-test': function (node) { return testTemplate(node.getAttribute('data-id')); },
    'session-revoke': function () { return revokeOwnSessions(); }
  };

  document.addEventListener('click', function (event) {
    var node = event.target.closest('[data-action]');
    if (!node) return;
    var action = actions[node.getAttribute('data-action')];
    if (!action) return;
    event.preventDefault();
    Promise.resolve(action(node)).catch(function (error) { toast(error.message, true); });
  });
  document.addEventListener('input', function (event) {
    var node = event.target;
    if (node.hasAttribute('data-survey-index')) {
      var item = state.surveyFields[Number(node.getAttribute('data-survey-index'))];
      if (!item) return;
      var prop = node.getAttribute('data-survey-prop');
      item[prop] = node.type === 'checkbox' ? node.checked : node.value;
    }
  });
  document.addEventListener('change', function (event) {
    var node = event.target;
    if (node.hasAttribute('data-asset-kind')) {
      uploadBrandAsset(node).catch(function (error) { toast(error.message, true); });
    }
    if (node.id === 'selectAllOrders') toggleVisibleOrders(node.checked);
    if (node.classList.contains('order-select')) {
      if (node.checked) state.selectedOrders.add(node.getAttribute('data-id'));
      else state.selectedOrders.delete(node.getAttribute('data-id'));
      syncOrderSelection();
    }
    if (node.hasAttribute('data-survey-index')) {
      var item = state.surveyFields[Number(node.getAttribute('data-survey-index'))];
      if (!item) return;
      var prop = node.getAttribute('data-survey-prop');
      item[prop] = node.type === 'checkbox' ? node.checked : node.value;
    }
  });
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (form.id === 'loginForm') {
      login(event);
      return;
    }
    if (form.hasAttribute('data-search')) {
      event.preventDefault();
      var keyword = form.querySelector('[name="keyword"]').value.trim();
      var current = readRoute();
      var params = paramsObject(current.params);
      params.keyword = keyword;
      params.page = '1';
      navigate(current.key, params);
    }
  });
  byId('navToggle').addEventListener('click', function () {
    var open = !document.body.classList.contains('nav-open');
    document.body.classList.toggle('nav-open', open);
    this.setAttribute('aria-expanded', String(open));
    this.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
  });
  byId('sidebarBackdrop').addEventListener('click', closeMobileNav);
  document.querySelectorAll('[data-nav], .brand').forEach(function (node) {
    node.addEventListener('click', closeMobileNav);
  });
  byId('appDialog').addEventListener('click', function (event) {
    if (event.target === this) closeDialog();
  });
  window.addEventListener('hashchange', loadRoute);
  window.addEventListener('error', function (event) {
    if (event.error && event.error.message) toast(event.error.message, true);
  });

  if (!token()) showLogin();
  loadRoute();
})();
