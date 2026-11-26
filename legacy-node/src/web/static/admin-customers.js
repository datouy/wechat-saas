/* 经营台领域模块：customers */
(function (A) {
  'use strict';
  var state = A.state;
  var ROUTES = A.ROUTES;
  var STATUS = A.STATUS;
  var byId = A.byId, esc = A.esc, money = A.money, yuan = A.yuan, canManage = A.canManage;
  var isOwner = A.isOwner, todayString = A.todayString, shortDate = A.shortDate, fullDate = A.fullDate;
  var safeAssetUrl = A.safeAssetUrl, percent = A.percent, statusTag = A.statusTag, orderStatusTag = A.orderStatusTag;
  var paramsObject = A.paramsObject, routeHref = A.routeHref, navigate = A.navigate, readRoute = A.readRoute;
  var request = A.request, requestAll = A.requestAll, categories = A.categories, applySession = A.applySession;
  var toast = A.toast, setHeader = A.setHeader, button = A.button, linkButton = A.linkButton;
  var loading = A.loading, empty = A.empty, errorState = A.errorState, pageInfo = A.pageInfo;
  var field = A.field, searchForm = A.searchForm, openDialog = A.openDialog, closeDialog = A.closeDialog;
  var closeAndRefresh = A.closeAndRefresh, loadRoute = A.loadRoute, logout = A.logout;

async function renderCustomers(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/members?' + new URLSearchParams(q).toString());
    var rows = (data.list || []).map(function (member) {
      return '<tr><td><button class="link-action" data-action="member-detail" data-id="' + esc(member.id) + '">' + esc(member.nickname || '微信用户') + '</button><div class="cell-meta">' + esc(member.id) + '</div></td>' +
        '<td>' + esc(member.phone || '—') + '</td><td>' + Number(member.orderCount || 0) + '</td><td>' + yuan(member.totalSpent || 0) + '</td>' +
        '<td class="cell-nowrap">' + shortDate(member.lastLoginAt || member.createdAt) + '</td>' +
        '<td class="cell-actions">' + button('查看档案', 'member-detail', false, 'data-id="' + esc(member.id) + '"') + '</td></tr>';
    }).join('');
    byId('content').innerHTML = '<div class="toolbar">' + searchForm('搜索昵称或手机号', params) + '</div>' +
      '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>客户</th><th>手机号</th><th>订单</th><th>累计消费</th><th>最近登录</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">' + empty('没有匹配的客户') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('customers', params, { page: page }); }) + '</div>';
  }

async function openMemberDetail(id) {
    var requests = [request('/api/admin/members/' + encodeURIComponent(id))];
    if (canManage()) requests.push(requestAll('/api/admin/coupons'));
    var result = await Promise.all(requests);
    var data = result[0];
    request('/api/admin/onboarding/customer', { method: 'POST', body: {} }).catch(function () {});
    var templates = (result[1] || []).filter(function (coupon) { return coupon.enabled; });
    var member = data.member || {};
    var summary = data.summary || {};
    var orders = (data.orders || []).slice(0, 5).map(function (order) {
      return '<button type="button" class="history-row" data-action="order-detail" data-id="' + esc(order.id) + '"><span><strong>' + esc(order.orderNo) + '</strong><small>' + shortDate(order.createdAt) + '</small></span>' + orderStatusTag(order) + '<b>' + money(order.payAmount) + '</b></button>';
    }).join('') || '<div class="detail-empty">还没有订单</div>';
    var ledger = (data.points.ledger || []).slice(0, 5).map(function (item) {
      return '<div class="history-row static"><span><strong>' + esc(item.reason) + '</strong><small>' + shortDate(item.createdAt) + '</small></span><b class="' + (item.change > 0 ? 'positive' : 'negative') + '">' + (item.change > 0 ? '+' : '') + Number(item.change) + '</b></div>';
    }).join('') || '<div class="detail-empty">暂无积分流水</div>';
    var coupons = (data.coupons || []).slice(0, 5).map(function (coupon) {
      return '<div class="history-row static"><span><strong>' + esc(coupon.name) + '</strong><small>' + (coupon.status === 'unused' ? '可使用' : coupon.status === 'used' ? '已使用' : '已过期') + '</small></span><b>减 ' + money(coupon.amount) + '</b></div>';
    }).join('') || '<div class="detail-empty">暂无优惠券</div>';
    var templateOptions = templates.map(function (coupon) {
      return '<option value="' + esc(coupon.id) + '">' + esc(coupon.name + ' · 满 ' + yuan(coupon.threshold) + ' 减 ' + yuan(coupon.amount)) + '</option>';
    }).join('');
    var operations = canManage() ? '<div class="detail-section"><h3>会员运营</h3><div class="operation-grid">' +
      '<div class="action-box"><h4>调整积分</h4><p class="action-help">正数增加，负数扣减；每次调整都会写入积分流水与审计日志。</p><div class="form-grid">' +
      field('积分变化', '<input id="memberPointsAmount" type="number" step="1" placeholder="例如 100 或 -50">') +
      field('调整原因', '<input id="memberPointsReason" maxlength="80" placeholder="例如 线下活动补发">') +
      '</div>' + button('确认调整', 'member-points', true, 'data-id="' + esc(member.id) + '"') + '</div>' +
      '<div class="action-box"><h4>发放优惠券</h4><p class="action-help">从当前启用的优惠券模板中发放，可用于召回和复购活动。</p>' +
      (templates.length ? '<label class="form-field"><span class="field-label">优惠券</span><select id="memberCouponTemplate">' + templateOptions + '</select></label>' + button('立即发放', 'member-coupon', true, 'data-id="' + esc(member.id) + '"') : '<div class="detail-empty">没有可用优惠券模板</div>') +
      '</div></div></div>' : '';
    openDialog('客户档案', '<div class="member-head"><div class="member-avatar">' + esc((member.nickname || '邻').slice(0, 1)) + '</div><div><h3>' + esc(member.nickname || '微信用户') + '</h3><p>' + esc(member.phone || '未留手机号') + ' · ' + esc((member.addresses || []).length) + ' 个收货地址</p></div><span class="member-points">' + Number((data.points || {}).balance || 0) + '<small>积分</small></span></div>' +
      '<div class="member-metrics"><div><span>累计消费</span><strong>' + money(summary.paidAmount || 0) + '</strong></div><div><span>订单</span><strong>' + Number(summary.orderCount || 0) + '</strong></div><div><span>可用券</span><strong>' + Number(summary.unusedCoupons || 0) + '</strong></div><div><span>待履约预约</span><strong>' + Number(summary.upcomingAppointments || 0) + '</strong></div></div>' +
      '<div class="detail-section"><h3>最近订单</h3><div class="history-list">' + orders + '</div></div>' +
      '<div class="detail-grid history-columns"><div class="detail-section"><h3>积分流水</h3><div class="history-list">' + ledger + '</div></div><div class="detail-section"><h3>优惠券</h3><div class="history-list">' + coupons + '</div></div></div>' + operations,
      button('关闭', 'close-dialog'));
  }

