var api = require('./api');

function requestSubscriptions(events) {
  var ids = (events || []).map(function(event) { return event.templateId; }).filter(Boolean);
  if (!ids.length || !wx.requestSubscribeMessage) return Promise.resolve({});
  return new Promise(function(resolve) {
    wx.requestSubscribeMessage({ tmplIds: ids, success: resolve, fail: resolve });
  });
}

function requestConfiguredSubscriptions() {
  return api.request('/api/wx/subscriptions')
    .then(function(data) { return requestSubscriptions(data.events); })
    .catch(function() { return {}; });
}

function payOrder(orderId) {
  return api.request('/api/wx/orders/' + orderId + '/pay', 'POST', {}).then(function(result) {
    if (result.mock || result.alreadyPaid || !result.payParams) return result;
    return new Promise(function(resolve, reject) {
      var p = result.payParams;
      wx.requestPayment({
        timeStamp: p.timeStamp,
        nonceStr: p.nonceStr,
        package: p.package,
        signType: p.signType,
        paySign: p.paySign,
        success: function() { resolve(result); },
        fail: function() { reject(new Error('支付已取消')); }
      });
    });
  });
}

module.exports = {
  requestSubscriptions: requestSubscriptions,
  requestConfiguredSubscriptions: requestConfiguredSubscriptions,
  payOrder: payOrder
};
