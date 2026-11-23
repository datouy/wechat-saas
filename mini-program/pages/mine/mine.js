var api = require('../../utils/api');

var AFTER_SALES_STATUS = {
  pending: '待受理', approved: '已受理', resolved: '已完成', rejected: '未通过', closed: '已撤回'
};
var AFTER_SALES_TYPES = { refund: '退款申请', return: '退货申请', complaint: '投诉建议' };

function money(value) { return (Math.max(0, Number(value) || 0) / 100).toFixed(2); }
function dateTime(value) {
  if (!value) return '';
  var date = new Date(value);
  if (isNaN(date.getTime())) return '';
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}
function decorateAfterSales(item) {
  return Object.assign({}, item, {
    typeText: AFTER_SALES_TYPES[item.type] || item.type,
    statusText: AFTER_SALES_STATUS[item.status] || item.status,
    createdAtText: dateTime(item.createdAt),
    requestedAmountText: money(item.requestedAmount)
  });
}

Page({
  data: {
    member: {},
    memberInitial: '邻',
    pointsBalance: 0,
    totalSpent: '0.00',
    coupons: [],
    ledger: [],
    addresses: [],
    afterSales: [],
    pendingAfterSales: 0,
    storePhone: '',
    showAddressManager: false,
    showAddressForm: false,
    editingAddressId: '',
    addressDraft: { name: '', phone: '', detail: '', isDefault: false },
    showAfterSales: false,
    savingAddress: false
  },

  onShow() { this.load(); },

  load() {
    var that = this;
    var mid = api.memberId();
    if (!mid) return;
    return Promise.all([
      api.request('/api/wx/member/' + mid),
      api.request('/api/wx/member/' + mid + '/points'),
      api.request('/api/wx/member/' + mid + '/coupons'),
      api.request('/api/wx/after-sales'),
      api.request('/api/wx/home')
    ]).then(function (result) {
      var member = result[0] || {};
      var home = result[4] || {};
      var tenant = home.tenant || {};
      var statusMap = { unused: '未使用', used: '已使用', expired: '已过期', reserved: '结算中' };
      var afterSales = (result[3] || []).map(decorateAfterSales);
      that.setData({
        member: member,
        memberInitial: String(member.nickname || '邻里').slice(0, 1),
        pointsBalance: result[1].balance,
        ledger: result[1].ledger.slice(0, 10).map(function (item) {
          return Object.assign({}, item, { createdAtText: dateTime(item.createdAt) });
        }),
        totalSpent: (Number(member.totalSpent) || 0).toFixed(2),
        coupons: result[2].map(function (coupon) {
          return Object.assign({}, coupon, {
            statusText: statusMap[coupon.status] || coupon.status,
            thresholdText: money(coupon.threshold),
            amountText: money(coupon.amount)
          });
        }),
        addresses: member.addresses || [],
        afterSales: afterSales,
        pendingAfterSales: afterSales.filter(function (item) { return item.status === 'pending'; }).length,
        storePhone: tenant.customerServicePhone || tenant.contactPhone || ''
      });
    }).catch(function (error) { api.showError(error, '会员中心加载失败'); });
  },

  openAddressManager() {
    this.setData({ showAddressManager: true, showAddressForm: false });
  },

  closeAddressManager() {
    this.setData({ showAddressManager: false, showAddressForm: false });
  },

  openAddressForm(e) {
    var id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : '';
    var address = id ? this.data.addresses.find(function (item) { return item.id === id; }) : null;
    address = address || {
      name: '',
      phone: this.data.member.phone || '',
      detail: '',
      isDefault: this.data.addresses.length === 0
    };
    this.setData({
      showAddressForm: true,
      editingAddressId: address.id || '',
      addressDraft: {
        name: address.name || '',
        phone: address.phone || '',
        detail: address.detail || '',
        isDefault: !!address.isDefault
      }
    });
  },

  closeAddressForm() { this.setData({ showAddressForm: false }); },

  onAddressInput(e) {
    var draft = Object.assign({}, this.data.addressDraft);
    draft[e.currentTarget.dataset.field] = e.detail.value;
    this.setData({ addressDraft: draft });
  },

  onAddressDefault(e) {
    var draft = Object.assign({}, this.data.addressDraft);
    draft.isDefault = !!e.detail.value;
    this.setData({ addressDraft: draft });
  },

  saveAddress() {
    var that = this;
    var draft = this.data.addressDraft;
    if (!String(draft.name || '').trim() || !String(draft.phone || '').trim() || !String(draft.detail || '').trim()) {
      return wx.showToast({ title: '请填写完整地址', icon: 'none' });
    }
    if (this.data.savingAddress) return;
    this.setData({ savingAddress: true });
    var id = this.data.editingAddressId;
    var path = '/api/wx/member/' + api.memberId() + '/addresses' + (id ? '/' + encodeURIComponent(id) : '');
    api.request(path, id ? 'PUT' : 'POST', {
      name: String(draft.name).trim(),
      phone: String(draft.phone).trim(),
      detail: String(draft.detail).trim(),
      isDefault: !!draft.isDefault
    }).then(function () {
      wx.showToast({ title: id ? '地址已更新' : '地址已添加' });
      return that.load();
    }).then(function () {
      that.setData({ showAddressForm: false, editingAddressId: '', savingAddress: false });
    }).catch(function (error) {
      that.setData({ savingAddress: false });
      api.showError(error, '地址保存失败');
    });
  },

  setDefaultAddress(e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    api.request('/api/wx/member/' + api.memberId() + '/addresses/' + encodeURIComponent(id), 'PUT', { isDefault: true })
      .then(function () {
        wx.showToast({ title: '默认地址已更新' });
        return that.load();
      }).catch(function (error) { api.showError(error, '设置默认地址失败'); });
  },

  deleteAddress(e) {
    var that = this;
    var id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除地址',
      content: '已有订单里的地址快照不会受影响。',
      success: function (result) {
        if (!result.confirm) return;
        api.request('/api/wx/member/' + api.memberId() + '/addresses/' + encodeURIComponent(id), 'DELETE')
          .then(function () {
            wx.showToast({ title: '地址已删除' });
            return that.load();
          }).catch(function (error) { api.showError(error, '删除地址失败'); });
      }
    });
  },

  openAfterSales() {
    this.setData({ showAfterSales: true });
  },

  closeAfterSales() {
    this.setData({ showAfterSales: false });
  },

  openAfterSalesOrder(e) {
    var id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.setStorageSync('focusOrderId', id);
    this.setData({ showAfterSales: false });
    wx.switchTab({ url: '/pages/orders/orders' });
  },

  callService() {
    if (!this.data.storePhone) return;
    wx.makePhoneCall({ phoneNumber: this.data.storePhone });
  },

  noop() {}
});
