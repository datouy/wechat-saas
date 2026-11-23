var api = require('./api');

function requestSubscriptions(events) {
  var configured = (events || []).filter(function(event) { return event && event.templateId; });
  var ids = configured.map(function(event) { return event.templateId; });
  if (!ids.length || !wx.requestSubscribeMessage) return Promise.resolve({ decisions: {}, accepted: 0 });
  return new Promise(function(resolve) {
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: resolve,
      fail: function(result) { resolve({ errMsg: result && result.errMsg || '订阅授权未完成' }); }
    });
  }).then(function(result) {
    var decisions = {};
    ids.forEach(function(id) {
      var decision = result && result[id];
      if (['accept', 'reject', 'ban', 'filter'].indexOf(decision) >= 0) decisions[id] = decision;
    });
    var outcome = {
      decisions: decisions,
      accepted: Object.keys(decisions).filter(function(id) { return decisions[id] === 'accept'; }).length,
      error: result && result.errMsg || ''
    };
    if (!Object.keys(decisions).length) return outcome;
    return api.request('/api/wx/subscriptions/authorize', 'POST', { decisions: decisions })
      .then(function(record) { return Object.assign(outcome, { record: record }); })
      .catch(function(error) { return Object.assign(outcome, { error: error.message }); });
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
