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
    settings: '设置'
  };
  var ALIASES = {
    dashboard: 'today',
    members: 'customers',
    groupbuys: 'group-buys',
    forms: 'surveys'
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
    loadId: 0
  };
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
      showLogin();
      throw new Error('登录已过期');
    }
    if (!response.ok || !data || !data.success) {
      var message = data && data.error ? data.error : '请求失败';
      if (data && data.details) {
        var first = Object.keys(data.details)[0];
        if (first && data.details[first] && data.details[first][0]) message = data.details[first][0];
      }
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
    if (['group-buys', 'coupons', 'surveys', 'appointments', 'settings'].indexOf(route) >= 0) byId('moreNav').open = true;
  }
  function renderHeader(route) {
    if (route === 'today') setHeader(button('刷新', 'refresh-route', false));
    else if (route === 'products') setHeader(button('新增商品', 'product-new', true));
    else if (route === 'orders') setHeader(button('批量发货', 'batch-deliver', false, 'disabled'));
    else if (route === 'group-buys') setHeader(button('发起团购', 'groupbuy-new', true));
    else if (route === 'coupons') setHeader(button('新建优惠券', 'coupon-new', true));
    else if (route === 'surveys') setHeader(button('新建问卷', 'survey-new', true));
    else if (route === 'appointments') setHeader(button('新增服务', 'appointment-service-new', true));
    else setHeader('');
  }
  function closeMobileNav() {
    document.body.classList.remove('nav-open');
    byId('navToggle').setAttribute('aria-expanded', 'false');
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
    renderHeader(current.key);
    closeMobileNav();
    if (!token()) showLogin();
    loading();
    try {
      var renderers = {
        today: renderToday,
        products: renderProducts,
        orders: renderOrders,
        customers: renderCustomers,
        'group-buys': renderGroupBuys,
        coupons: renderCoupons,
        surveys: renderSurveys,
        appointments: renderAppointments,
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
    var summary = '<div class="summary-grid">' +
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
      return '<a class="task-row" href="' + esc(task.href) + '"><div class="task-main"><div class="task-title"><span>' + esc(task.title) + '</span><span class="count">' + Number(task.count) + '</span></div><div class="task-meta">' + esc(items) + '</div></div><span class="row-arrow">›</span></a>';
    }).join('') : empty('今天没有待办');
    byId('content').innerHTML = summary +
      '<div class="section-heading"><h3>待办</h3><span>' + esc(data.date) + '</span></div>' +
      '<div class="task-list">' + taskHtml + '</div>';
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
      '</div></div>', button('关闭', 'close-dialog') + button('删除', 'product-delete', false, 'data-id="' + esc(product.id) + '"') +
      button(product.onSale ? '下架' : '上架', 'product-toggle', false, 'data-id="' + esc(product.id) + '"') +
      button('编辑', 'product-edit', true, 'data-id="' + esc(product.id) + '"'));
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
    if (has('refund')) {
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

  async function renderCustomers(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/members?' + new URLSearchParams(q).toString());
    var rows = (data.list || []).map(function (member) {
      return '<tr><td><div class="cell-primary">' + esc(member.nickname || '微信用户') + '</div><div class="cell-meta">' + esc(member.id) + '</div></td>' +
        '<td>' + esc(member.phone || '—') + '</td><td>' + Number(member.orderCount || 0) + '</td><td>' + yuan(member.totalSpent || 0) + '</td>' +
        '<td class="cell-nowrap">' + shortDate(member.lastLoginAt || member.createdAt) + '</td></tr>';
    }).join('');
    byId('content').innerHTML = '<div class="toolbar">' + searchForm('搜索昵称或手机号', params) + '</div>' +
      '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>客户</th><th>手机号</th><th>订单</th><th>累计消费</th><th>最近登录</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5">' + empty('没有匹配的客户') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('customers', params, { page: page }); }) + '</div>';
  }

  async function renderGroupBuys(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/groupbuys?' + new URLSearchParams(q).toString());
    var rows = (data.list || []).map(function (group) {
      var status = { active: ['进行中', 'blue'], success: ['已成团', 'green'], closed: ['已结束', 'gray'], cancelled: ['已取消', 'red'] }[group.status] || [group.status, 'gray'];
      return '<tr><td><div class="cell-primary">' + esc(group.title) + '</div><div class="cell-meta">' + esc(group.product ? group.product.name : '商品已删除') + '</div></td>' +
        '<td>' + money(group.groupPrice) + '</td><td>' + group.participantCount + ' / ' + group.minParticipants + '</td>' +
        '<td><span class="tag ' + status[1] + '">' + status[0] + '</span></td><td class="cell-nowrap">' + fullDate(group.endAt) + '</td>' +
        '<td class="cell-actions">' + (group.status === 'active' ? '<button type="button" class="button small danger" data-action="groupbuy-cancel" data-id="' + esc(group.id) + '">结束</button>' : '') + '</td></tr>';
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

  async function renderCoupons(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/coupons?' + new URLSearchParams(q).toString());
    var rows = (data.list || []).map(function (coupon) {
      return '<tr><td class="cell-primary">' + esc(coupon.name) + '</td><td>满 ' + yuan(coupon.threshold) + '</td><td>减 ' + yuan(coupon.amount) + '</td>' +
        '<td>' + coupon.validDays + ' 天</td><td>' + coupon.limitPerMember + ' 张/人</td><td>' + (coupon.enabled ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>') + '</td></tr>';
    }).join('');
    byId('content').innerHTML = '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>名称</th><th>门槛</th><th>优惠</th><th>有效期</th><th>领取上限</th><th>状态</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">' + empty('还没有优惠券') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('coupons', params, { page: page }); }) + '</div>';
  }
  function openCouponForm() {
    openDialog('新建优惠券', '<div class="form-grid">' +
      field('名称', '<input id="couponName" maxlength="30">', true) +
      field('使用门槛', '<input id="couponThreshold" type="number" min="0" step="0.01" value="0">') +
      field('优惠金额', '<input id="couponAmount" type="number" min="0.01" step="0.01">') +
      field('有效期', '<input id="couponDays" type="number" min="1" value="30">') +
      field('每人限领', '<input id="couponLimit" type="number" min="1" value="1">') +
      '</div>', button('取消', 'close-dialog') + button('创建', 'coupon-save', true));
  }
  async function saveCoupon() {
    await request('/api/admin/coupons', {
      method: 'POST',
      body: {
        name: byId('couponName').value.trim(),
        threshold: Number(byId('couponThreshold').value || 0),
        amount: Number(byId('couponAmount').value),
        validDays: Number(byId('couponDays').value || 30),
        limitPerMember: Number(byId('couponLimit').value || 1)
      }
    });
    toast('优惠券已创建');
    closeAndRefresh();
  }

  async function renderSurveys(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/forms?' + new URLSearchParams(q).toString());
    var rows = (data.list || []).map(function (form) {
      return '<tr><td><div class="cell-primary">' + esc(form.title) + '</div><div class="cell-meta">' + esc(form.description || '') + '</div></td>' +
        '<td>' + form.fields.length + '</td><td>' + (form.status === 'open' ? '<span class="tag green">收集中</span>' : '<span class="tag gray">已关闭</span>') + '</td>' +
        '<td class="cell-nowrap">' + shortDate(form.createdAt) + '</td><td class="cell-actions"><button type="button" class="button small" data-action="survey-stats" data-id="' + esc(form.id) + '">统计</button></td></tr>';
    }).join('');
    byId('content').innerHTML = '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>问卷</th><th>题数</th><th>状态</th><th>创建时间</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5">' + empty('还没有问卷') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('surveys', params, { page: page }); }) + '</div>';
  }
  function openSurveyForm() {
    state.surveyFields = [{ label: '', type: 'text', options: '', required: false }];
    openDialog('新建问卷', '<div class="form-grid">' +
      field('标题', '<input id="surveyTitle" maxlength="50">', true) +
      field('说明', '<input id="surveyDescription" maxlength="300">', true) +
      '</div><div class="section-heading"><h3>问题</h3><button type="button" class="button small" data-action="survey-add-field">添加问题</button></div><div class="survey-fields" id="surveyFieldEditor"></div>',
      button('取消', 'close-dialog') + button('创建', 'survey-save', true));
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
    await request('/api/admin/forms', {
      method: 'POST',
      body: { title: title, description: byId('surveyDescription').value.trim(), fields: fields }
    });
    toast('问卷已创建');
    closeAndRefresh();
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
    var serviceRows = (services.list || []).map(function (service) {
      return '<tr><td><div class="cell-primary">' + esc(service.name) + '</div><div class="cell-meta">' + esc((service.slots || []).join('、')) + '</div></td>' +
        '<td>' + yuan(service.price) + '</td><td>' + service.durationMinutes + ' 分钟</td><td>' + service.capacityPerSlot + ' 人/时段</td></tr>';
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
    byId('content').innerHTML = '<div class="section-heading"><h3>服务</h3></div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>服务</th><th>价格</th><th>时长</th><th>容量</th></tr></thead><tbody>' +
      (serviceRows || '<tr><td colspan="4">' + empty('还没有服务') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(services, function (page) { return routeHref('appointments', params, { sp: page }); }) + '</div>' +
      '<div class="section-heading"><h3>预约</h3><div class="filter-tabs">' + statusTabs + '</div></div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>服务</th><th>时间</th><th>状态</th><th>备注</th><th></th></tr></thead><tbody>' +
      (appointmentRows || '<tr><td colspan="5">' + empty('没有预约记录') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(appointments, function (page) { return routeHref('appointments', params, { ap: page }); }) + '</div>';
  }
  function openAppointmentServiceForm() {
    openDialog('新增预约服务', '<div class="form-grid">' +
      field('服务名称', '<input id="serviceName" maxlength="30">', true) +
      field('价格', '<input id="servicePrice" type="number" min="0.01" step="0.01">') +
      field('时长（分钟）', '<input id="serviceDuration" type="number" min="1" value="60">') +
      field('每时段容量', '<input id="serviceCapacity" type="number" min="1" value="1">') +
      field('可约时段', '<input id="serviceSlots" placeholder="09:00, 10:00, 14:00">', true) +
      '</div>', button('取消', 'close-dialog') + button('创建', 'appointment-service-save', true));
  }
  async function saveAppointmentService() {
    await request('/api/admin/appointments/services', {
      method: 'POST',
      body: {
        name: byId('serviceName').value.trim(),
        price: Number(byId('servicePrice').value),
        durationMinutes: Number(byId('serviceDuration').value || 60),
        capacityPerSlot: Number(byId('serviceCapacity').value || 1),
        slots: byId('serviceSlots').value.split(',').map(function (value) { return value.trim(); }).filter(Boolean)
      }
    });
    toast('预约服务已创建');
    closeAndRefresh();
  }
  async function finishAppointment(id, action) {
    await request('/api/admin/appointments/' + encodeURIComponent(id) + '/' + action, { method: 'POST', body: {} });
    toast(action === 'complete' ? '预约已完成' : '预约已取消');
    loadRoute();
  }

  async function renderSettings() {
    var result = await Promise.all([
      request('/api/admin/system'),
      request('/api/admin/subscriptions')
    ]);
    var system = result[0];
    var subscriptions = result[1];
    byId('sidebarFoot').innerHTML = '<span class="status-dot ' + (system.wechatMock ? 'warning' : '') + '"></span>' + (system.wechatMock ? '模拟模式' : '正式环境');
    var templateRows = (subscriptions.templates || []).map(function (item) {
      return '<div class="distribution-row"><span>' + esc(item.title || item.event) + '</span><span>' + (item.templateId ? '已配置' : '未配置') + '</span></div>';
    }).join('') || empty('未配置模板');
    var notificationRows = (subscriptions.recent || []).map(function (item) {
      var status = { sent: ['已发送', 'green'], mocked: ['模拟', 'gray'], failed: ['失败', 'red'], sending: ['发送中', 'blue'] }[item.status] || [item.status, 'gray'];
      return '<tr><td>' + esc(item.event) + '</td><td><span class="tag ' + status[1] + '">' + status[0] + '</span></td><td>' + shortDate(item.createdAt) + '</td></tr>';
    }).join('');
    byId('content').innerHTML = '<div class="summary-grid" style="grid-template-columns:1fr 1fr">' +
      '<div class="summary-cell"><div class="summary-label">运行环境</div><div class="summary-value compact">' + (system.wechatMock ? '模拟模式' : '正式对接') + '</div><div class="cell-meta">Node ' + esc(system.nodeVersion) + '</div></div>' +
      '<div class="summary-cell"><div class="summary-label">商户</div><div class="summary-value compact">' + esc(system.tenantId) + '</div><div class="cell-meta">运行 ' + Math.round(system.uptime / 60) + ' 分钟</div></div>' +
      '</div><div class="section-heading"><h3>订阅消息</h3></div><div class="data-panel" style="padding:16px 18px">' + templateRows + '</div>' +
      '<div class="section-heading"><h3>最近发送</h3></div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>事件</th><th>状态</th><th>时间</th></tr></thead><tbody>' +
      (notificationRows || '<tr><td colspan="3">' + empty('暂无发送记录') + '</td></tr>') + '</tbody></table></div></div>';
  }

  var actions = {
    'refresh-route': function () { loadRoute(); },
    'close-dialog': function () { closeDialog(); },
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
    'order-detail': function (node) { return openOrderDetail(node.getAttribute('data-id')); },
    'order-deliver': function (node) { return deliverOrder(node.getAttribute('data-id')); },
    'order-verify-pickup': function (node) { return verifyPickup(node.getAttribute('data-id')); },
    'order-refund': function (node) { return refundOrder(node.getAttribute('data-id')); },
    'batch-deliver': function () { openBatchDeliver(); },
    'batch-submit': function () { return submitBatchDeliver(); },
    'groupbuy-new': function () { return openGroupBuyForm(); },
    'groupbuy-save': function () { return saveGroupBuy(); },
    'groupbuy-cancel': function (node) { return cancelGroupBuy(node.getAttribute('data-id')); },
    'coupon-new': function () { openCouponForm(); },
    'coupon-save': function () { return saveCoupon(); },
    'survey-new': function () { openSurveyForm(); },
    'survey-add-field': function () { addSurveyField(); },
    'survey-remove-field': function (node) { removeSurveyField(Number(node.getAttribute('data-index'))); },
    'survey-save': function () { return saveSurvey(); },
    'survey-stats': function (node) { return showSurveyStats(node.getAttribute('data-id')); },
    'appointment-service-new': function () { openAppointmentServiceForm(); },
    'appointment-service-save': function () { return saveAppointmentService(); },
    'appointment-complete': function (node) { return finishAppointment(node.getAttribute('data-id'), 'complete'); },
    'appointment-cancel': function (node) {
      if (!confirm('取消这次预约？')) return;
      return finishAppointment(node.getAttribute('data-id'), 'cancel');
    }
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
