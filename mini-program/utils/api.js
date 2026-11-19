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
          if (res.statusCode === 401) {
            return reject(new Error('登录已过期，请重新进入小程序'));
          }
          if (res.data && res.data.success) resolve(res.data.data);
          else reject(new Error((res.data && res.data.error) || '请求失败'));
        },
        fail: function(err) { reject(new Error(err.errMsg || '网络错误')); }
      });
    });
  });
}
function memberId() {
  var app = getApp();
  return app.globalData.memberId || wx.getStorageSync('memberId') || '';
}
module.exports = { request: request, memberId: memberId };

