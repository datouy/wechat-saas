var api = require('../../utils/api');
Page({
  data: { product: null, qty: 1, usePoints: '', pointsBalance: 0 },
  onLoad(options) {
    this.productId = options.id;
    this.load();
  },
  load() {
    var that = this;
    Promise.all([api.request('/api/wx/products/' + this.productId), api.request('/api/wx/member/' + api.memberId() + '/points')])
      .then(function(r) {
        that.setData({ product: r[0], pointsBalance: r[1].balance });
      }).catch(function(e) { wx.showToast({ title: e.message, icon: 'none' }); });
  },
  plus() { this.setData({ qty: this.data.qty + 1 }); },
  minus() { if (this.data.qty > 1) this.setData({ qty: this.data.qty - 1 }); },
  onPoints(e) { this.setData({ usePoints: e.detail.value }); },
  createOrder() {
    var that = this;
    var mid = api.memberId();
    api.request('/api/wx/orders', 'POST', {
      memberId: mid,
      items: [{ productId: this.productId, quantity: this.data.qty }],
      options: { usePoints: Number(this.data.usePoints) || 0 }
    }).then(function(order) {
      wx.showModal({
        title: '下单成功',
        content: '实付 ¥' + (order.payAmount / 100).toFixed(2) + '，是否立即支付？',
        success: function(r) {
          if (r.confirm) {
            api.request('/api/wx/orders/' + order.id + '/pay', 'POST', { memberId: mid }).then(function(res) {
              wx.showToast({ title: res.mock ? '模拟支付成功' : '支付成功' });
              wx.switchTab({ url: '/pages/orders/orders' });
            }).catch(function(e) { wx.showToast({ title: e.message, icon: 'none' }); });
          } else {
            wx.switchTab({ url: '/pages/orders/orders' });
          }
        }
      });
    }).catch(function(e) { wx.showToast({ title: e.message, icon: 'none' }); });
  }
});
