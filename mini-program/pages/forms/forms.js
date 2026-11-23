var api = require('../../utils/api');
Page({
  data: { forms: [], current: null, answers: {}, stars: [1,2,3,4,5] },
  onShow() { this.load(); },
  load() {
    var that = this;
    api.request('/api/wx/forms').then(function(list) { that.setData({ forms: list }); })
      .catch(function(e) { api.showError(e, '表单加载失败'); });
  },
  openForm(e) {
    var that = this, id = e.currentTarget.dataset.id;
    api.request('/api/wx/forms/' + id).then(function(f) {
      that.setData({ current: f, answers: {} });
    }).catch(function(e) { api.showError(e, '表单加载失败'); });
  },
  back() { this.setData({ current: null }); },
  onAnswer(e) { this.data.answers[e.currentTarget.dataset.fid] = e.detail.value; },
  onRadio(e) { this.data.answers[e.currentTarget.dataset.fid] = e.detail.value; },
  onCheckbox(e) {
    var fid = e.currentTarget.dataset.fid;
    var arr = this.data.answers[fid] || [];
    var v = e.detail.value;
    if (e.currentTarget.dataset.checked) arr = arr.filter(function(x){ return x !== v; });
    else arr.push(v);
    this.data.answers[fid] = arr;
  },
  onRating(e) { this.data.answers[e.currentTarget.dataset.fid] = Number(e.currentTarget.dataset.v); },
  submit() {
    var that = this;
    api.request('/api/wx/forms/' + this.data.current.id + '/submit', 'POST', {
      memberId: api.memberId(),
      answers: this.data.answers
    }).then(function() {
      wx.showToast({ title: '提交成功' });
      that.setData({ current: null });
      that.load();
    }).catch(function(e) { api.showError(e, '提交失败'); });
  }
});