async function adjustMemberPoints(id) {
    var amount = Number(byId('memberPointsAmount').value);
    var reason = byId('memberPointsReason').value.trim();
    if (!Number.isInteger(amount) || amount === 0) throw new Error('请输入非零整数积分');
    if (!reason) throw new Error('请填写积分调整原因');
    await request('/api/admin/members/' + encodeURIComponent(id) + '/points', { method: 'POST', body: { amount: amount, reason: reason } });
    toast('积分已调整');
    await openMemberDetail(id);
  }

async function grantMemberCoupon(id) {
    var templateId = byId('memberCouponTemplate').value;
    if (!templateId) throw new Error('请选择优惠券');
    await request('/api/admin/members/' + encodeURIComponent(id) + '/coupons', { method: 'POST', body: { templateId: templateId } });
    toast('优惠券已发放');
    await openMemberDetail(id);
  }

async function renderGroupBuys(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/groupbuys?' + new URLSearchParams(q).toString());
    state.groupBuyMap = {};
    (data.list || []).forEach(function (group) { state.groupBuyMap[group.id] = group; });
    var rows = (data.list || []).map(function (group) {
      var status = { active: ['进行中', 'blue'], success: ['已成团', 'green'], closed: ['已结束', 'gray'], cancelled: ['已取消', 'red'] }[group.status] || [group.status, 'gray'];
      return '<tr><td><div class="cell-primary">' + esc(group.title) + '</div><div class="cell-meta">' + esc(group.product ? group.product.name : '商品已删除') + '</div></td>' +
        '<td>' + money(group.groupPrice) + '</td><td>' + group.participantCount + ' / ' + group.minParticipants + '</td>' +
        '<td><span class="tag ' + status[1] + '">' + status[0] + '</span></td><td class="cell-nowrap">' + fullDate(group.endAt) + '</td>' +
        '<td class="cell-actions">' + (group.status === 'active' && canManage() ? '<button type="button" class="button small" data-action="groupbuy-edit" data-id="' + esc(group.id) + '">改期</button> <button type="button" class="button small danger" data-action="groupbuy-cancel" data-id="' + esc(group.id) + '">结束</button>' : '') + '</td></tr>';
    }).join('');
    byId('content').innerHTML = '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>活动</th><th>团购价</th><th>人数</th><th>状态</th><th>截止</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">' + empty('还没有团购活动') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('group-buys', params, { page: page }); }) + '</div>';
  }

async function openGroupBuyForm() {
    var products = await requestAll('/api/admin/products', { keyword: '' });
    if (!products.length) return toast('请先创建商品', true);
    var options = products.map(function (product) { return '<option value="' + esc(product.id) + '">' + esc(product.name + ' · ' + yuan(product.price)) + '</option>'; }).join('');
    openDialog('发起团购', '<div class="form-grid">' +
      field('商品', '<select id="groupProduct">' + options + '</select>', true) +
      field('活动名称', '<input id="groupTitle" maxlength="50">', true) +
      field('团购价', '<input id="groupPrice" type="number" min="0.01" step="0.01">') +
      field('成团人数', '<input id="groupMin" type="number" min="2" value="3">') +
      field('持续小时', '<input id="groupHours" type="number" min="1" value="24">') +
      '</div>', button('取消', 'close-dialog') + button('发起', 'groupbuy-save', true));
  }

async function saveGroupBuy() {
    await request('/api/admin/groupbuys', {
      method: 'POST',
      body: {
        productId: byId('groupProduct').value,
        title: byId('groupTitle').value.trim(),
        groupPrice: Number(byId('groupPrice').value),
        minParticipants: Number(byId('groupMin').value),
        durationHours: Number(byId('groupHours').value)
      }
    });
    toast('团购已发起');
    closeAndRefresh();
  }

