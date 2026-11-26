/* 经营台领域模块：catalog */
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

  A.register({
    routes: { today: renderToday, products: renderProducts },
    headers: { today: function () { return button('刷新', 'refresh-route', false); },
      products: function () { return canManage() ? button('分类管理', 'category-manage', false) + button('新增商品', 'product-new', true) : ''; } },
    actions: {
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
      'inventory-undo': function (node) { return undoInventoryAdjustment(node.getAttribute('data-id')); }
    }
  });
})(window.AdminRuntime);
