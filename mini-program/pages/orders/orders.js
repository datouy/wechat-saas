var api = require('../../utils/api');
var payment = require('../../utils/payment');

var STATUS = {
  pending: '待支付', paid: '待发货', delivering: '配送中', completed: '已完成',
  cancelled: '已取消', refunding: '退款中', refunded: '已退款'
};
var AFTER_SALES_STATUS = {
  pending: '待受理', approved: '已受理', resolved: '已完成', rejected: '未通过', closed: '已撤回'
};
var AFTER_SALES_TYPES = [
  { value: 'refund', label: '退款申请' },
  { value: 'return', label: '退货申请' },
  { value: 'complaint', label: '投诉建议' }
];

function money(value) { return (Math.max(0, Number(value) || 0) / 100).toFixed(2); }
function dateTime(value) {
  if (!value) return '';
  var date = new Date(value);
  if (isNaN(date.getTime())) return '';
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}
function afterSalesStatus(status) { return AFTER_SALES_STATUS[status] || status; }
function afterSalesType(type) {
  var found = AFTER_SALES_TYPES.find(function (item) { return item.value === type; });
  return found ? found.label : type;
}

function decorateAfterSales(item) {
  return Object.assign({}, item, {
    typeText: afterSalesType(item.type),
    statusText: afterSalesStatus(item.status),
    createdAtText: dateTime(item.createdAt),
    requestedAmountText: money(item.requestedAmount)
  });
}

function decorateOrder(order) {
  var afterSales = (order.afterSales || []).map(decorateAfterSales);
  var activeAfterSales = afterSales.find(function (item) { return item.status === 'pending' || item.status === 'approved'; });
  var canRequestAfterSales = ['paid', 'delivering', 'completed'].indexOf(order.status) >= 0 && !activeAfterSales;
  var items = (order.items || []).map(function (item) {
    return Object.assign({}, item, {
      subtotalText: money(item.subtotal),
      unitPriceText: money(item.unitPrice)
    });
  });
  var deliveryText = order.deliveryType === 'pickup' ? '门店自提' : '送货上门';
  var statusHint = order.status === 'pending' ? '请在支付截止前完成付款' :
    order.status === 'paid' && order.deliveryType === 'pickup' ? '等待门店备货，凭取货码到店' :
    order.status === 'paid' ? '门店正在准备你的订单' :
    order.status === 'delivering' ? '商品正在送往你的收货地址' :
    order.status === 'completed' ? '订单已完成，可查看履约记录' :
    order.status === 'refunding' ? '退款正在处理中' :
    order.status === 'refunded' ? '退款已完成' : '订单已经关闭';
  return Object.assign({}, order, {
    items: items,
    statusText: STATUS[order.status] || order.status,
    statusHint: statusHint,
    deliveryText: deliveryText,
    createdAtText: dateTime(order.createdAt),
    paidAtText: dateTime(order.paidAt),
    deliveredAtText: dateTime(order.deliveredAt),
    completedAtText: dateTime(order.completedAt || order.pickupVerifiedAt),
    itemsText: items.map(function (item) { return item.name + ' ×' + item.quantity; }).join('、'),
    payAmountYuan: money(order.payAmount),
    goodsAmountYuan: money(order.goodsAmount),
    couponDiscountYuan: money(order.couponDiscount),
    pointsDiscountYuan: money(order.pointsDiscount),
    deliveryFeeYuan: money(order.deliveryFee),
    refundedAmountYuan: money(order.refundedAmount),
    refundableAmountYuan: money(Math.max(0, Number(order.payAmount || 0) - Number(order.refundedAmount || 0))),
    pickupLocationName: order.pickupLocation ? order.pickupLocation.name : '',
    pickupLocationAddress: order.pickupLocation ? order.pickupLocation.address : '',
    addressText: order.address ? order.address.name + ' · ' + order.address.phone + '\n' + order.address.detail : '',
    logisticsText: order.logistics ? [order.logistics.company, order.logistics.trackingNo].filter(Boolean).join(' · ') : '',
    refundStatusText: order.refund ? (order.refund.status === 'refunded' || order.status === 'refunded' ? '退款完成' : '退款处理中') : '',
    afterSales: afterSales,
    activeAfterSales: activeAfterSales || null,
    canRequestAfterSales: canRequestAfterSales
  });
}