async function cancelGroupBuy(id) {
    if (!confirm('结束这个团购活动？')) return;
    await request('/api/admin/groupbuys/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: {} });
    toast('团购已结束');
    loadRoute();
  }

function openGroupBuyUpdate(id) {
    var group = state.groupBuyMap[id];
    if (!group) return;
    openDialog('调整团购 · ' + group.title, '<div class="detail-grid"><div class="detail-item"><div class="detail-label">当前截止</div><div class="detail-value">' + fullDate(group.endAt) + '</div></div><div class="detail-item"><div class="detail-label">当前人数</div><div class="detail-value">' + Number(group.participantCount || 0) + ' / ' + Number(group.maxParticipants || 100) + '</div></div></div>' +
      '<div class="form-grid" style="margin-top:18px">' + field('延长小时', '<input id="groupExtendHours" type="number" min="1" max="720" value="24">') +
      field('人数上限', '<input id="groupMaxParticipants" type="number" min="2" value="' + Number(group.maxParticipants || 100) + '">') + '</div>' +
      '<p class="form-help">延期从原截止时间继续计算；人数上限不能低于当前参团人数和成团人数。</p>',
      button('取消', 'close-dialog') + button('保存调整', 'groupbuy-update-save', true, 'data-id="' + esc(id) + '"'));
  }

async function saveGroupBuyUpdate(id) {
    var body = {
      extendHours: Number(byId('groupExtendHours').value),
      maxParticipants: Number(byId('groupMaxParticipants').value)
    };
    await request('/api/admin/groupbuys/' + encodeURIComponent(id), { method: 'PUT', body: body });
    toast('团购截止时间和人数上限已更新');
    closeAndRefresh();
  }

async function renderCoupons(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/coupons?' + new URLSearchParams(q).toString());
    state.couponMap = {};
    (data.list || []).forEach(function (coupon) { state.couponMap[coupon.id] = coupon; });
    var rows = (data.list || []).map(function (coupon) {
      return '<tr><td class="cell-primary">' + esc(coupon.name) + '</td><td>满 ' + yuan(coupon.threshold) + '</td><td>减 ' + yuan(coupon.amount) + '</td>' +
        '<td>' + coupon.validDays + ' 天</td><td>' + coupon.limitPerMember + ' 张/人</td><td>' + (coupon.enabled ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>') + '</td>' +
        '<td class="cell-actions">' + (canManage() ? button('编辑', 'coupon-edit', false, 'data-id="' + esc(coupon.id) + '"') +
        button(coupon.enabled ? '停用' : '启用', 'coupon-toggle', false, 'data-id="' + esc(coupon.id) + '"') +
        button('删除', 'coupon-delete', false, 'data-id="' + esc(coupon.id) + '"') : '') + '</td></tr>';
    }).join('');
    byId('content').innerHTML =
      '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>名称</th><th>门槛</th><th>优惠</th><th>有效期</th><th>领取上限</th><th>状态</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7">' + empty('还没有优惠券') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('coupons', params, { page: page }); }) + '</div>';
  }

function openCouponForm(coupon) {
    coupon = coupon || { validDays: 30, limitPerMember: 1, threshold: 0, enabled: true };
    openDialog(coupon.id ? '编辑优惠券' : '新建优惠券', '<div class="form-grid">' +
      field('名称', '<input id="couponName" maxlength="30" value="' + esc(coupon.name || '') + '">', true) +
      field('使用门槛', '<input id="couponThreshold" type="number" min="0" step="0.01" value="' + Number(coupon.threshold || 0) + '">') +
      field('优惠金额', '<input id="couponAmount" type="number" min="0.01" step="0.01" value="' + Number(coupon.amount || '') + '">') +
      field('有效期', '<input id="couponDays" type="number" min="1" value="' + Number(coupon.validDays || 30) + '">') +
      field('每人限领', '<input id="couponLimit" type="number" min="1" value="' + Number(coupon.limitPerMember || 1) + '">') +
      field('状态', '<label class="checkbox-row"><input id="couponEnabled" type="checkbox" ' + (coupon.enabled !== false ? 'checked' : '') + '> 启用并可领取</label>', true) +
      '</div>', button('取消', 'close-dialog') + button(coupon.id ? '保存' : '创建', 'coupon-save', true, 'data-id="' + esc(coupon.id || '') + '"'));
  }

