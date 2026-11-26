/* 经营台领域模块：orders */
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
        '<td>' + money(order.payAmount) + '</td><td>' + orderStatusTag(order) + '</td>' +
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
    if (has('cancel') && canManage()) {
      actionHtml += '<div class="action-box"><h4>取消待支付订单</h4><p class="form-help">取消后会立即释放库存、优惠券和已抵扣积分。</p><div class="form-grid">' +
        field('取消原因', '<input id="orderCancelReason" maxlength="100" value="商家取消未付款订单">', true) +
        '</div>' + button('确认取消订单', 'order-admin-cancel', false, 'data-id="' + esc(order.id) + '"') + '</div>';
    }
    if (has('confirm-offline-payment') && canManage()) {
      actionHtml += '<div class="action-box"><h4>确认线下收款</h4><p class="form-help">订单采用线下收款。请先核对实际到账，再填写现金、转账流水或收款说明；系统不会处理资金。</p><div class="form-grid">' +
        field('收款凭证或说明', '<input id="offlinePaymentReference" maxlength="80" placeholder="例如：现金、微信转账尾号 1234">') +
        field('备注', '<input id="offlinePaymentNote" maxlength="120" placeholder="可选">', true) +
        '</div>' + button('确认到账并进入履约', 'order-confirm-offline-payment', true, 'data-id="' + esc(order.id) + '"') + '</div>';
    }
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
    var payment = '<div class="detail-item"><div class="detail-label">收款方式</div><div class="detail-value">' + (order.paymentMode === 'offline' ? '线下收款（商家确认）' : '微信支付') + '</div></div>';
    var refund = order.refund ? '<div class="detail-item full"><div class="detail-label">退款</div><div class="detail-value">' + esc(order.refund.status === 'refunding' ? '处理中' : order.refund.status === 'refunded' ? '已完成' : order.refund.status) + ' · ' + money(order.refundedAmount || order.refund.amount) + '</div></div>' : '';
    openDialog('订单 ' + order.orderNo, '<div class="detail-hero"><div><div class="detail-title">' + money(order.payAmount) + '</div><div class="detail-subtitle">' + shortDate(order.createdAt) + '</div></div>' + orderStatusTag(order) + '</div>' +
      '<div class="detail-section"><div class="detail-grid">' +
      '<div class="detail-item"><div class="detail-label">客户</div><div class="detail-value">' + esc(member.nickname || '会员') + '</div></div>' +
      '<div class="detail-item"><div class="detail-label">手机号</div><div class="detail-value">' + esc(member.phone || '—') + '</div></div>' +
      payment + address + '</div></div>' +
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

async function confirmOfflinePayment(id) {
    var reference = byId('offlinePaymentReference').value.trim();
    if (!reference) throw new Error('请填写收款凭证或说明');
    if (!confirm('确认已经实际收到该订单款项？确认后订单将进入履约流程。')) return;
    await request('/api/admin/orders/' + encodeURIComponent(id) + '/confirm-payment', {
      method: 'POST',
      body: { reference: reference, note: byId('offlinePaymentNote').value.trim() }
    });
    toast('线下收款已确认，订单进入履约流程');
    closeAndRefresh();
  }

async function cancelPendingOrder(id) {
    var reason = byId('orderCancelReason').value.trim();
    if (!reason) throw new Error('请填写取消原因');
    if (!confirm('取消该待支付订单？库存、优惠券和已抵扣积分会立即释放。')) return;
    await request('/api/admin/orders/' + encodeURIComponent(id) + '/cancel', {
      method: 'POST',
      body: { reason: reason }
    });
    toast('订单已取消，库存和权益已释放');
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

  A.register({
    routes: { orders: renderOrders },
    headers: { orders: function () { return (canManage() ? button('导出 CSV', 'order-export', false) : '') + button('批量发货', 'batch-deliver', false, 'disabled'); } },
    actions: {
      'order-detail': function (node) { return openOrderDetail(node.getAttribute('data-id')); },
      'order-deliver': function (node) { return deliverOrder(node.getAttribute('data-id')); },
      'order-confirm-offline-payment': function (node) { return confirmOfflinePayment(node.getAttribute('data-id')); },
      'order-admin-cancel': function (node) { return cancelPendingOrder(node.getAttribute('data-id')); },
      'order-verify-pickup': function (node) { return verifyPickup(node.getAttribute('data-id')); },
      'order-refund': function (node) { return refundOrder(node.getAttribute('data-id')); },
      'order-export': function () { return exportOrdersCsv(); },
      'batch-deliver': function () { openBatchDeliver(); },
      'batch-submit': function () { return submitBatchDeliver(); }
    },
    onChange: function (node) {

      if (node.id === 'selectAllOrders') toggleVisibleOrders(node.checked);
      if (node.classList.contains('order-select')) {
        if (node.checked) state.selectedOrders.add(node.getAttribute('data-id'));
        else state.selectedOrders.delete(node.getAttribute('data-id'));
        syncOrderSelection();
      }
    }
  });
})(window.AdminRuntime);
