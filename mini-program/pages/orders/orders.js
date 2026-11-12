var api = require('../../utils/api');
var STATUS = { pending:'待支付', paid:'待发货', delivering:'配送中', completed:'已完成', cancelled:'已取消' };
Page({
  data: { orders: [] },
  onShow() { this.load(); },
  load() {
    var that = this;
    var mid = api.memberId();
    if (!mid) return;
    api.request('/api/wx/orders?memberId=' + mid).then(function(list) {
      that.setData({
        orders: list.map(function(o) {
          return Object.assign({}, o, {
            statusText: STATUS[o.status] || o.status,
            itemsText: o.items.map(function(it) { return it.name + ' ×' + it.quantity; }).join('、'),
            payAmountYuan: (o.payAmount / 100).toFixed(2)
          });
        })
      });
    }).catch(function(e) { wx.showToast({ title: e.message, icon: 'none' }); });
  },
  pay(e) {
    var that = this, id = e.currentTarget.dataset.id;
    api.request('/api/wx/orders/' + id + '/pay', 'POST', { memberId: api.memberId() }).then(function(res) {
      wx.showToast({ title: res.mock ? '模拟支付成功' : '支付成功' });
      that.load();
    }).catch(function(err) { wx.showToast({ title: err.message, icon: 'none' }); });
  },
  complete(e) {
    var that = this;
    api.request('/api/wx/orders/' + e.currentTarget.dataset.id + '/complete', 'POST', { memberId: api.memberId() }).then(function() {
      wx.showToast({ title: '已确认收货' });
      that.load();
    }).catch(function(err) { wx.showToast({ title: err.message, icon: 'none' }); });
  }
});