Page({
  data: {
    orders: [],
    selectedOrder: null,
    showDetail: false,
    showAfterSalesForm: false,
    afterSalesTypes: AFTER_SALES_TYPES,
    afterSalesTypeIndex: 0,
    afterSalesTypeLabel: AFTER_SALES_TYPES[0].label,
    afterSalesNeedsAmount: true,
    afterSalesDraft: { amount: '', reason: '', description: '' },
    submittingAfterSales: false
  },

  onShow() { this.load(); },

  load() {
    var that = this;
    var mid = api.memberId();
    if (!mid) return;
    return api.request('/api/wx/orders?memberId=' + mid).then(function (list) {
      that.setData({ orders: list.map(decorateOrder) });
      var focusId = wx.getStorageSync('focusOrderId');
      if (focusId) {
        wx.removeStorageSync('focusOrderId');
        that.openOrderDetail(focusId);
      }
    }).catch(function (error) { api.showError(error, '订单加载失败'); });
  },

  openOrderDetail(input) {
    var that = this;
    var id = typeof input === 'string' ? input : input.currentTarget.dataset.id;
    if (!id) return;
    return api.request('/api/wx/orders/' + encodeURIComponent(id)).then(function (order) {
      that.setData({
        selectedOrder: decorateOrder(order),
        showDetail: true,
        showAfterSalesForm: false
      });
    }).catch(function (error) { api.showError(error, '订单详情加载失败'); });
  },

  closeDetail() {
    this.setData({ showDetail: false, showAfterSalesForm: false, selectedOrder: null });
  },

  noop() {},

  pay(e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    payment.requestConfiguredSubscriptions().then(function () {
      return payment.payOrder(id);
    }).then(function (result) {
      wx.showToast({ title: result.mock ? '模拟支付成功' : '支付成功' });
      that.load().then(function () {
        if (that.data.showDetail) that.openOrderDetail(id);
      });
    }).catch(function (error) { api.showError(error, '支付未完成'); });
  },

  cancelOrder(e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '取消订单',
      content: '取消后会立即释放库存、优惠券和已抵扣积分。',
      success: function (result) {
        if (!result.confirm) return;
        api.request('/api/wx/orders/' + encodeURIComponent(id) + '/cancel', 'POST', { reason: '小程序用户取消' })
          .then(function () {
            wx.showToast({ title: '订单已取消' });
            that.closeDetail();
            that.load();
          }).catch(function (error) { api.showError(error, '取消订单失败'); });
      }
    });
  },

  complete(e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    api.request('/api/wx/orders/' + encodeURIComponent(id) + '/complete', 'POST', { memberId: api.memberId() })
      .then(function () {
        wx.showToast({ title: '已确认收货' });
        that.load().then(function () {
          if (that.data.showDetail) that.openOrderDetail(id);
        });
      }).catch(function (error) { api.showError(error, '确认收货失败'); });
  },

  openAfterSalesForm() {
    var order = this.data.selectedOrder;
    if (!order || !order.canRequestAfterSales) return;
    this.setData({
      showAfterSalesForm: true,
      afterSalesTypeIndex: 0,
      afterSalesTypeLabel: AFTER_SALES_TYPES[0].label,
      afterSalesNeedsAmount: true,
      afterSalesDraft: { amount: order.refundableAmountYuan, reason: '', description: '' }
    });
  },

  closeAfterSalesForm() { this.setData({ showAfterSalesForm: false }); },

  onAfterSalesType(e) {
    var index = Number(e.detail.value) || 0;
    var selected = this.data.afterSalesTypes[index] || this.data.afterSalesTypes[0];
    this.setData({
      afterSalesTypeIndex: index,
      afterSalesTypeLabel: selected.label,
      afterSalesNeedsAmount: selected.value === 'refund'
    });
  },

  onAfterSalesInput(e) {
    var draft = Object.assign({}, this.data.afterSalesDraft);
    draft[e.currentTarget.dataset.field] = e.detail.value;
    this.setData({ afterSalesDraft: draft });
  },

  submitAfterSales() {
    var that = this;
    var order = this.data.selectedOrder;
    var draft = this.data.afterSalesDraft;
    var type = this.data.afterSalesTypes[this.data.afterSalesTypeIndex].value;
    if (!draft.reason || !String(draft.reason).trim()) return wx.showToast({ title: '请填写问题原因', icon: 'none' });
    if (type === 'refund' && !(Number(draft.amount) > 0)) return wx.showToast({ title: '退款金额必须大于 0', icon: 'none' });
    if (this.data.submittingAfterSales) return;
    var body = { type: type, reason: String(draft.reason).trim(), description: String(draft.description || '').trim() };
    if (type === 'refund') body.amount = Number(draft.amount);
    this.setData({ submittingAfterSales: true });
    payment.requestConfiguredSubscriptions().then(function () {
      return api.request('/api/wx/orders/' + encodeURIComponent(order.id) + '/after-sales', 'POST', body);
    }).then(function () {
      wx.showToast({ title: '售后申请已提交' });
      return that.openOrderDetail(order.id);
    }).catch(function (error) {
      api.showError(error, '售后提交失败');
    }).then(function () {
      that.setData({ submittingAfterSales: false, showAfterSalesForm: false });
    });
  },

  cancelAfterSales(e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '撤回售后',
      content: '仅待受理的申请可以撤回。',
      success: function (result) {
        if (!result.confirm) return;
        api.request('/api/wx/after-sales/' + encodeURIComponent(id) + '/cancel', 'POST', {})
          .then(function () {
            wx.showToast({ title: '申请已撤回' });
            if (that.data.selectedOrder) that.openOrderDetail(that.data.selectedOrder.id);
          }).catch(function (error) { api.showError(error, '撤销售后失败'); });
      }
    });
  }
});
