// 邻里团小程序入口
// 本地联调: 将 baseUrl 指向本机服务 (需在微信开发者工具中勾选"不校验合法域名")
App({
  globalData: {
    baseUrl: 'http://localhost:3100',
    memberId: '',
    token: '',
    userInfo: null,
    loginReady: null
  },
  onLaunch() {
    var that = this;
    // 自动登录；后续业务请求通过 loginReady 等待登录完成
    that.globalData.loginReady = new Promise(function(resolve) {
      wx.login({
        success(res) {
          if (!res.code) return resolve(null);
          wx.request({
            url: that.globalData.baseUrl + '/api/wx/login',
            method: 'POST',
            data: { code: res.code },
            success(r) {
              if (r.data && r.data.success && r.data.data && r.data.data.token) {
                var d = r.data.data;
                that.globalData.memberId = d.memberId;
                that.globalData.token = d.token;
                wx.setStorageSync('memberId', d.memberId);
                wx.setStorageSync('token', d.token);
                resolve(d.token);
              } else {
                resolve(null);
              }
            },
            fail() { resolve(null); }
          });
        },
        fail() { resolve(null); }
      });
    });
  }
});

