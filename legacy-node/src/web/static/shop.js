(function () {
  'use strict';

  var state = {
    home: null,
    member: null,
    points: null,
    checkout: null,
    coupons: [],
    orders: [],
    afterSales: [],
    selectedProduct: null,
    selectedGroup: null,
    quantity: 1,
    deliveryType: 'delivery',
    categoryId: '',
    editingAddressId: '',
    selectedOrderId: '',
    pickupLocationId: ''
  };
  var toastTimer = null;

  function byId(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(cents) { return '¥' + (Number(cents || 0) / 100).toFixed(2); }
  function token() { return localStorage.getItem('lt-shop-token') || ''; }
  function memberId() { return localStorage.getItem('lt-shop-member-id') || ''; }
  function statusText(status, order) {
    if (status === 'pending' && order && order.paymentMode === 'offline') return '待确认收款';
    return { pending: '待支付', paid: '待履约', delivering: '配送中', completed: '已完成', cancelled: '已取消', refunding: '退款处理中', refunded: '已退款' }[status] || status;
  }
  function toast(message, error) {
    var node = byId('shopToast');
    node.textContent = message;
    node.style.background = error ? '#a33b35' : '#20251f';
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('show'); }, 3200);
  }

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
    if (!response.ok || !data || !data.success) {
      var message = (data && data.error) || '请求失败';
      if (data && data.requestId) message += '（追踪号 ' + data.requestId + '）';
      throw new Error(message);
    }
    return data.data;
  }

  async function login(force) {
    if (!force && token()) return;
    localStorage.removeItem('lt-shop-token');
    localStorage.removeItem('lt-shop-member-id');
    var data = await request('/api/wx/login', { method: 'POST', body: { code: 'browser-demo' } });
    localStorage.setItem('lt-shop-token', data.token);
    localStorage.setItem('lt-shop-member-id', data.memberId);
  }

  async function load() {
    try {
      var home = await request('/api/wx/home');
      state.home = home;
      renderHome();
      await login(true);
      await loadMember();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function loadMember() {
    var mid = memberId();
    if (!mid) return;
    var result = await Promise.all([
      request('/api/wx/member/' + encodeURIComponent(mid)),
      request('/api/wx/member/' + encodeURIComponent(mid) + '/points'),
      request('/api/wx/member/' + encodeURIComponent(mid) + '/coupons?status=unused'),
      request('/api/wx/orders'),
      request('/api/wx/checkout'),
      request('/api/wx/after-sales')
    ]);
    state.member = result[0];
    state.points = result[1];
    state.coupons = result[2];
    state.orders = result[3];
    state.checkout = result[4];
    state.afterSales = result[5];
    renderMember();
    renderGroups();
    renderOrders();
  }

  function renderHome() {
    var tenant = state.home.tenant || {};
    document.title = tenant.miniProgramTitle || tenant.name || '邻里团';
    byId('storeName').textContent = tenant.name || '邻里团';
    byId('brandMark').textContent = (tenant.name || '邻').replace(/^邻里团\s*·?\s*/, '').slice(0, 1) || '邻';
    document.documentElement.style.setProperty('--brand', tenant.brandColor || '#b84a35');
    document.documentElement.style.removeProperty('--brand-dark');
    var customerService = byId('customerServiceLink');
    if (customerService) {
      var servicePhone = tenant.customerServicePhone || tenant.contactPhone || '';
      customerService.textContent = servicePhone ? '客服 ' + servicePhone : '联系门店';
      customerService.href = servicePhone ? 'tel:' + servicePhone : '#/';
      customerService.hidden = !servicePhone;
    }
    renderCategories();
    renderGroups();
    renderProducts();
  }

  function renderMember() {
    byId('memberGreeting').textContent = state.member.nickname || '邻里会员';
    byId('memberPoints').textContent = state.points.balance;
    byId('memberOrders').textContent = state.member.orderCount || 0;
    byId('memberCoupons').textContent = state.coupons.length;
  }

  function renderCategories() {
    var tabs = [{ id: '', name: '全部' }].concat(state.home.categories || []);
    byId('categoryTabs').innerHTML = tabs.map(function (category) {
      return '<button type="button" class="category-tab ' + (state.categoryId === category.id ? 'active' : '') + '" data-category="' + esc(category.id) + '">' + esc(category.name) + '</button>';
    }).join('');
  }

  function renderGroups() {
    var groups = state.home.groupBuys || [];
    if (!groups.length) {
      byId('groupGrid').innerHTML = '<div class="order-card">暂无进行中的团购</div>';
      return;
    }
    byId('groupGrid').innerHTML = groups.map(function (group) {
      var progress = Math.min(100, Math.round(group.participantCount / group.minParticipants * 100));
      var joined = state.member && (group.participants || []).some(function (item) { return item.memberId === memberId(); });
      return '<article class="group-card"><button type="button" class="group-action" data-group-buy="' + esc(group.id) + '" data-product="' + esc(group.productId) + '">' + (joined ? (group.status === 'success' ? '去购买' : '已参团') : '加入团购') + '</button>' +
        '<h3>' + esc(group.title) + '</h3><p>' + esc((group.product || {}).name || '') + ' · ' + group.participantCount + '/' + group.minParticipants + ' 人</p>' +
        '<div class="group-progress"><span style="width:' + progress + '%"></span></div><div class="group-foot"><strong>' + money(group.groupPrice) + '</strong><span>' + (group.status === 'success' ? '已成团，可按团购价购买' : '还差 ' + group.remaining + ' 人成团') + '</span><span>' + (group.status === 'success' ? '已成团' : '进行中') + '</span></div></article>';
    }).join('');
  }

  function renderProducts() {
    var products = state.home.products || [];
    if (state.categoryId) products = products.filter(function (product) { return product.categoryId === state.categoryId; });
    byId('productGrid').innerHTML = products.map(function (product) {
      var image = product.image ? '<img src="' + esc(product.image) + '" alt="">' : '';
      return '<article class="product-card"><div class="product-image">' + image + '</div><div class="product-body">' +
        '<h3 class="product-title">' + esc(product.name) + '</h3><p class="product-description">' + esc(product.description || '') + '</p>' +
        '<div class="product-foot"><div><span class="product-price">¥' + Number(product.price).toFixed(2) + '</span><span class="product-unit">/ ' + esc(product.unit) + '</span></div>' +
        '<button type="button" class="buy-button" data-buy="' + esc(product.id) + '">立即购买</button></div></div></article>';
    }).join('') || '<div class="order-card">当前分类还没有商品。</div>';
  }

  function renderOrders() {
    if (!state.orders.length) {
      byId('orderList').innerHTML = '<div class="order-card">暂无订单</div>';
      return;
    }
    byId('orderList').innerHTML = state.orders.slice(0, 6).map(function (order) {
      return '<button type="button" class="order-card" data-order-id="' + esc(order.id) + '"><div><strong>' + esc(order.orderNo) + '</strong><small>' + (order.items || []).map(function (item) { return item.name + ' × ' + item.quantity; }).join('、') + '</small></div>' +
        '<div><span class="order-state">' + esc(statusText(order.status, order)) + '</span><small>' + (order.deliveryType === 'pickup' ? '自提' : '配送') + ' · 查看详情</small></div>' +
        '<div class="order-amount">' + money(order.payAmount) + '</div></button>';
    }).join('');
  }

  function openShopDialog(title, body, footer) {
    byId('shopDialogTitle').textContent = title;
    byId('shopDialogBody').innerHTML = body;
    byId('shopDialogFooter').innerHTML = footer || '';
    var dialog = byId('shopDialog');
    if (dialog.open) dialog.close();
    dialog.showModal();
  }

  function closeShopDialog() {
    var dialog = byId('shopDialog');
    if (dialog.open) dialog.close();
  }

  function addresses() {
    return (state.member && state.member.addresses) || [];
  }

  function defaultAddress() {
    return addresses().find(function (item) { return item.isDefault; }) || addresses()[0] || null;
  }

  function pickupLocations() {
    return ((state.home && state.home.locations) || []).filter(function (item) { return item.pickupEnabled; });
  }

  function activeAfterSales(orderId) {
    return (state.afterSales || []).find(function (item) {
      return item.orderId === orderId && (item.status === 'pending' || item.status === 'approved');
    }) || null;
  }

  async function openOrderDetail(id) {
    var order = await request('/api/wx/orders/' + encodeURIComponent(id));
    state.selectedOrderId = id;
    var pending = (order.afterSales || []).find(function (item) { return item.status === 'pending'; });
    var canRequest = ['paid', 'delivering', 'completed'].indexOf(order.status) >= 0 && !(order.afterSales || []).some(function (item) { return item.status === 'pending' || item.status === 'approved'; });
    var items = (order.items || []).map(function (item) {
      return '<div class="detail-line"><span>' + esc(item.name) + ' × ' + Number(item.quantity) + '</span><strong>' + money(item.subtotal) + '</strong></div>';
    }).join('');
    var pickup = order.deliveryType === 'pickup' ? '<div class="detail-note"><span>自提门店</span><strong>' + esc((order.pickupLocation && order.pickupLocation.name) || '社区服务站') + '</strong><small>' + esc((order.pickupLocation && order.pickupLocation.address) || '') + '</small></div>' : '<div class="detail-note"><span>配送地址</span><strong>' + esc(order.address ? order.address.name + ' · ' + order.address.phone : '未填写') + '</strong><small>' + esc(order.address ? order.address.detail : '') + '</small></div>';
    var pickupCode = order.pickupCode ? '<div class="pickup-code"><span>取货码</span><strong>' + esc(order.pickupCode) + '</strong><small>请在到店时出示</small></div>' : '';
    var logistics = order.logistics ? '<div class="detail-line muted"><span>物流</span><strong>' + esc((order.logistics.company || '') + ' ' + (order.logistics.trackingNo || '')) + '</strong></div>' : '';
    var refund = order.refund ? '<div class="detail-line warning"><span>退款</span><strong>' + esc(order.refund.status === 'refunded' ? '已退款' : '处理中') + ' · ' + money(order.refund.amount) + '</strong></div>' : '';
    var afterSales = (order.afterSales || []).map(function (item) {
      return '<div class="after-sales-line"><div><strong>' + esc(afterSalesType(item.type)) + '</strong><small>' + esc(item.reason) + ' · ' + shortDate(item.createdAt) + '</small></div><span class="after-sales-state">' + esc(afterSalesStatus(item.status)) + '</span></div>';
    }).join('');
    var footer = '<button type="button" class="button" data-shop-action="close-dialog">关闭</button>';
    if (pending) footer += '<button type="button" class="button" data-shop-action="cancel-after-sales" data-id="' + esc(pending.id) + '">撤回售后</button>';
    else if (canRequest) footer += '<button type="button" class="button primary" data-shop-action="request-after-sales" data-id="' + esc(order.id) + '">申请售后</button>';
    var paymentNote = order.paymentMode === 'offline'
      ? '<div class="detail-line"><span>收款方式</span><strong>线下收款</strong></div><div class="detail-line muted"><span>付款说明</span><strong>' + esc(order.paymentInstructions || '请联系门店确认付款方式') + '</strong></div>'
      : '<div class="detail-line"><span>收款方式</span><strong>微信支付</strong></div>';
    openShopDialog('订单 ' + order.orderNo, '<div class="order-detail-head"><div><span class="eyebrow">订单详情</span><strong>' + money(order.payAmount) + '</strong><small>' + shortDate(order.createdAt) + '</small></div><span class="order-detail-status">' + esc(statusText(order.status, order)) + '</span></div>' +
      '<div class="detail-section"><h3>商品明细</h3>' + items + '<div class="detail-line total"><span>实付金额</span><strong>' + money(order.payAmount) + '</strong></div>' + logistics + refund + '</div>' +
      '<div class="detail-section"><h3>收款与履约信息</h3>' + paymentNote + pickup + pickupCode + '</div>' +
      '<div class="detail-section"><h3>售后记录</h3>' + (afterSales || '<div class="detail-empty">暂无售后申请。签收或支付后可在这里发起。</div>') + '</div>', footer);
  }

  function afterSalesType(type) {
    return { refund: '退款申请', return: '退货申请', complaint: '投诉建议' }[type] || type;
  }

  function afterSalesStatus(status) {
    return { pending: '待受理', approved: '已受理', resolved: '已完成', rejected: '未通过', closed: '已撤回' }[status] || status;
  }

  function shortDate(value) {
    var date = new Date(value);
    return isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function openAddressManager() {
    var list = addresses().map(function (address) {
      return '<article class="address-card"><div><strong>' + esc(address.name) + ' · ' + esc(address.phone) + '</strong><small>' + esc(address.detail) + '</small></div><span class="tag">' + (address.isDefault ? '默认地址' : '收货地址') + '</span><div class="address-actions">' +
        (address.isDefault ? '' : '<button type="button" data-shop-action="address-default" data-id="' + esc(address.id) + '">设为默认</button>') +
        '<button type="button" data-shop-action="address-edit" data-id="' + esc(address.id) + '">编辑</button><button type="button" class="danger-text" data-shop-action="address-delete" data-id="' + esc(address.id) + '">删除</button></div></article>';
    }).join('');
    openShopDialog('收货地址', '<div class="account-note"><strong>最多保存 10 个地址</strong><span>配送结算会自动使用默认地址，也可以在下单时切换。</span></div><div class="address-list">' + (list || '<div class="detail-empty">还没有收货地址，先添加一个吧。</div>') + '</div>',
      '<button type="button" class="button" data-shop-action="close-dialog">关闭</button><button type="button" class="button primary" data-shop-action="address-new">新增地址</button>');
  }

  function openAddressForm(address) {
    address = address || { isDefault: addresses().length === 0 };
    state.editingAddressId = address.id || '';
    openShopDialog(address.id ? '编辑收货地址' : '新增收货地址', '<div class="account-form">' +
      '<label><span>收货人</span><input id="addressName" maxlength="20" value="' + esc(address.name || '') + '"></label>' +
      '<label><span>手机号</span><input id="addressPhone" maxlength="20" value="' + esc(address.phone || (state.member && state.member.phone) || '') + '"></label>' +
      '<label class="full"><span>详细地址</span><textarea id="addressDetail" maxlength="200">' + esc(address.detail || '') + '</textarea></label>' +
      '<label class="check-line full"><input id="addressDefault" type="checkbox" ' + (address.isDefault ? 'checked' : '') + '><span>设为默认收货地址</span></label></div>',
      '<button type="button" class="button" data-shop-action="address-back">返回</button><button type="button" class="button primary" data-shop-action="address-save" data-id="' + esc(address.id || '') + '">保存地址</button>');
  }

  async function saveAddress(id) {
    var body = {
      name: byId('addressName').value.trim(), phone: byId('addressPhone').value.trim(),
      detail: byId('addressDetail').value.trim(), isDefault: byId('addressDefault').checked
    };
    await request('/api/wx/member/' + encodeURIComponent(memberId()) + '/addresses' + (id ? '/' + encodeURIComponent(id) : ''), {
      method: id ? 'PUT' : 'POST', body: body
    });
    await loadMember();
    syncDeliveryUI();
    toast(id ? '地址已更新' : '地址已添加');
    openAddressManager();
  }

  async function setDefaultAddress(id) {
    await request('/api/wx/member/' + encodeURIComponent(memberId()) + '/addresses/' + encodeURIComponent(id), {
      method: 'PUT', body: { isDefault: true }
    });
    await loadMember();
    syncDeliveryUI();
    toast('默认地址已更新');
    openAddressManager();
  }

  async function deleteAddress(id) {
    if (!confirm('删除这个收货地址？')) return;
    await request('/api/wx/member/' + encodeURIComponent(memberId()) + '/addresses/' + encodeURIComponent(id), { method: 'DELETE' });
    await loadMember();
    syncDeliveryUI();
    toast('地址已删除');
    openAddressManager();
  }

  async function openAfterSalesList() {
    state.afterSales = await request('/api/wx/after-sales');
    var rows = state.afterSales.map(function (item) {
      return '<button type="button" class="after-sales-card" data-shop-action="open-order" data-id="' + esc(item.orderId) + '"><div><strong>' + esc(afterSalesType(item.type)) + '</strong><small>' + esc(item.orderNo) + ' · ' + shortDate(item.createdAt) + '</small><p>' + esc(item.reason) + '</p></div><span>' + esc(afterSalesStatus(item.status)) + '</span></button>';
    }).join('');
    openShopDialog('我的售后', '<div class="account-note"><strong>售后进度与订单关联</strong><span>受理和退款安排会同步到订单详情，退款通知使用微信订阅消息。</span></div>' + (rows ? '<div class="after-sales-list">' + rows + '</div>' : '<div class="detail-empty">还没有售后申请。</div>'), '<button type="button" class="button" data-shop-action="close-dialog">关闭</button>');
  }

  async function openAfterSalesForm(orderId) {
    var order = await request('/api/wx/orders/' + encodeURIComponent(orderId));
    var refundable = Math.max(0, Number(order.payAmount || 0) - Number(order.refundedAmount || 0));
    openShopDialog('申请售后', '<div class="account-note"><strong>订单 ' + esc(order.orderNo) + '</strong><span>提交后由门店受理，资金操作不会由顾客端直接触发。</span></div><div class="account-form">' +
      '<label><span>售后类型</span><select id="afterSalesType"><option value="refund">退款</option><option value="return">退货</option><option value="complaint">投诉建议</option></select></label>' +
      '<label><span>退款金额</span><input id="afterSalesAmount" type="number" min="0.01" step="0.01" value="' + (refundable / 100).toFixed(2) + '"></label>' +
      '<label class="full"><span>问题原因</span><input id="afterSalesReason" maxlength="120" placeholder="例如：商品破损、少件或需要退款"></label>' +
      '<label class="full"><span>补充说明</span><textarea id="afterSalesDescription" maxlength="500" placeholder="可填写数量、问题位置和希望的解决方式"></textarea></label></div>',
      '<button type="button" class="button" data-shop-action="close-dialog">取消</button><button type="button" class="button primary" data-shop-action="after-sales-submit" data-id="' + esc(order.id) + '">提交售后</button>');
  }

  async function submitAfterSales(orderId) {
    var type = byId('afterSalesType').value;
    var reason = byId('afterSalesReason').value.trim();
    if (!reason) throw new Error('请填写问题原因');
    var body = { type: type, reason: reason, description: byId('afterSalesDescription').value.trim() };
    if (type === 'refund') {
      var amount = Number(byId('afterSalesAmount').value);
      if (!(amount > 0)) throw new Error('退款金额必须大于 0');
      body.amount = amount;
    }
    await request('/api/wx/orders/' + encodeURIComponent(orderId) + '/after-sales', { method: 'POST', body: body });
    await loadMember();
    toast('售后申请已提交，门店会在经营台看到待办');
    await openOrderDetail(orderId);
  }

  async function cancelAfterSales(id) {
    if (!confirm('撤回这条售后申请？')) return;
    await request('/api/wx/after-sales/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: {} });
    await loadMember();
    toast('售后申请已撤回');
    if (state.selectedOrderId) await openOrderDetail(state.selectedOrderId);
  }

  function findProduct(id) {
    return (state.home.products || []).find(function (product) { return product.id === id; });
  }

  function unitPriceCents() {
    if (state.selectedGroup) return Number(state.selectedGroup.groupPrice || 0);
    return Math.round(Number(state.selectedProduct.price || 0) * 100);
  }

  function openPurchase(productId, group) {
    var product = findProduct(productId);
    if (!product) return toast('商品不存在', true);
    state.selectedProduct = product;
    state.selectedGroup = group || null;
    state.quantity = 1;
    state.deliveryType = addresses().length || !pickupLocations().length ? 'delivery' : 'pickup';
    byId('purchaseTitle').textContent = product.name;
    byId('purchaseDescription').textContent = (group ? '团购活动：' + group.title + ' · ' : '') + (product.description || '');
    byId('purchasePrice').textContent = money(unitPriceCents());
    byId('purchaseImage').style.backgroundImage = product.image ? 'url("' + String(product.image).replace(/"/g, '') + '")' : '';
    byId('qtyValue').textContent = '1';
    byId('availablePoints').textContent = state.points ? state.points.balance : 0;
    byId('usePoints').checked = false;
    byId('usePoints').disabled = !settlementConfig().points.enabled || Number(state.points && state.points.balance ? state.points.balance : 0) <= 0;
    var payment = settlementConfig().payment;
    byId('submitOrder').textContent = payment.mode === 'offline' ? '提交订单，等待门店确认收款' : (payment.onlineAvailable ? '确认下单并支付' : '在线支付不可用');
    byId('paymentNote').textContent = payment.mode === 'offline'
      ? payment.offlineInstructions
      : (payment.onlineAvailable ? '本单通过微信支付完成。' : '门店尚未开通在线支付，请联系门店。');
    byId('paymentNote').hidden = false;
    byId('purchaseError').textContent = '';
    renderCouponOptions();
    populateCheckoutChoices();
    syncDeliveryUI();
    byId('purchaseDialog').showModal();
  }

  function renderCouponOptions() {
    var goods = unitPriceCents() * state.quantity;
    var options = '<option value="">暂不使用</option>' + state.coupons.filter(function (coupon) {
      return coupon.status === 'unused' && goods >= coupon.threshold;
    }).map(function (coupon) {
      return '<option value="' + esc(coupon.id) + '">' + esc(coupon.name) + '（减 ' + money(coupon.amount) + '）</option>';
    }).join('');
    byId('couponSelect').innerHTML = options;
    refreshCheckoutSummary();
  }

  function settlementConfig() {
    var checkout = state.checkout || {};
    var points = checkout.points || {};
    return {
      deliveryFee: Number(checkout.deliveryFee || 0),
      payment: {
        mode: checkout.payment && checkout.payment.mode === 'offline' ? 'offline' : 'wechat',
        onlineAvailable: !!(checkout.payment && checkout.payment.onlineAvailable),
        offlineInstructions: (checkout.payment && checkout.payment.offlineInstructions) || ''
      },
      points: {
        enabled: points.enabled !== false,
        maxPercentPerOrder: Math.max(0, Math.min(100, Number(points.maxPercentPerOrder || 0)))
      }
    };
  }

  function selectedCoupon() {
    var select = byId('couponSelect');
    if (!select || !select.value) return null;
    return state.coupons.find(function (coupon) { return coupon.id === select.value; }) || null;
  }

  function checkoutTotals() {
    var goodsAmount = unitPriceCents() * state.quantity;
    var coupon = selectedCoupon();
    var couponDiscount = coupon ? Math.min(goodsAmount, Number(coupon.amount || 0)) : 0;
    var afterCoupon = Math.max(0, goodsAmount - couponDiscount);
    var config = settlementConfig();
    var balance = Number((state.points && state.points.balance) || 0);
    var eligiblePoints = config.points.enabled
      ? Math.min(balance, Math.floor(afterCoupon * config.points.maxPercentPerOrder / 100))
      : 0;
    var pointsUsed = byId('usePoints') && byId('usePoints').checked ? eligiblePoints : 0;
    var deliveryFee = state.deliveryType === 'pickup' ? 0 : Math.round(config.deliveryFee * 100);
    return {
      goodsAmount: goodsAmount,
      couponDiscount: couponDiscount,
      eligiblePoints: eligiblePoints,
      pointsUsed: pointsUsed,
      pointsDiscount: pointsUsed,
      deliveryFee: deliveryFee,
      payableAmount: Math.max(0, afterCoupon - pointsUsed + deliveryFee)
    };
  }

  function refreshCheckoutSummary() {
    // 账户区修改地址时结算弹窗可能尚未打开，此时没有已选商品，不应阻断地址操作。
    if (!byId('summaryGoods') || !state.selectedProduct) return;
    var totals = checkoutTotals();
    byId('summaryGoods').textContent = money(totals.goodsAmount);
    byId('summaryCoupon').textContent = '-' + money(totals.couponDiscount);
    byId('summaryCouponRow').hidden = totals.couponDiscount <= 0;
    byId('summaryPoints').textContent = '-' + money(totals.pointsDiscount);
    byId('summaryPointsRow').hidden = totals.pointsUsed <= 0;
    byId('summaryDelivery').textContent = totals.deliveryFee ? money(totals.deliveryFee) : '免配送费';
    byId('summaryTotal').textContent = money(totals.payableAmount);
    var pointsHint = byId('pointsDiscountHint');
    if (settlementConfig().points.enabled && totals.eligiblePoints > 0) {
      pointsHint.textContent = '本单最多 ' + totals.eligiblePoints + ' 积分，可抵 ' + money(totals.eligiblePoints);
    } else {
      pointsHint.textContent = '本单暂不可用积分';
    }
  }

  function syncQuantity() {
    byId('qtyValue').textContent = state.quantity;
    byId('purchasePrice').textContent = money(unitPriceCents() * state.quantity);
    renderCouponOptions();
    refreshCheckoutSummary();
  }

  function populateCheckoutChoices() {
    var addressSelect = byId('addressSelect');
    var pickupSelect = byId('pickupLocationSelect');
    addressSelect.innerHTML = addresses().map(function (address) {
      return '<option value="' + esc(address.id) + '" ' + (address.isDefault ? 'selected' : '') + '>' + esc(address.name + ' · ' + address.detail) + '</option>';
    }).join('');
    var locations = pickupLocations();
    pickupSelect.innerHTML = locations.map(function (location) {
      return '<option value="' + esc(location.id) + '" ' + (location.isPrimary ? 'selected' : '') + '>' + esc(location.name + ' · ' + location.address) + '</option>';
    }).join('');
    state.pickupLocationId = pickupSelect.value || '';
  }

  function syncDeliveryUI() {
    document.querySelectorAll('[data-delivery]').forEach(function (node) {
      node.classList.toggle('active', node.getAttribute('data-delivery') === state.deliveryType);
    });
    var deliveryChoice = byId('deliveryAddressChoice');
    var pickupChoice = byId('pickupLocationChoice');
    if (deliveryChoice) deliveryChoice.hidden = state.deliveryType !== 'delivery';
    if (pickupChoice) pickupChoice.hidden = state.deliveryType !== 'pickup';
    var address = addresses().find(function (item) { return item.id === (byId('addressSelect') && byId('addressSelect').value); }) || defaultAddress();
    var location = pickupLocations().find(function (item) { return item.id === (byId('pickupLocationSelect') && byId('pickupLocationSelect').value); }) || pickupLocations()[0];
    state.pickupLocationId = location ? location.id : '';
    byId('deliveryNote').textContent = state.deliveryType === 'pickup'
      ? (location ? '自提点：' + location.name + ' · ' + location.address + '。支付后生成取货码。' : '当前门店暂未配置可用自提点。')
      : (address ? '配送至：' + address.detail : '当前会员还没有收货地址，请管理地址或改为自提。');
    refreshCheckoutSummary();
  }

  async function submitOrder() {
    if (!state.selectedProduct) return;
    var button = byId('submitOrder');
    button.disabled = true;
    byId('purchaseError').textContent = '';
    try {
      var member = state.member || {};
      var address = (member.addresses || []).find(function (item) { return item.id === byId('addressSelect').value; }) || (member.addresses || [])[0];
      if (state.deliveryType === 'delivery' && !address) throw new Error('当前账号没有收货地址，请改为自提');
      if (state.deliveryType === 'pickup' && !byId('pickupLocationSelect').value) throw new Error('当前门店暂未配置可用自提点');
      var totals = checkoutTotals();
      var payment = settlementConfig().payment;
      if (payment.mode !== 'offline' && !payment.onlineAvailable) throw new Error('门店尚未开通在线支付，请联系门店');
      var options = { deliveryType: state.deliveryType, usePoints: totals.pointsUsed };
      if (state.selectedGroup) options.groupBuyId = state.selectedGroup.id;
      if (state.deliveryType === 'delivery') options.addressId = address.id;
      if (state.deliveryType === 'pickup') options.pickupLocationId = byId('pickupLocationSelect').value;
      if (byId('couponSelect').value) options.couponId = byId('couponSelect').value;
      var order = await request('/api/wx/orders', {
        method: 'POST',
        body: { items: [{ productId: state.selectedProduct.id, quantity: state.quantity }], options: options }
      });
      if (order.paymentMode === 'offline') {
        byId('purchaseDialog').close();
        toast('订单已提交，请按门店说明付款并等待确认');
        await Promise.all([loadMember(), request('/api/wx/home').then(function (home) { state.home = home; renderHome(); })]);
        return;
      }
      var paid = await request('/api/wx/orders/' + encodeURIComponent(order.id) + '/pay', { method: 'POST', body: {} });
      if (paid.payParams) throw new Error('正式环境请在微信小程序内完成支付');
      byId('purchaseDialog').close();
      toast('支付成功，回到经营台处理待办');
      await Promise.all([loadMember(), request('/api/wx/home').then(function (home) { state.home = home; renderHome(); })]);
    } catch (error) {
      byId('purchaseError').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function handleGroupAction(groupId) {
    try {
      if (!state.member) await login();
      var group = (state.home.groupBuys || []).find(function (item) { return item.id === groupId; });
      if (!group) throw new Error('团购活动不存在');
      var joined = (group.participants || []).some(function (item) { return item.memberId === memberId(); });
      if (!joined) {
        group = await request('/api/wx/groupbuys/' + encodeURIComponent(groupId) + '/join', { method: 'POST', body: {} });
        toast(group.status === 'success' ? '本团已成团，可以按团购价购买' : '已参团，团购进度已同步到经营台');
      }
      state.home = await request('/api/wx/home');
      renderGroups();
      if (group.status === 'success') openPurchase(group.productId, group);
      else if (joined) toast('还差 ' + group.remaining + ' 人成团', true);
    } catch (error) { toast(error.message, true); }
  }

  document.addEventListener('click', function (event) {
    var orderNode = event.target.closest('[data-order-id]');
    if (orderNode) { openOrderDetail(orderNode.getAttribute('data-order-id')).catch(function (error) { toast(error.message, true); }); return; }
    var shopAction = event.target.closest('[data-shop-action]');
    if (shopAction) {
      event.preventDefault();
      var action = shopAction.getAttribute('data-shop-action');
      var id = shopAction.getAttribute('data-id') || '';
      var handlers = {
        'close-dialog': function () { closeShopDialog(); },
        'open-order': function () { return openOrderDetail(id); },
        'request-after-sales': function () { return openAfterSalesForm(id); },
        'after-sales-submit': function () { return submitAfterSales(id); },
        'cancel-after-sales': function () { return cancelAfterSales(id); },
        'address-new': function () { openAddressForm(null); },
        'address-edit': function () { openAddressForm(addresses().find(function (item) { return item.id === id; })); },
        'address-back': function () { openAddressManager(); },
        'address-save': function () { return saveAddress(id); },
        'address-default': function () { return setDefaultAddress(id); },
        'address-delete': function () { return deleteAddress(id); }
      };
      var handler = handlers[action];
      if (!handler) return;
      Promise.resolve(handler()).catch(function (error) { toast(error.message, true); });
      return;
    }
    var category = event.target.closest('[data-category]');
    if (category) { state.categoryId = category.getAttribute('data-category'); renderCategories(); renderProducts(); return; }
    var buy = event.target.closest('[data-buy]');
    if (buy) { openPurchase(buy.getAttribute('data-buy')); return; }
    var group = event.target.closest('[data-group-buy]');
    if (group) { handleGroupAction(group.getAttribute('data-group-buy')); return; }
    var delivery = event.target.closest('[data-delivery]');
    if (delivery) { state.deliveryType = delivery.getAttribute('data-delivery'); syncDeliveryUI(); }
  });

  byId('qtyMinus').addEventListener('click', function () { if (state.quantity > 1) { state.quantity--; syncQuantity(); } });
  byId('qtyPlus').addEventListener('click', function () { var stock = state.selectedProduct ? state.selectedProduct.stock : 1; if (state.quantity < stock) { state.quantity++; syncQuantity(); } });
  byId('closePurchase').addEventListener('click', function () { byId('purchaseDialog').close(); });
  byId('submitOrder').addEventListener('click', submitOrder);
  byId('couponSelect').addEventListener('change', refreshCheckoutSummary);
  byId('usePoints').addEventListener('change', refreshCheckoutSummary);
  byId('addressSelect').addEventListener('change', syncDeliveryUI);
  byId('pickupLocationSelect').addEventListener('change', syncDeliveryUI);
  byId('purchaseDialog').addEventListener('click', function (event) { if (event.target === this) this.close(); });
  byId('shopDialog').addEventListener('click', function (event) { if (event.target === this) closeShopDialog(); });
  byId('closeShopDialog').addEventListener('click', closeShopDialog);
  byId('openAddresses').addEventListener('click', function () { openAddressManager(); });
  byId('openAfterSales').addEventListener('click', function () { openAfterSalesList().catch(function (error) { toast(error.message, true); }); });

  load();
})();
