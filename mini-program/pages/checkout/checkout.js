var api = require('../../utils/api');
var payment = require('../../utils/payment');

function cents(value) { return Math.max(0, Math.round(Number(value) || 0)); }

Page({
  data: {
    product: null,
    groupBuy: null,
    qty: 1,
    deliveryType: 'delivery',
    addresses: [],
    addressId: '',
    locations: [],
    pickupLocationId: '',
    coupons: [],
    couponId: '',
    couponTemplates: [],
    pointsBalance: 0,
    usePoints: '',
    showAddressForm: false,
    addressDraft: { name: '', phone: '', detail: '' },
    remark: '',
    goodsText: '0.00',
    couponText: '0.00',
    pointsText: '0.00',
    deliveryText: '0.00',
    totalText: '0.00',
    submitting: false,
    loading: true
  },

  onLoad(options) {
    this.productId = options.id;
    this.groupBuyId = options.groupBuyId || '';
    this.policy = { deliveryFee: 0, points: { enabled: true, maxPercentPerOrder: 50 } };
    this.load();
  },

  load() {
    var that = this;
    var mid = api.memberId();
    if (!mid) return wx.showToast({ title: '请先登录', icon: 'none' });
    var requests = [
      api.request('/api/wx/products/' + this.productId),
      api.request('/api/wx/member/' + mid),
      api.request('/api/wx/member/' + mid + '/points'),
      api.request('/api/wx/member/' + mid + '/coupons?status=unused'),
      api.request('/api/wx/coupons/templates'),
      api.request('/api/wx/checkout'),
      api.request('/api/wx/locations')
    ];
    if (this.groupBuyId) requests.push(api.request('/api/wx/groupbuys/' + this.groupBuyId));

    Promise.all(requests).then(function(r) {
      var member = r[1];
      var addresses = member.addresses || [];
      var defaultAddress = addresses.find(function(a) { return a.isDefault; }) || addresses[0];
      var locations = (r[6] || []).filter(function(item) { return item.pickupEnabled; });
      var primaryLocation = locations.find(function(item) { return item.isPrimary; }) || locations[0];
      that.policy = r[5];
      var coupons = r[3].map(function(c) {
        return Object.assign({}, c, { thresholdText: (c.threshold / 100).toFixed(2), amountText: (c.amount / 100).toFixed(2) });
      });
      var templates = r[4].map(function(c) {
        return Object.assign({}, c, { thresholdCent: cents(c.threshold * 100), amountCent: cents(c.amount * 100) });
      });
      that.setData({
        product: Object.assign({}, r[0], { image: api.assetUrl(r[0].image) }),
        groupBuy: r[7] || null,
        addresses: addresses,
        addressId: defaultAddress ? defaultAddress.id : '',
        locations: locations,
        pickupLocationId: primaryLocation ? primaryLocation.id : '',
        coupons: coupons,
        couponTemplates: templates,
        pointsBalance: r[2].balance,
        loading: false
      });
      that.recalc();
    }).catch(function(e) {
      that.setData({ loading: false });
      api.showError(e, '结算信息加载失败');
    });
  },

  unitPrice() {
    if (this.data.groupBuy) return cents(this.data.groupBuy.groupPrice);
    return cents(this.data.product.price * 100);
  },

  recalc() {
    if (!this.data.product) return;
    var goods = this.unitPrice() * this.data.qty;
    var selectedId = this.data.couponId;
    var coupon = this.data.coupons.find(function(c) { return c.id === selectedId; });
    var couponDiscount = coupon && goods >= coupon.threshold ? coupon.amount : 0;
    var afterCoupon = Math.max(0, goods - couponDiscount);
    var points = this.policy.points || {};
    var maxPoints = points.enabled === false ? 0 :
      Math.floor((afterCoupon / 100) * (Number(points.maxPercentPerOrder) || 0) / 100) * 100;
    var pointsUsed = Math.min(Math.max(0, Number(this.data.usePoints) || 0), this.data.pointsBalance, maxPoints);
    var deliveryFee = this.data.deliveryType === 'pickup' ? 0 : cents(this.policy.deliveryFee * 100);
    var total = Math.max(0, afterCoupon - pointsUsed + deliveryFee);
    this.setData({
      goodsText: (goods / 100).toFixed(2),
      couponText: (couponDiscount / 100).toFixed(2),
      pointsText: (pointsUsed / 100).toFixed(2),
      deliveryText: (deliveryFee / 100).toFixed(2),
      totalText: (total / 100).toFixed(2)
    });
  },

  plus() {
    if (this.data.qty >= this.data.product.stock) return;
    this.setData({ qty: this.data.qty + 1 });
    this.recalc();
  },

  minus() {
    if (this.data.qty <= 1) return;
    this.setData({ qty: this.data.qty - 1 });
    this.recalc();
  },

  chooseDelivery(e) {
    this.setData({ deliveryType: e.currentTarget.dataset.type });
    this.recalc();
  },

  chooseAddress(e) {
    this.setData({ addressId: e.currentTarget.dataset.id });
  },

  choosePickupLocation(e) {
    this.setData({ pickupLocationId: e.currentTarget.dataset.id });
  },

  toggleAddressForm() {
    this.setData({ showAddressForm: !this.data.showAddressForm });
  },

  onAddressInput(e) {
    var field = e.currentTarget.dataset.field;
    var draft = Object.assign({}, this.data.addressDraft);
    draft[field] = e.detail.value;
    this.setData({ addressDraft: draft });
  },

  saveAddress() {
    var that = this;
    var d = this.data.addressDraft;
    if (!d.name || !d.phone || !d.detail) return wx.showToast({ title: '请填写完整地址', icon: 'none' });
    api.request('/api/wx/member/' + api.memberId() + '/addresses', 'POST', d).then(function(address) {
      wx.showToast({ title: '地址已保存' });
      that.setData({
        showAddressForm: false,
        addressDraft: { name: '', phone: '', detail: '' },
        addressId: address.id
      });
      that.load();
    }).catch(function(e) { api.showError(e, '地址保存失败'); });
  },

  chooseCoupon(e) {
    var id = e.currentTarget.dataset.id;
    var selectedId = id;
    var coupon = this.data.coupons.find(function(c) { return c.id === selectedId; });
    var goods = this.unitPrice() * this.data.qty;
    if (!coupon || goods < coupon.threshold) return wx.showToast({ title: '未达到使用门槛', icon: 'none' });
    this.setData({ couponId: id });
    this.recalc();
  },

  clearCoupon() {
    this.setData({ couponId: '' });
    this.recalc();
  },

  claimCoupon(e) {
    var that = this;
    api.request('/api/wx/coupons/claim', 'POST', { templateId: e.currentTarget.dataset.id }).then(function() {
      wx.showToast({ title: '已领取' });
      that.load();
    }).catch(function(err) { api.showError(err, '优惠券领取失败'); });
  },

  onPoints(e) {
    this.setData({ usePoints: e.detail.value });
    this.recalc();
  },

  onRemark(e) { this.setData({ remark: e.detail.value }); },

  submit() {
    var that = this;
    if (this.data.submitting || !this.data.product) return;
    if (this.data.deliveryType === 'delivery' && !this.data.addressId) {
      return wx.showToast({ title: '请选择收货地址', icon: 'none' });
    }
    if (this.data.deliveryType === 'pickup' && !this.data.pickupLocationId) {
      return wx.showToast({ title: '请选择自提门店', icon: 'none' });
    }
    if (this.groupBuyId) {
      var gb = this.data.groupBuy;
      var joined = gb && (gb.participants || []).some(function(p) { return p.memberId === api.memberId(); });
      if (!gb || gb.status !== 'success' || !joined) return wx.showToast({ title: '团购尚未成团', icon: 'none' });
    }

    this.setData({ submitting: true });
    payment.requestConfiguredSubscriptions().then(function() {
      var options = {
        deliveryType: that.data.deliveryType,
        usePoints: Number(that.data.usePoints) || 0,
        remark: that.data.remark
      };
      if (that.data.couponId) options.couponId = that.data.couponId;
      if (that.data.deliveryType === 'delivery') options.addressId = that.data.addressId;
      if (that.data.deliveryType === 'pickup') options.pickupLocationId = that.data.pickupLocationId;
      if (that.groupBuyId) options.groupBuyId = that.groupBuyId;
      return api.request('/api/wx/orders', 'POST', {
        items: [{ productId: that.productId, quantity: that.data.qty }],
        options: options
      });
    }).then(function(order) {
      return payment.payOrder(order.id).then(function() {
        wx.showToast({ title: '支付成功' });
        setTimeout(function() { wx.switchTab({ url: '/pages/orders/orders' }); }, 500);
      }).catch(function(error) {
        wx.showModal({
          title: '订单已创建',
          content: error.message + '，可在订单中继续支付',
          showCancel: false,
          success: function() { wx.switchTab({ url: '/pages/orders/orders' }); }
        });
      });
    }).catch(function(e) {
      api.showError(e, '订单提交失败');
    }).then(function() {
      that.setData({ submitting: false });
    });
  }
});
