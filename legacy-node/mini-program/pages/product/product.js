var api = require('../../utils/api');

Page({
  data: {
    product: null,
    groupBuy: null,
    groupPriceYuan: '',
    groupStatusText: '',
    groupCtaText: '',
    groupCtaDisabled: false,
    loading: true
  },
  onLoad(options) {
    this.productId = options.id;
    this.groupBuyId = options.groupBuyId || '';
    this.load();
  },
  load() {
    var that = this;
    var requests = [api.request('/api/wx/products/' + this.productId)];
    if (this.groupBuyId) requests.push(api.request('/api/wx/groupbuys/' + this.groupBuyId));
    Promise.all(requests).then(function(r) {
      var product = Object.assign({}, r[0], { image: api.assetUrl(r[0].image) });
      that.setData({ product: product, groupBuy: r[1] || null, loading: false });
      if (r[1]) that.updateGroup(r[1]);
    }).catch(function(e) {
      that.setData({ loading: false });
      api.showError(e, '商品加载失败');
    });
  },
  updateGroup(gb) {
    var joined = (gb.participants || []).some(function(p) { return p.memberId === api.memberId(); });
    var statusText = { active: '进行中', success: '已成团', closed: '已结束', cancelled: '已取消' }[gb.status] || gb.status;
    var cta = '加入团购';
    var disabled = false;
    if (gb.status === 'success') cta = joined ? '去结算' : '参团并购买';
    else if (gb.status === 'active' && joined) { cta = '还差 ' + gb.remaining + ' 人成团'; disabled = true; }
    else if (gb.status === 'closed' || gb.status === 'cancelled') { cta = '活动已结束'; disabled = true; }
    this.setData({
      groupBuy: gb,
      groupPriceYuan: (gb.groupPrice / 100).toFixed(2),
      groupStatusText: statusText,
      groupCtaText: cta,
      groupCtaDisabled: disabled
    });
  },
  primaryAction() {
    var that = this;
    if (!this.groupBuyId) return this.checkout();
    var gb = this.data.groupBuy;
    if (!gb) return;
    var joined = (gb.participants || []).some(function(p) { return p.memberId === api.memberId(); });
    if (joined) {
      if (gb.status === 'success') return this.checkout();
      return wx.showToast({ title: '还差 ' + gb.remaining + ' 人成团', icon: 'none' });
    }
    api.request('/api/wx/groupbuys/' + gb.id + '/join', 'POST', {}).then(function(updated) {
      updated.product = that.data.product;
      that.updateGroup(updated);
      if (updated.status === 'success') that.checkout();
      else wx.showToast({ title: '已参团，还差 ' + updated.remaining + ' 人', icon: 'none' });
    }).catch(function(e) { api.showError(e, '参团失败'); });
  },
  checkout() {
    var url = '/pages/checkout/checkout?id=' + this.productId;
    if (this.groupBuyId) url += '&groupBuyId=' + this.groupBuyId;
    wx.navigateTo({ url: url });
  }
});