async function saveCoupon(id) {
    var body = {
      name: byId('couponName').value.trim(),
      threshold: Number(byId('couponThreshold').value || 0),
      amount: Number(byId('couponAmount').value),
      validDays: Number(byId('couponDays').value || 30),
      limitPerMember: Number(byId('couponLimit').value || 1),
      enabled: byId('couponEnabled').checked
    };
    await request('/api/admin/coupons' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PUT' : 'POST', body: body });
    toast(id ? '优惠券已保存' : '优惠券已创建');
    closeAndRefresh();
  }

async function toggleCoupon(id) {
    var coupon = state.couponMap[id];
    if (!coupon) throw new Error('优惠券不存在');
    await request('/api/admin/coupons/' + encodeURIComponent(id), { method: 'PUT', body: { enabled: !coupon.enabled } });
    toast(coupon.enabled ? '优惠券已停用' : '优惠券已启用');
    loadRoute();
  }

async function removeCoupon(id) {
    if (!confirm('删除这个优惠券模板？已发放的券会使删除操作被系统阻止。')) return;
    await request('/api/admin/coupons/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('优惠券已删除');
    loadRoute();
  }

async function renderSurveys(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    var data = await request('/api/admin/forms?' + new URLSearchParams(q).toString());
    state.formMap = {};
    (data.list || []).forEach(function (form) { state.formMap[form.id] = form; });
    var rows = (data.list || []).map(function (form) {
      return '<tr><td><div class="cell-primary">' + esc(form.title) + '</div><div class="cell-meta">' + esc(form.description || '') + '</div></td>' +
        '<td>' + form.fields.length + '</td><td>' + (form.status === 'open' ? '<span class="tag green">收集中</span>' : '<span class="tag gray">已关闭</span>') + '</td>' +
        '<td class="cell-nowrap">' + shortDate(form.createdAt) + '</td><td class="cell-actions">' + button('统计', 'survey-stats', false, 'data-id="' + esc(form.id) + '"') +
        (canManage() ? button('编辑', 'survey-edit', false, 'data-id="' + esc(form.id) + '"') + button(form.status === 'open' ? '停止收集' : '重新开放', 'survey-toggle', false, 'data-id="' + esc(form.id) + '"') : '') + '</td></tr>';
    }).join('');
    byId('content').innerHTML = '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>问卷</th><th>题数</th><th>状态</th><th>创建时间</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5">' + empty('还没有问卷') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(data, function (page) { return routeHref('surveys', params, { page: page }); }) + '</div>';
  }

function openSurveyForm(form) {
    state.surveyEditingId = form ? form.id : '';
    state.surveyFields = form ? form.fields.map(function (item) {
      return { label: item.label, type: item.type, options: (item.options || []).join(', '), required: !!item.required };
    }) : [{ label: '', type: 'text', options: '', required: false }];
    openDialog(form ? '编辑问卷' : '新建问卷', '<div class="form-grid">' +
      field('标题', '<input id="surveyTitle" maxlength="50" value="' + esc(form ? form.title : '') + '">', true) +
      field('说明', '<input id="surveyDescription" maxlength="300" value="' + esc(form ? form.description || '' : '') + '">', true) +
      '</div><div class="section-heading"><h3>问题</h3><button type="button" class="button small" data-action="survey-add-field">添加问题</button></div><div class="survey-fields" id="surveyFieldEditor"></div>',
      button('取消', 'close-dialog') + button(form ? '保存' : '创建', 'survey-save', true));
    renderSurveyFields();
  }

function renderSurveyFields() {
    var editor = byId('surveyFieldEditor');
    if (!editor) return;
    editor.innerHTML = state.surveyFields.map(function (item, index) {
      var types = [['text', '单行文字'], ['textarea', '多行文字'], ['radio', '单选'], ['checkbox', '多选'], ['rating', '评分'], ['number', '数字']].map(function (type) {
        return '<option value="' + type[0] + '" ' + (item.type === type[0] ? 'selected' : '') + '>' + type[1] + '</option>';
      }).join('');
      return '<div class="survey-field"><input aria-label="问题 ' + (index + 1) + '" placeholder="问题" value="' + esc(item.label) + '" data-survey-index="' + index + '" data-survey-prop="label">' +
        '<select aria-label="类型" data-survey-index="' + index + '" data-survey-prop="type">' + types + '</select>' +
        '<input class="survey-options" aria-label="选项" placeholder="选项，以逗号分隔" value="' + esc(item.options) + '" data-survey-index="' + index + '" data-survey-prop="options">' +
        '<label class="checkbox-row"><input type="checkbox" data-survey-index="' + index + '" data-survey-prop="required" ' + (item.required ? 'checked' : '') + '>必填</label>' +
        '<button type="button" class="button small remove" data-action="survey-remove-field" data-index="' + index + '" aria-label="删除问题">×</button></div>';
    }).join('');
  }

function addSurveyField() {
    state.surveyFields.push({ label: '', type: 'text', options: '', required: false });
    renderSurveyFields();
  }

function removeSurveyField(index) {
    state.surveyFields.splice(index, 1);
    renderSurveyFields();
  }

async function saveSurvey() {
    var title = byId('surveyTitle').value.trim();
    var fields = state.surveyFields.map(function (item) {
      return {
        label: item.label.trim(),
        type: item.type,
        options: item.options.split(',').map(function (value) { return value.trim(); }).filter(Boolean),
        required: !!item.required
      };
    });
    var id = state.surveyEditingId || '';
    await request('/api/admin/forms' + (id ? '/' + encodeURIComponent(id) : ''), {
      method: id ? 'PUT' : 'POST',
      body: { title: title, description: byId('surveyDescription').value.trim(), fields: fields }
    });
    toast(id ? '问卷已保存' : '问卷已创建');
    closeAndRefresh();
  }

async function toggleSurvey(id) {
    var form = state.formMap[id];
    if (!form) throw new Error('问卷不存在');
    await request('/api/admin/forms/' + encodeURIComponent(id), {
      method: 'PUT',
      body: { status: form.status === 'open' ? 'closed' : 'open' }
    });
    toast(form.status === 'open' ? '问卷已停止收集' : '问卷已重新开放');
    loadRoute();
  }

async function showSurveyStats(id) {
    var data = await request('/api/admin/forms/' + encodeURIComponent(id) + '/stats');
    var blocks = data.fields.map(function (item) {
      var distribution = Object.keys(item.distribution || {}).map(function (key) {
        return '<div class="distribution-row"><span>' + esc(key) + '</span><span>' + esc(item.distribution[key]) + '</span></div>';
      }).join('');
      var average = item.average !== null && item.average !== undefined ? '<div class="distribution-row"><span>平均分</span><span>' + item.average + '</span></div>' : '';
      return '<div class="stat-block"><h4>' + esc(item.label) + '</h4>' + (distribution || average || '<div class="distribution-row"><span>暂无回答</span><span>0</span></div>') + '</div>';
    }).join('');
    openDialog('问卷统计', '<div class="callout">' + data.total + ' 份提交</div><div class="stats-list" style="margin-top:18px">' + blocks + '</div>', button('关闭', 'close-dialog'));
  }

async function renderAppointments(params) {
    var serviceParams = new URLSearchParams();
    serviceParams.set('page', params.get('sp') || '1');
    serviceParams.set('pageSize', '20');
    var appointmentParams = new URLSearchParams();
    appointmentParams.set('page', params.get('ap') || '1');
    appointmentParams.set('pageSize', '20');
    if (params.get('status')) appointmentParams.set('status', params.get('status'));
    var result = await Promise.all([
      request('/api/admin/appointments/services?' + serviceParams.toString()),
      request('/api/admin/appointments?' + appointmentParams.toString())
    ]);
    var services = result[0];
    var appointments = result[1];
    state.serviceMap = {};
    (services.list || []).forEach(function (service) { state.serviceMap[service.id] = service; });
    var serviceRows = (services.list || []).map(function (service) {
      return '<tr><td><div class="cell-primary">' + esc(service.name) + '</div><div class="cell-meta">' + esc((service.slots || []).join('、')) + '</div></td>' +
        '<td>' + yuan(service.price) + '</td><td>' + service.durationMinutes + ' 分钟</td><td>' + service.capacityPerSlot + ' 人/时段</td>' +
        '<td>' + (service.enabled !== false ? '<span class="tag green">可预约</span>' : '<span class="tag gray">已停用</span>') + '</td>' +
        '<td class="cell-actions">' + (canManage() ? button('编辑', 'appointment-service-edit', false, 'data-id="' + esc(service.id) + '"') +
        button(service.enabled !== false ? '停用' : '启用', 'appointment-service-toggle', false, 'data-id="' + esc(service.id) + '"') : '') + '</td></tr>';
    }).join('');
    var statusMap = { booked: ['已预约', 'blue'], completed: ['已完成', 'green'], cancelled: ['已取消', 'gray'] };
    var appointmentRows = (appointments.list || []).map(function (item) {
      var status = statusMap[item.status] || [item.status, 'gray'];
      return '<tr><td class="cell-primary">' + esc(item.serviceName) + '</td><td>' + esc(item.date) + ' ' + esc(item.slot) + '</td>' +
        '<td><span class="tag ' + status[1] + '">' + status[0] + '</span></td><td>' + esc(item.note || '—') + '</td>' +
        '<td class="cell-actions">' + (item.status === 'booked' ? '<button type="button" class="button small" data-action="appointment-complete" data-id="' + esc(item.id) + '">完成</button> <button type="button" class="button small danger" data-action="appointment-cancel" data-id="' + esc(item.id) + '">取消</button>' : '') + '</td></tr>';
    }).join('');
    var statusTabs = [['', '全部'], ['booked', '已预约'], ['completed', '已完成'], ['cancelled', '已取消']].map(function (item) {
      return '<a class="filter-tab ' + ((params.get('status') || '') === item[0] ? 'active' : '') + '" href="' + routeHref('appointments', params, { status: item[0], ap: 1 }) + '">' + item[1] + '</a>';
    }).join('');
    byId('content').innerHTML =
      '<div class="section-heading"><h3>服务</h3></div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>服务</th><th>价格</th><th>时长</th><th>容量</th><th>状态</th><th></th></tr></thead><tbody>' +
      (serviceRows || '<tr><td colspan="6">' + empty('还没有服务') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(services, function (page) { return routeHref('appointments', params, { sp: page }); }) + '</div>' +
      '<div class="section-heading"><h3>预约</h3><div class="filter-tabs">' + statusTabs + '</div></div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>服务</th><th>时间</th><th>状态</th><th>备注</th><th></th></tr></thead><tbody>' +
      (appointmentRows || '<tr><td colspan="5">' + empty('没有预约记录') + '</td></tr>') + '</tbody></table></div>' +
      pageInfo(appointments, function (page) { return routeHref('appointments', params, { ap: page }); }) + '</div>';
  }

function openAppointmentServiceForm(service) {
    service = service || { durationMinutes: 60, capacityPerSlot: 1, enabled: true };
    openDialog(service.id ? '编辑预约服务' : '新增预约服务', '<div class="form-grid">' +
      field('服务名称', '<input id="serviceName" maxlength="30" value="' + esc(service.name || '') + '">', true) +
      field('价格', '<input id="servicePrice" type="number" min="0.01" step="0.01" value="' + Number(service.price || '') + '">') +
      field('时长（分钟）', '<input id="serviceDuration" type="number" min="1" value="' + Number(service.durationMinutes || 60) + '">') +
      field('每时段容量', '<input id="serviceCapacity" type="number" min="1" value="' + Number(service.capacityPerSlot || 1) + '">') +
      field('可约时段', '<input id="serviceSlots" value="' + esc((service.slots || []).join(', ')) + '" placeholder="09:00, 10:00, 14:00">', true) +
      field('状态', '<label class="checkbox-row"><input id="serviceEnabled" type="checkbox" ' + (service.enabled !== false ? 'checked' : '') + '> 对顾客开放预约</label>', true) +
      '</div>', button('取消', 'close-dialog') + button(service.id ? '保存' : '创建', 'appointment-service-save', true, 'data-id="' + esc(service.id || '') + '"'));
  }

async function saveAppointmentService(id) {
    await request('/api/admin/appointments/services' + (id ? '/' + encodeURIComponent(id) : ''), {
      method: id ? 'PUT' : 'POST',
      body: {
        name: byId('serviceName').value.trim(),
        price: Number(byId('servicePrice').value),
        durationMinutes: Number(byId('serviceDuration').value || 60),
        capacityPerSlot: Number(byId('serviceCapacity').value || 1),
        slots: byId('serviceSlots').value.split(',').map(function (value) { return value.trim(); }).filter(Boolean),
        enabled: byId('serviceEnabled').checked
      }
    });
    toast(id ? '预约服务已保存' : '预约服务已创建');
    closeAndRefresh();
  }

async function toggleAppointmentService(id) {
    var service = state.serviceMap[id];
    if (!service) throw new Error('预约服务不存在');
    await request('/api/admin/appointments/services/' + encodeURIComponent(id), {
      method: 'PUT',
      body: { enabled: service.enabled === false }
    });
    toast(service.enabled === false ? '预约服务已启用' : '预约服务已停用');
    loadRoute();
  }

async function finishAppointment(id, action) {
    await request('/api/admin/appointments/' + encodeURIComponent(id) + '/' + action, { method: 'POST', body: {} });
    toast(action === 'complete' ? '预约已完成' : '预约已取消');
    loadRoute();
  }

  var AFTER_SALES_STATUS = {
    pending: ['待受理', 'amber'], approved: ['已受理', 'blue'], resolved: ['已完成', 'green'],
    rejected: ['已拒绝', 'red'], closed: ['已关闭', 'gray']
  };
  var AFTER_SALES_TYPES = { refund: '退款', return: '退货', complaint: '投诉建议' };

async function renderAfterSales(params) {
    var q = paramsObject(params);
    q.page = q.page || '1';
    q.pageSize = q.pageSize || '20';
    if (!q.status) delete q.status;
    var data = await request('/api/admin/after-sales?' + new URLSearchParams(q).toString());
    state.afterSalesMap = {};
    var rows = (data.list || []).map(function (item) {
      state.afterSalesMap[item.id] = item;
      var status = AFTER_SALES_STATUS[item.status] || [item.status, 'gray'];
      var member = item.member || {};
      return '<tr><td><button class="link-action" data-action="after-sales-detail" data-id="' + esc(item.id) + '">' + esc(item.orderNo) + '</button><div class="cell-meta">' + esc(item.id.slice(0, 8)) + '</div></td>' +
        '<td>' + esc(member.nickname || '会员') + '<div class="cell-meta">' + esc(member.phone || item.memberId.slice(0, 8)) + '</div></td>' +
        '<td>' + esc(AFTER_SALES_TYPES[item.type] || item.type) + '</td><td>' + (Number(item.requestedAmount) ? money(item.requestedAmount) : '—') + '</td>' +
        '<td class="aftersales-reason">' + esc(item.reason) + '</td><td><span class="tag ' + status[1] + '">' + status[0] + '</span></td>' +
        '<td class="cell-nowrap">' + shortDate(item.createdAt) + '</td><td class="cell-actions">' + button('查看', 'after-sales-detail', false, 'data-id="' + esc(item.id) + '"') +
        (item.status === 'pending' ? button('受理', 'after-sales-approve', true, 'data-id="' + esc(item.id) + '"') : '') + '</td></tr>';
    }).join('');
    var tabs = [['', '全部'], ['pending', '待受理'], ['approved', '已受理'], ['resolved', '已完成'], ['rejected', '已拒绝'], ['closed', '已关闭']].map(function (item) {
      return '<a class="filter-tab ' + ((params.get('status') || '') === item[0] ? 'active' : '') + '" href="' + routeHref('after-sales', params, { status: item[0], page: 1 }) + '">' + item[1] + '</a>';
    }).join('');
    byId('content').innerHTML =
      '<div class="toolbar"><div class="filter-tabs">' + tabs + '</div><span class="toolbar-spacer"></span><span class="section-note">建议在 2 小时内完成首次响应</span></div>' +
      '<div class="data-panel"><div class="table-wrap"><table><thead><tr><th>工单 / 订单</th><th>客户</th><th>类型</th><th>申请金额</th><th>原因</th><th>状态</th><th>提交时间</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8">' + empty(params.get('status') ? '当前筛选下没有售后工单' : '还没有售后工单') + '</td></tr>') +
      '</tbody></table></div>' + pageInfo(data, function (page) { return routeHref('after-sales', params, { page: page }); }) + '</div>';
  }

function openAfterSalesDetail(id) {
    var item = state.afterSalesMap[id];
    if (!item) return;
    var status = AFTER_SALES_STATUS[item.status] || [item.status, 'gray'];
    var member = item.member || {};
    var active = item.status === 'pending' || item.status === 'approved';
    var footer = button('关闭', 'close-dialog') + button('查看订单', 'order-detail', false, 'data-id="' + esc(item.orderId) + '"');
    if (item.status === 'pending') footer += button('拒绝', 'after-sales-reject', false, 'data-id="' + esc(item.id) + '"') + button('受理申请', 'after-sales-approve', true, 'data-id="' + esc(item.id) + '"');
    if (item.status === 'approved') footer += button('标记完成', 'after-sales-finish', true, 'data-id="' + esc(item.id) + '"');
    openDialog('售后工单 · ' + item.orderNo, '<div class="detail-hero"><div><div class="detail-title">' + esc(AFTER_SALES_TYPES[item.type] || item.type) + '</div><div class="detail-subtitle">' + shortDate(item.createdAt) + '</div></div><span class="tag ' + status[1] + '">' + status[0] + '</span></div>' +
      '<div class="detail-section"><div class="detail-grid">' +
      '<div class="detail-item"><div class="detail-label">客户</div><div class="detail-value">' + esc(member.nickname || '会员') + '</div></div>' +
      '<div class="detail-item"><div class="detail-label">联系电话</div><div class="detail-value">' + esc(member.phone || '—') + '</div></div>' +
      '<div class="detail-item"><div class="detail-label">申请金额</div><div class="detail-value">' + (Number(item.requestedAmount) ? money(item.requestedAmount) : '不涉及退款') + '</div></div>' +
      '<div class="detail-item"><div class="detail-label">处理人</div><div class="detail-value">' + esc(item.resolvedByName || '—') + '</div></div></div></div>' +
      '<div class="detail-section"><h3>问题说明</h3><div class="message-box"><strong>' + esc(item.reason) + '</strong><p>' + esc(item.description || '顾客未补充详细说明。') + '</p></div></div>' +
      (item.resolution ? '<div class="detail-section"><h3>处理结论</h3><div class="message-box"><p>' + esc(item.resolution) + '</p></div></div>' : '') +
      (active ? '<div class="callout warning">退款资金仍应在订单详情中确认后发起，售后受理不会自动扣款或退款。</div>' : ''), footer);
  }

function openAfterSalesAction(id, status) {
    var labels = { approved: '受理售后申请', rejected: '拒绝售后申请', resolved: '完成售后申请' };
    openDialog(labels[status] || '更新售后', '<div class="form-grid">' + field('处理说明', '<textarea id="afterSalesResolution" maxlength="500" placeholder="记录与顾客沟通的结果、退款安排或拒绝原因"></textarea>', true) + '</div><p class="form-help">处理说明会同步给顾客的消息记录，并写入审计日志。</p>',
      button('取消', 'close-dialog') + button('确认', 'after-sales-resolve-save', true, 'data-id="' + esc(id) + '" data-status="' + esc(status) + '"'));
  }

async function saveAfterSalesAction(id, status) {
    var resolution = byId('afterSalesResolution').value.trim();
    if (!resolution && status !== 'approved') throw new Error('请填写处理说明');
    await request('/api/admin/after-sales/' + encodeURIComponent(id), {
      method: 'PUT', body: { status: status, resolution: resolution }
    });
    toast(status === 'approved' ? '售后申请已受理' : status === 'rejected' ? '售后申请已拒绝' : '售后申请已完成');
    closeAndRefresh();
  }

async function renderGrowth() {
    var result = await Promise.all([
      request('/api/admin/growth'),
      request('/api/admin/growth/materials')
    ]);
    var data = result[0];
    var materialData = result[1];
    var summary = data.summary || {};
    state.growthMaterials = materialData.items || [];
    var metrics = '<div class="summary-grid growth-metrics">' +
      '<div class="summary-cell"><div class="summary-label">会员成交率</div><div class="summary-value">' + Number(summary.buyers || 0) + '<small>/ ' + Number(summary.memberCount || 0) + ' 位</small></div></div>' +
      '<div class="summary-cell"><div class="summary-label">复购率</div><div class="summary-value">' + Number(summary.repurchaseRate || 0) + '<small>%</small></div></div>' +
      '<div class="summary-cell"><div class="summary-label">客单价</div><div class="summary-value compact">' + yuan(summary.averageOrderValue || 0) + '</div></div>' +
      '<div class="summary-cell"><div class="summary-label">累计会员收入</div><div class="summary-value compact">' + yuan(summary.lifetimeRevenue || 0) + '</div></div></div>';
    var segments = (data.segments || []).map(function (segment) {
      return '<article class="growth-segment"><div><span>' + esc(segment.label) + '</span><strong>' + Number(segment.count || 0) + '</strong></div><div class="segment-members">' +
        ((segment.members || []).slice(0, 5).map(function (member) { return '<button type="button" data-action="member-detail" data-id="' + esc(member.id) + '">' + esc(member.nickname) + '<small>' + (member.orderCount ? member.orderCount + ' 单 · ' + yuan(member.totalSpent) : '未成交') + '</small></button>'; }).join('') || '<small>暂无会员</small>') + '</div></article>';
    }).join('');
    var recallRows = (data.recallCandidates || []).map(function (member) {
      return '<tr><td><button class="link-action" data-action="member-detail" data-id="' + esc(member.id) + '">' + esc(member.nickname) + '</button><div class="cell-meta">' + esc(member.phone || member.id.slice(0, 8)) + '</div></td>' +
        '<td>' + esc(member.segment === 'dormant' ? '沉睡会员' : '即将沉睡') + '</td><td>' + (member.inactiveDays == null ? '—' : Number(member.inactiveDays) + ' 天') + '</td><td>' + yuan(member.totalSpent) + '</td></tr>';
    }).join('');
    var materials = state.growthMaterials.map(function (item) {
      return '<article class="material-card"><span>' + esc(item.type) + '</span><h4>' + esc(item.title) + '</h4><p>' + esc(item.content) + '</p>' + button('复制素材', 'growth-copy', false, 'data-id="' + esc(item.id) + '"') + '</article>';
    }).join('');
    byId('content').innerHTML = metrics +
      '<div class="section-heading"><h3>会员分层</h3><span>最近一次成交距今 21 / 45 天为预警边界</span></div><div class="growth-segments">' + (segments || empty('还缺少会员数据')) + '</div>' +
      '<div class="section-heading"><h3>需要主动联系</h3><span>按最近成交时间和历史消费排序</span></div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>会员</th><th>分层</th><th>未成交</th><th>净消费</th></tr></thead><tbody>' + (recallRows || '<tr><td colspan="4">' + empty('当前没有沉睡风险会员') + '</td></tr>') + '</tbody></table></div></div>' +
      '<div class="section-heading"><h3>群运营素材</h3><span>直接复制到微信群，减少临时写文案的时间</span></div><div class="material-grid">' + (materials || empty('当前没有可生成的活动素材')) + '</div>';
  }

async function copyGrowthMaterial(id) {
    var item = state.growthMaterials.find(function (entry) { return entry.id === id; });
    if (!item) throw new Error('素材不存在');
    var text = item.title + '\n' + item.content;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      var node = document.createElement('textarea');
      node.value = text;
      node.style.position = 'fixed';
      node.style.opacity = '0';
      document.body.appendChild(node);
      node.select();
      document.execCommand('copy');
      node.remove();
    }
    toast('素材已复制');
  }

  A.register({
    routes: { customers: renderCustomers, 'group-buys': renderGroupBuys, coupons: renderCoupons, surveys: renderSurveys, appointments: renderAppointments, 'after-sales': renderAfterSales, growth: renderGrowth },
    headers: { 'group-buys': function () { return canManage() ? button('发起团购', 'groupbuy-new', true) : ''; },
      coupons: function () { return canManage() ? button('新建优惠券', 'coupon-new', true) : ''; },
      surveys: function () { return canManage() ? button('新建问卷', 'survey-new', true) : ''; },
      appointments: function () { return canManage() ? button('新增服务', 'appointment-service-new', true) : ''; },
      'after-sales': function () { return button('刷新', 'refresh-route', false); },
      growth: function () { return button('刷新', 'refresh-route', false); } },
    actions: {
      'member-detail': function (node) { return openMemberDetail(node.getAttribute('data-id')); },
      'member-points': function (node) { return adjustMemberPoints(node.getAttribute('data-id')); },
      'member-coupon': function (node) { return grantMemberCoupon(node.getAttribute('data-id')); },
      'groupbuy-new': function () { return openGroupBuyForm(); },
      'groupbuy-save': function () { return saveGroupBuy(); },
      'groupbuy-edit': function (node) { openGroupBuyUpdate(node.getAttribute('data-id')); },
      'groupbuy-update-save': function (node) { return saveGroupBuyUpdate(node.getAttribute('data-id')); },
      'groupbuy-cancel': function (node) { return cancelGroupBuy(node.getAttribute('data-id')); },
      'coupon-new': function () { openCouponForm(null); },
      'coupon-edit': function (node) { return openCouponForm(state.couponMap[node.getAttribute('data-id')]); },
      'coupon-save': function (node) { return saveCoupon(node.getAttribute('data-id')); },
      'coupon-toggle': function (node) { return toggleCoupon(node.getAttribute('data-id')); },
      'coupon-delete': function (node) { return removeCoupon(node.getAttribute('data-id')); },
      'survey-new': function () { openSurveyForm(); },
      'survey-edit': function (node) { return openSurveyForm(state.formMap[node.getAttribute('data-id')]); },
      'survey-toggle': function (node) { return toggleSurvey(node.getAttribute('data-id')); },
      'survey-add-field': function () { addSurveyField(); },
      'survey-remove-field': function (node) { removeSurveyField(Number(node.getAttribute('data-index'))); },
      'survey-save': function () { return saveSurvey(); },
      'survey-stats': function (node) { return showSurveyStats(node.getAttribute('data-id')); },
      'appointment-service-new': function () { openAppointmentServiceForm(); },
      'appointment-service-edit': function (node) { return openAppointmentServiceForm(state.serviceMap[node.getAttribute('data-id')]); },
      'appointment-service-save': function (node) { return saveAppointmentService(node.getAttribute('data-id')); },
      'appointment-service-toggle': function (node) { return toggleAppointmentService(node.getAttribute('data-id')); },
      'appointment-complete': function (node) { return finishAppointment(node.getAttribute('data-id'), 'complete'); },
      'appointment-cancel': function (node) {
        if (!confirm('取消这次预约？')) return;
        return finishAppointment(node.getAttribute('data-id'), 'cancel');
      },
      'after-sales-detail': function (node) { openAfterSalesDetail(node.getAttribute('data-id')); },
      'after-sales-approve': function (node) { openAfterSalesAction(node.getAttribute('data-id'), 'approved'); },
      'after-sales-reject': function (node) { openAfterSalesAction(node.getAttribute('data-id'), 'rejected'); },
      'after-sales-finish': function (node) { openAfterSalesAction(node.getAttribute('data-id'), 'resolved'); },
      'after-sales-resolve-save': function (node) { return saveAfterSalesAction(node.getAttribute('data-id'), node.getAttribute('data-status')); },
      'growth-copy': function (node) { return copyGrowthMaterial(node.getAttribute('data-id')); }
    },
    onInput: function (node) {

      if (node.hasAttribute('data-survey-index')) {
        var item = state.surveyFields[Number(node.getAttribute('data-survey-index'))];
        if (!item) return;
        var prop = node.getAttribute('data-survey-prop');
        item[prop] = node.type === 'checkbox' ? node.checked : node.value;
      }
    },
    onChange: function (node) {

      if (node.hasAttribute('data-survey-index')) {
        var item = state.surveyFields[Number(node.getAttribute('data-survey-index'))];
        if (!item) return;
        var prop = node.getAttribute('data-survey-prop');
        item[prop] = node.type === 'checkbox' ? node.checked : node.value;
      }
    }
  });
})(window.AdminRuntime);
