var api = require('../../utils/api');
Page({
  data: { services: [], dates: {}, selected: {}, slotsMap: {}, mine: [] },
  onShow() { this.load(); },
  load() {
    var that = this;
    api.request('/api/wx/appointments/services').then(function(list) {
      that.setData({ services: list });
    }).catch(function(e) { wx.showToast({ title: e.message, icon: 'none' }); });
    var mid = api.memberId();
    if (mid) {
      api.request('/api/wx/member/' + mid + '/appointments').then(function(list) {
        var stMap = { booked:'已预约', completed:'已完成', cancelled:'已取消' };
        that.setData({ mine: list.map(function(a){ return Object.assign({}, a, { statusText: stMap[a.status] || a.status }); }) });
      }).catch(function(){});
    }
  },
  onDate(e) {
    var sid = e.currentTarget.dataset.id, date = e.detail.value;
    var that = this;
    this.data.dates[sid] = date;
    this.setData({ dates: this.data.dates });
    api.request('/api/wx/appointments/slots?serviceId=' + sid + '&date=' + date).then(function(slots) {
      that.data.slotsMap[sid] = slots;
      that.setData({ slotsMap: that.data.slotsMap });
    }).catch(function(err) { wx.showToast({ title: err.message, icon: 'none' }); });
  },
  pickSlot(e) {
    var d = e.currentTarget.dataset;
    if (d.available <= 0) return wx.showToast({ title: '该时段已约满', icon: 'none' });
    this.data.selected[d.sid] = d.slot;
    this.setData({ selected: this.data.selected });
  },
  book(e) {
    var that = this, sid = e.currentTarget.dataset.id;
    var date = this.data.dates[sid];
    var slot = this.data.selected[sid];
    if (!date || !slot) return wx.showToast({ title: '请先选择日期和时段', icon: 'none' });
    api.request('/api/wx/appointments', 'POST', {
      serviceId: sid, memberId: api.memberId(), date: date, slot: slot
    }).then(function() {
      wx.showToast({ title: '预约成功' });
      that.load();
    }).catch(function(err) { wx.showToast({ title: err.message, icon: 'none' }); });
  }
});
