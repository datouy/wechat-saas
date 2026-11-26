/**
 * 经营台共享核心：状态、认证、请求、路由、通用 UI 和事件分发。
 * 业务页面按领域拆分为 admin-catalog/orders/customers/operations/settings。
 */
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

function orderStatusTag(order) {
    var status = order.refund && order.refund.status === 'refunding' ? 'refunding' : order.status;
    if (status === 'pending' && order.paymentMode === 'offline') return '<span class="tag amber">待确认收款</span>';
    return statusTag(status);
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

function openShopExperience() {
    var shopWindow = window.open('/shop', '_blank');
    if (shopWindow) shopWindow.opener = null;
  }

function logout() {
    localStorage.removeItem('lt-admin-token');
    state.session = null;
    state.store = null;
    closeDialog();
    showLogin();
    byId('content').innerHTML = '';
  }

  var renderers = {};
  var headers = {};
  var inputHandlers = [];
  var changeHandlers = [];
  var actions = {
    'refresh-route': function () { loadRoute(); },
    'close-dialog': function () { closeDialog(); },
    'fill-demo': function () {
      byId('loginUser').value = 'admin';
      byId('loginPass').value = 'admin123';
      byId('loginPass').focus();
    },
    'logout': function () { logout(); },
    'open-shop': function () { openShopExperience(); }
  };

  function register(module) {
    Object.keys(module.routes || {}).forEach(function (route) { renderers[route] = module.routes[route]; });
    Object.keys(module.headers || {}).forEach(function (route) { headers[route] = module.headers[route]; });
    Object.keys(module.actions || {}).forEach(function (action) { actions[action] = module.actions[action]; });
    if (module.onInput) inputHandlers.push(module.onInput);
    if (module.onChange) changeHandlers.push(module.onChange);
  }

  function renderHeader(route) {
    var render = headers[route];
    setHeader(render ? render() : '');
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
      if (!renderers[current.key]) throw new Error('页面模块未加载: ' + current.key);
      renderHeader(current.key);
      await renderers[current.key](current.params);
      if (loadId === state.loadId) enhanceResponsiveTables();
    } catch (error) {
      if (loadId !== state.loadId) return;
      if (error.message !== '登录已过期') byId('content').innerHTML = errorState(error.message);
    }
  }

  function bindEvents() {
    document.addEventListener('click', function (event) {
      var node = event.target.closest('[data-action]');
      if (!node) return;
      var action = actions[node.getAttribute('data-action')];
      if (!action) return;
      event.preventDefault();
      Promise.resolve(action(node)).catch(function (error) { toast(error.message, true); });
    });
    document.addEventListener('input', function (event) {
      inputHandlers.forEach(function (handler) { handler(event.target); });
    });
    document.addEventListener('change', function (event) {
      changeHandlers.forEach(function (handler) { handler(event.target); });
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
  }

  var started = false;
  function start() {
    if (started) return;
    started = true;
    bindEvents();
    if (!token()) showLogin();
    loadRoute();
  }

  window.AdminRuntime = {
    state: state, ROUTES: ROUTES, STATUS: STATUS, ROLE_LABELS: ROLE_LABELS,
    byId: byId, esc: esc, money: money, yuan: yuan, canManage: canManage, isOwner: isOwner,
    todayString: todayString, shortDate: shortDate, fullDate: fullDate, safeAssetUrl: safeAssetUrl,
    percent: percent, statusTag: statusTag, orderStatusTag: orderStatusTag, paramsObject: paramsObject,
    routeHref: routeHref, navigate: navigate, readRoute: readRoute, request: request, requestAll: requestAll,
    categories: categories, applySession: applySession, toast: toast, setHeader: setHeader, button: button,
    linkButton: linkButton, loading: loading, empty: empty, errorState: errorState, pageInfo: pageInfo,
    field: field, searchForm: searchForm, openDialog: openDialog, closeDialog: closeDialog,
    closeAndRefresh: closeAndRefresh, loadRoute: loadRoute, logout: logout, register: register, start: start
  };
})();
