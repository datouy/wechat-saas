// 邻里团小程序入口
// 本地联调: 将 baseUrl 指向本机服务 (需在微信开发者工具中勾选"不校验合法域名")
App({
  globalData: {
    baseUrl: 'http://localhost:3100',
    memberId: '',
    userInfo: null
  },
  onLaunch() {
    var that = this;
    // 自动登录（mock模式本地即可跑通）
    wx.login({
      success(res) {
        if (!res.code) return;
        wx.request({
          url: that.globalData.baseUrl + '/api/wx/login',
          method: 'POST',
          data: { code: res.code },
          success(r) {
            if (r.data && r.data.success) {
              that.globalData.memberId = r.data.data.memberId;
              wx.setStorageSync('memberId', r.data.data.memberId);
            }
          }
        });
      }
    });
  }
});
