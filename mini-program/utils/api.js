// 统一请求封装：等待登录完成后发送，并携带 Authorization
function token() {
  var app = getApp();
  return app.globalData.token || wx.getStorageSync('token') || '';
}
function request(path, method, data) {
  var app = getApp();
  var ready = app.globalData.loginReady || Promise.resolve(null);
  return ready.then(function() {
    return new Promise(function(resolve, reject) {
      var header = { 'Content-Type': 'application/json' };
      var t = token();
      if (t) header['Authorization'] = 'Bearer ' + t;
      wx.request({
        url: app.globalData.baseUrl + path,
        method: method || 'GET',
        data: data || {},
        header: header,
        success: function(res) {
          var requestId = (res.header && (res.header['X-Request-Id'] || res.header['x-request-id'])) ||
            (res.data && res.data.requestId) || '';
          if (res.statusCode === 401) {
            var expired = new Error('登录已过期，请重新进入小程序');
            expired.requestId = requestId;
            expired.code = res.data && res.data.code;
            return reject(expired);
          }
          if (res.data && res.data.success) resolve(res.data.data);
          else {
            var error = new Error((res.data && res.data.error) || '请求失败');
            error.requestId = requestId;
            error.code = res.data && res.data.code;
            error.details = res.data && res.data.details;
            reject(error);
          }
        },
        fail: function(err) { reject(new Error(err.errMsg || '网络错误')); }
      });
    });
  });
}
function showError(error, title) {
  var message = (error && error.message) || '请求失败';
  if (error && error.requestId) {
    return wx.showModal({
      title: title || '请求未完成',
      content: message + '\n\n请求追踪号：' + error.requestId,
      showCancel: false
    });
  }
  return wx.showToast({ title: message, icon: 'none' });
}
function memberId() {
  var app = getApp();
  return app.globalData.memberId || wx.getStorageSync('memberId') || '';
}
function assetUrl(value) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  var app = getApp();
  var base = String(app.globalData.baseUrl || '').replace(/\/$/, '');
  return base + (String(value).charAt(0) === '/' ? '' : '/') + value;
}
module.exports = {
  request: request,
  memberId: memberId,
  assetUrl: assetUrl,
  showError: showError
};

