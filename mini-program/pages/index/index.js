var api = require('../../utils/api');
Page({
  data: { tenantName: '邻里团', products: [], groupBuys: [] },
  onShow() { this.load(); },
  load() {
    var that = this;
    api.request('/api/wx/home').then(function(d) {
      that.setData({
        tenantName: d.tenant.name,
        products: d.products,
        groupBuys: d.groupBuys.map(function(g) {
          return Object.assign({}, g, { groupPriceYuan: (g.groupPrice / 100).toFixed(2) });
        })
      });
    }).catch(function(e) { wx.showToast({ title: e.message, icon: 'none' }); });
  },
  goProduct(e) { wx.navigateTo({ url: '/pages/product/product?id=' + e.currentTarget.dataset.id }); },
  goGroupBuy(e) {
    var gb = this.data.groupBuys.find(function(x) { return x.id === e.currentTarget.dataset.id; });
    if (gb && gb.product) wx.navigateTo({ url: '/pages/product/product?id=' + gb.product.id });
  }
});
