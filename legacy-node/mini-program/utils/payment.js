var api = require('./api');

function requestSubscriptions(events) {
  var seen = {};
  // 微信 requestSubscribeMessage 单次最多接收 3 个模板，重复请求也应在用户真实动作中触发。
  var configured = (events || []).filter(function(event) {
    if (!event || !event.templateId || seen[event.templateId]) return false;
    seen[event.templateId] = true;
    return true;
  }).slice(0, 3);
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

function requestConfiguredSubscriptions(preferredEvents) {
  return api.request('/api/wx/subscriptions')
    .then(function(data) {
      var events = data.events || [];
      if (preferredEvents && preferredEvents.length) {
        var rank = {};
        preferredEvents.forEach(function(event, index) { rank[event] = index; });
        events = events.slice().sort(function(a, b) {
          var ar = rank[a.event] === undefined ? 999 : rank[a.event];
          var br = rank[b.event] === undefined ? 999 : rank[b.event];
          return ar - br;
        });
      }
      return requestSubscriptions(events);
    })
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
