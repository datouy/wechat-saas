// 统一请求封装
function request(path, method, data) {
  var app = getApp();
  return new Promise(function(resolve, reject) {
    wx.request({
      url: app.globalData.baseUrl + path,
      method: method || 'GET',
      data: data || {},
      success: function(res) {
        if (res.data && res.data.success) resolve(res.data.data);
        else reject(new Error((res.data && res.data.error) || '请求失败'));
      },
      fail: function(err) { reject(new Error(err.errMsg || '网络错误')); }
    });
  });
}
function memberId() {
  var app = getApp();
  return app.globalData.memberId || wx.getStorageSync('memberId') || '';
}
module.exports = { request: request, memberId: memberId };
