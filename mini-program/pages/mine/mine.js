var api = require('../../utils/api');
Page({
  data: { member: {}, pointsBalance: 0, totalSpent: '0.00', coupons: [], ledger: [] },
  onShow() { this.load(); },
  load() {
    var that = this;
    var mid = api.memberId();
    if (!mid) return;
    Promise.all([
      api.request('/api/wx/member/' + mid),
      api.request('/api/wx/member/' + mid + '/points'),
      api.request('/api/wx/member/' + mid + '/coupons')
    ]).then(function(r) {
      var stMap = { unused:'未使用', used:'已使用', expired:'已过期' };
      that.setData({
        member: r[0],
        pointsBalance: r[1].balance,
        ledger: r[1].ledger.slice(0, 10),
        totalSpent: (r[0].totalSpent || 0).toFixed(2),
        coupons: r[2].map(function(c) { return Object.assign({}, c, { statusText: stMap[c.status] || c.status }); })
      });
    }).catch(function(e) { wx.showToast({ title: e.message, icon: 'none' }); });
  }
});
