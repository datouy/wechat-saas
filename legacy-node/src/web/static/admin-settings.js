/* 经营台领域模块：settings */
(function (A) {
  'use strict';
  var state = A.state;
  var ROUTES = A.ROUTES;
  var STATUS = A.STATUS;
  var ROLE_LABELS = A.ROLE_LABELS;
  var byId = A.byId, esc = A.esc, money = A.money, yuan = A.yuan, canManage = A.canManage;
  var isOwner = A.isOwner, todayString = A.todayString, shortDate = A.shortDate, fullDate = A.fullDate;
  var safeAssetUrl = A.safeAssetUrl, percent = A.percent, statusTag = A.statusTag, orderStatusTag = A.orderStatusTag;
  var paramsObject = A.paramsObject, routeHref = A.routeHref, navigate = A.navigate, readRoute = A.readRoute;
  var request = A.request, requestAll = A.requestAll, categories = A.categories, applySession = A.applySession;
  var toast = A.toast, setHeader = A.setHeader, button = A.button, linkButton = A.linkButton;
  var loading = A.loading, empty = A.empty, errorState = A.errorState, pageInfo = A.pageInfo;
  var field = A.field, searchForm = A.searchForm, openDialog = A.openDialog, closeDialog = A.closeDialog;
  var closeAndRefresh = A.closeAndRefresh, loadRoute = A.loadRoute, logout = A.logout;

async function renderSettings() {
    var jobs = [
      { key: 'system', path: '/api/admin/system' },
      { key: 'profile', path: '/api/admin/store' },
      { key: 'subscriptions', path: '/api/admin/subscriptions' },
      { key: 'locations', path: '/api/admin/locations' }
    ];
    if (canManage()) {
      jobs.push({ key: 'diagnostics', path: '/api/admin/system/diagnostics' });
      jobs.push({ key: 'auditVerify', path: '/api/admin/audit-logs/verify' });
      jobs.push({ key: 'assets', path: '/api/admin/assets' });
    }
    if (isOwner()) jobs.push({ key: 'admins', path: '/api/admin/admins' });
    var results = await Promise.all(jobs.map(function (job) { return request(job.path); }));
    var response = {};
    jobs.forEach(function (job, index) { response[job.key] = results[index]; });
    var system = response.system;
    var profile = response.profile;
    var subscriptions = response.subscriptions;
    var locations = response.locations || [];
    var diagnostics = response.diagnostics || null;
    var verify = response.auditVerify || null;
    var admins = response.admins || [];
    var assets = response.assets || [];
    state.store = profile;
    state.staffMap = {};
    state.locationMap = {};
    state.templateMap = {};
    state.assetMap = {};
    admins.forEach(function (admin) { state.staffMap[admin.id] = admin; });
    locations.forEach(function (location) { state.locationMap[location.id] = location; });
    assets.forEach(function (asset) { state.assetMap[asset.id] = asset; });
    var locationRows = locations.map(function (location) {
      state.locationMap[location.id] = location;
      return '<article class="location-card ' + (location.status === 'disabled' ? 'disabled' : '') + '"><div class="location-mark" style="--location-color:' + esc(location.brandColor || '#b84a35') + '">' + esc((location.name || '店').slice(0, 1)) + '</div><div><div class="location-title"><strong>' + esc(location.name) + '</strong>' + (location.isPrimary ? '<span class="tag green">主门店</span>' : '') + (location.status === 'disabled' ? '<span class="tag gray">停用</span>' : '') + '</div><small>' + esc(location.address) + '</small><p>' + esc(location.hours || '') + ' · ' + (location.pickupEnabled ? '可自提' : '不可自提') + ' · ' + (location.deliveryEnabled ? '可配送' : '不配送') + '</p></div>' +
        (isOwner() ? '<div class="row-actions">' + button('编辑', 'location-edit', false, 'data-id="' + esc(location.id) + '"') + '</div>' : '') + '</article>';
    }).join('') || empty('还没有履约门店');
    var templateRows = (subscriptions.templates || []).map(function (item) {
      state.templateMap[item.event] = item;
      return '<div class="template-row"><div><strong>' + esc(item.title || item.event) + '</strong><small>' + esc(item.event) + ' · ' + (item.source === 'tenant' ? '门店配置' : item.source === 'environment' ? '环境变量' : '未配置') + '</small></div><span class="tag ' + (item.enabled && item.configured ? 'green' : item.configured ? 'gray' : 'amber') + '">' + (item.enabled && item.configured ? '启用' : item.configured ? '停用' : '待配置') + '</span><div class="row-actions">' + (canManage() ? button('编辑', 'template-edit', false, 'data-id="' + esc(item.event) + '"') + button(item.enabled ? '停用' : '启用', 'template-toggle', false, 'data-id="' + esc(item.event) + '"') + button('测试', 'template-test', false, 'data-id="' + esc(item.event) + '"') : '') + '</div></div>';
    }).join('') || empty('还没有订阅消息事件');
    var notificationRows = (subscriptions.recent || []).map(function (item) {
      var status = { sent: ['已发送', 'green'], mocked: ['模拟', 'gray'], failed: ['失败', 'red'], sending: ['发送中', 'blue'] }[item.status] || [item.status, 'gray'];
      return '<tr><td>' + esc(item.title || item.event) + '</td><td><span class="tag ' + status[1] + '">' + status[0] + '</span></td><td>' + shortDate(item.createdAt) + '</td></tr>';
    }).join('');
    var staffRows = admins.map(function (admin) {
      return '<div class="staff-row"><div class="staff-identity"><span class="staff-avatar">' + esc(admin.username.slice(0, 1).toUpperCase()) + '</span><span><strong>' + esc(admin.username) + '</strong><small>' + esc(ROLE_LABELS[admin.role] || admin.role) + ' · ' + (admin.status === 'active' ? '正常' : '已停用') + '</small></span></div>' +
        '<div class="row-actions">' + button('编辑', 'staff-edit', false, 'data-id="' + esc(admin.id) + '"') + button('撤销会话', 'staff-revoke', false, 'data-id="' + esc(admin.id) + '"') +
        (admin.role !== 'owner' ? button(admin.status === 'active' ? '停用' : '启用', 'staff-toggle', false, 'data-id="' + esc(admin.id) + '"') : '') + '</div></div>';
    }).join('');
    var staffSection = isOwner() ? '<section class="settings-section"><div class="section-heading"><div><h3>团队与权限</h3><span>密码修改、停用账号或主动撤销会话后会立即失效。</span></div>' + button('新增员工', 'staff-new', true) + '</div><div class="staff-list">' + (staffRows || empty('还没有员工账号')) + '</div></section>' : '';
    var monitoring = diagnostics ? diagnostics.metrics : system.metrics;
    var readiness = diagnostics ? diagnostics.readiness : system.readiness;
    var alerts = (monitoring && monitoring.alerts || []).map(function (item) { return '<div class="monitor-alert ' + esc(item.level) + '"><strong>' + esc(item.title) + '</strong><span>' + esc(item.detail) + '</span></div>'; }).join('');
    var routeRows = ((monitoring && monitoring.routes) || []).slice(0, 8).map(function (item) {
      return '<tr><td><code>' + esc(item.route) + '</code></td><td>' + Number(item.count) + '</td><td>' + Number(item.p95Ms) + ' ms</td><td>' + Number(item.errors) + '</td></tr>';
    }).join('');
    var errors = ((monitoring && monitoring.recentErrors) || []).slice(0, 5).map(function (item) {
      return '<div class="error-row"><strong>' + esc(item.source) + '</strong><span>' + esc(item.message) + '</span><small>' + esc(item.requestId || '无请求号') + ' · ' + shortDate(item.createdAt) + '</small></div>';
    }).join('');
    var readinessHtml = ((readiness && readiness.checks) || []).map(function (item) {
      return '<div class="health-row"><span class="status-dot ' + (item.status === 'up' ? '' : 'warning') + '"></span><strong>' + esc(item.name) + '</strong><small>' + esc(typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail || '')) + '</small></div>';
    }).join('');
    var chainHtml = verify ? '<div class="security-inline ' + (verify.valid ? 'valid' : 'invalid') + '"><span>' + (verify.valid ? '审计链完整' : '审计链异常') + '</span><small>' + Number(verify.checked || 0) + ' 条记录 · 链头 ' + esc(String(verify.headHash || '—').slice(0, 16)) + '</small></div>' : '';
    var companySection = canManage() ? '<section class="settings-section"><div class="section-heading"><div><h3>企业能力</h3><span>关键操作留痕，交易与账单定期核对。</span></div></div><div class="capability-grid">' +
      '<a class="capability-card" href="#/audit"><span>审计日志</span><strong>查看谁在什么时候改了什么</strong><small>进入审计日志</small></a>' +
      '<a class="capability-card" href="#/reports"><span>经营报表</span><strong>查看操作量与门店收入对比</strong><small>查看经营报表</small></a>' +
      '<a class="capability-card" href="#/reconciliation"><span>交易对账</span><strong>识别漏单、金额和退款差异</strong><small>开始核对账单</small></a></div></section>' : '';
    var logoUrl = safeAssetUrl(profile.logoUrl);
    var bannerUrl = safeAssetUrl(profile.brandImageUrl);
    var brandAssetCards = assets.slice(0, 6).map(function (asset) {
      var url = safeAssetUrl(asset.url);
      return '<article class="brand-asset-card"><div class="brand-asset-preview">' + (url ? '<img src="' + esc(url) + '" alt="' + esc(asset.originalName || asset.kind) + '">' : '<span>无预览</span>') + '</div><div><strong>' + esc(asset.kind) + '</strong><small>' + Number(asset.size || 0) + ' B · ' + shortDate(asset.createdAt) + '</small></div></article>';
    }).join('') || empty('还没有上传素材');
    var brandAssetSection = '<section class="settings-section"><div class="section-heading"><div><h3>品牌视觉素材</h3><span>Logo 建议 1:1；Banner 建议 16:9。上传后自动写入当前品牌配置。</span></div>' +
      (isOwner() ? '<div class="upload-actions"><label class="button file-button">上传 Logo<input id="logoAssetInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon" data-asset-kind="logo"></label><label class="button file-button">上传 Banner<input id="bannerAssetInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-asset-kind="banner"></label></div>' : '<span class="tag gray">只读</span>') + '</div>' +
      '<div class="brand-current"><div class="brand-current-preview logo-preview" id="logoCurrentPreview">' + (logoUrl ? '<img src="' + esc(logoUrl) + '" alt="当前 Logo">' : '<span>Logo</span>') + '</div><div class="brand-current-preview banner-preview" id="bannerCurrentPreview">' + (bannerUrl ? '<img src="' + esc(bannerUrl) + '" alt="当前 Banner">' : '<span>Banner</span>') + '</div><div><strong>当前品牌画面</strong><small>素材地址会随门店资料保存，可用于后续小程序装修与分享卡片。</small></div></div>' +
      '<div class="brand-asset-list">' + brandAssetCards + '</div></section>';
    byId('content').innerHTML =
      '<section class="settings-section"><div class="section-heading"><h3>品牌与小程序</h3><span>' + (isOwner() ? '仅所有者可修改' : '只读') + '</span></div><div class="settings-card"><fieldset ' + (isOwner() ? '' : 'disabled') + '><div class="form-grid">' +
      field('门店名称', '<input id="storeNameInput" maxlength="40" value="' + esc(profile.name || '') + '">') + field('品牌色', '<input id="storeBrandColor" type="color" value="' + esc(profile.brandColor || '#b84a35') + '">') +
      field('经营口号', '<input id="storeTagline" maxlength="80" value="' + esc(profile.tagline || '') + '">', true) + field('门店介绍', '<textarea id="storeDescription" maxlength="300">' + esc(profile.description || '') + '</textarea>', true) +
      field('公告', '<input id="storeAnnouncement" maxlength="160" value="' + esc(profile.announcement || '') + '">', true) + field('联系电话', '<input id="storePhone" maxlength="30" value="' + esc(profile.contactPhone || '') + '">') +
      field('默认自提地址', '<input id="storePickup" maxlength="120" value="' + esc(profile.pickupAddress || '') + '">') + field('配送说明', '<input id="storeDelivery" maxlength="160" value="' + esc(profile.deliveryNotice || '') + '">', true) +
      field('收款方式', '<select id="storePaymentMode"><option value="wechat" ' + (profile.paymentMode !== 'offline' ? 'selected' : '') + '>微信支付</option><option value="offline" ' + (profile.paymentMode === 'offline' ? 'selected' : '') + '>线下收款（商家确认）</option></select>') +
      field('线下付款说明', '<textarea id="storeOfflinePaymentInstructions" maxlength="300">' + esc(profile.offlinePaymentInstructions || '') + '</textarea>', true) +
      field('小程序标题', '<input id="miniProgramTitle" maxlength="60" value="' + esc(profile.miniProgramTitle || '') + '">') + field('小程序 AppID', '<input id="miniProgramAppId" maxlength="64" value="' + esc(profile.miniProgramAppId || '') + '">') +
      field('客服电话', '<input id="customerServicePhone" maxlength="30" value="' + esc(profile.customerServicePhone || '') + '">', true) +
      field('Logo 地址', '<input id="storeLogoUrl" maxlength="2048" value="' + esc(profile.logoUrl || '') + '" placeholder="/uploads/租户/logo.png">', true) + field('Banner 地址', '<input id="storeBannerUrl" maxlength="2048" value="' + esc(profile.brandImageUrl || '') + '" placeholder="/uploads/租户/banner.png">', true) + '</div></fieldset>' + (isOwner() ? '<div class="settings-actions">' + button('保存品牌与小程序配置', 'store-save', true) + '</div>' : '') + '</div></section>' +
      brandAssetSection +
      '<section class="settings-section"><div class="section-heading"><div><h3>履约门店</h3><span>试点租户最多 20 个门店，自提结算时可选择可用门店。</span></div>' + (isOwner() ? button('新增门店', 'location-new', true) : '') + '</div><div class="location-list">' + locationRows + '</div></section>' +
      staffSection + companySection +
      '<section class="settings-section"><div class="section-heading"><h3>订阅消息模板</h3><span>模板 ID 可由环境变量兜底，可在门店级覆盖。</span></div><div class="template-list">' + templateRows + '</div></section>' +
      '<section class="settings-section"><div class="section-heading"><h3>最近发送</h3><span>发送失败不会阻断支付或履约主链路</span></div><div class="data-panel"><div class="table-wrap"><table><thead><tr><th>事件</th><th>状态</th><th>时间</th></tr></thead><tbody>' + (notificationRows || '<tr><td colspan="3">' + empty('暂无发送记录') + '</td></tr>') + '</tbody></table></div></div></section>' +
      '<section class="settings-section"><div class="section-heading"><h3>运行监控</h3><span>Prometheus 指标端点已就绪，多实例指标由外部系统聚合</span></div><div class="environment-grid"><div><span>微信能力</span><strong>' + (system.wechatMock ? '本地模拟' : '正式对接') + '</strong></div><div><span>请求总数</span><strong>' + Number(monitoring && monitoring.totalRequests || 0) + '</strong></div><div><span>错误率</span><strong>' + (Number(monitoring && monitoring.errorRate || 0) * 100).toFixed(2) + '%</strong></div><div><span>就绪状态</span><strong>' + (readiness && readiness.status === 'ok' ? '正常' : '需检查') + '</strong></div></div>' +
      (alerts ? '<div class="monitor-alerts">' + alerts + '</div>' : '<div class="callout" style="margin-top:12px">当前没有触发运行告警。</div>') + '<div class="monitor-health">' + readinessHtml + '</div>' +
      '<div class="data-panel" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>接口</th><th>请求</th><th>P95</th><th>错误</th></tr></thead><tbody>' + (routeRows || '<tr><td colspan="4">' + empty('还没有接口指标') + '</td></tr>') + '</tbody></table></div></div>' +
      (errors ? '<div class="section-heading"><h3>最近错误</h3><span>包含请求追踪号</span></div><div class="error-list">' + errors + '</div>' : '') + '</section>' +
      '<section class="settings-section"><div class="section-heading"><h3>会话与安全</h3><span>令牌按账号版本即时撤销</span></div><div class="security-card"><div><strong>撤销当前账号的全部会话</strong><small>包括当前浏览器，下一步需要重新登录。</small>' + chainHtml + '</div>' + button('撤销并退出', 'session-revoke', false) + '</div></section>' +
      (state.session && state.session.demo && isOwner() ? '<section class="settings-section demo-settings"><div><h3>演示环境</h3><p>重置后恢复 6 个商品、2 个团购、5 位客户和完整经营待办。</p></div>' + button('重新载入演示数据', 'demo-reset', false) + '</section>' : '');
  }

function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('读取图片失败')); };
      reader.readAsDataURL(file);
    });
  }

async function uploadBrandAsset(input) {
    if (!isOwner()) throw new Error('仅所有者可修改品牌素材');
    var file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error('图片不能超过 2 MB');
    var mimeMap = { 'image/vnd.microsoft.icon': 'image/x-icon' };
    var mimeType = mimeMap[file.type] || file.type;
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon'].indexOf(mimeType) < 0) {
      throw new Error('仅支持 PNG、JPEG、WebP、GIF 或 ICO 图片');
    }
    var kind = input.getAttribute('data-asset-kind') || 'brand';
    input.disabled = true;
    try {
      var data = await readFileAsDataUrl(file);
      var asset = await request('/api/admin/assets', { method: 'POST', body: {
        filename: file.name, mimeType: mimeType, data: data, kind: kind
      } });
      var url = safeAssetUrl(asset.url);
      var patch = kind === 'logo' ? { logoUrl: url } : { brandImageUrl: url };
      var updated = await request('/api/admin/store', { method: 'PUT', body: patch });
      state.store = Object.assign({}, state.store || {}, updated);
      var fieldNode = byId(kind === 'logo' ? 'storeLogoUrl' : 'storeBannerUrl');
      var previewNode = byId(kind === 'logo' ? 'logoCurrentPreview' : 'bannerCurrentPreview');
      if (fieldNode) fieldNode.value = url;
      if (previewNode) previewNode.innerHTML = url ? '<img src="' + esc(url) + '" alt="当前 ' + esc(kind) + '">' : '<span>暂无预览</span>';
      toast(kind === 'logo' ? 'Logo 已上传并应用' : 'Banner 已上传并应用');
    } finally {
      input.disabled = false;
      input.value = '';
    }
  }

async function copyAssetUrl(url) {
    if (!url) throw new Error('素材地址为空');
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(url);
    else {
      var area = document.createElement('textarea');
      area.value = url;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast('素材地址已复制');
  }

async function saveStoreProfile() {
    var updated = await request('/api/admin/store', {
      method: 'PUT',
      body: {
        name: byId('storeNameInput').value.trim(), tagline: byId('storeTagline').value.trim(),
        description: byId('storeDescription').value.trim(), announcement: byId('storeAnnouncement').value.trim(),
        contactPhone: byId('storePhone').value.trim(), pickupAddress: byId('storePickup').value.trim(),
        deliveryNotice: byId('storeDelivery').value.trim(), brandColor: byId('storeBrandColor').value,
        paymentMode: byId('storePaymentMode').value,
        offlinePaymentInstructions: byId('storeOfflinePaymentInstructions').value.trim(),
        miniProgramTitle: byId('miniProgramTitle').value.trim(), miniProgramAppId: byId('miniProgramAppId').value.trim(),
        customerServicePhone: byId('customerServicePhone').value.trim(),
        logoUrl: byId('storeLogoUrl').value.trim(), brandImageUrl: byId('storeBannerUrl').value.trim()
      }
    });
    if (state.session) applySession(Object.assign({}, state.session, { store: updated }));
    toast('门店资料已保存');
  }

function openStaffForm(admin) {
    admin = admin || { role: 'manager', status: 'active' };
    var roleOptions = [['manager', '经营管理员'], ['fulfillment', '履约专员']].map(function (item) {
      return '<option value="' + item[0] + '" ' + (admin.role === item[0] ? 'selected' : '') + '>' + item[1] + '</option>';
    }).join('');
    openDialog(admin.id ? '编辑员工' : '新增员工', '<div class="form-grid">' +
      field('用户名', '<input id="staffUsername" maxlength="32" value="' + esc(admin.username || '') + '" ' + (admin.id ? 'readonly' : '') + '>') +
      field('角色', '<select id="staffRole" ' + (admin.role === 'owner' ? 'disabled' : '') + '>' + (admin.role === 'owner' ? '<option>所有者</option>' : roleOptions) + '</select>') +
      field(admin.id ? '重置密码（可选）' : '初始密码', '<input id="staffPassword" type="password" minlength="10" autocomplete="new-password" placeholder="至少 10 位，含大小写字母和数字">', true) +
      '</div><p class="form-help">密码至少 10 位，必须包含大小写字母和数字，且不能包含用户名。修改密码会立即撤销该账号旧会话。</p>',
      button('取消', 'close-dialog') + button(admin.id ? '保存' : '创建', 'staff-save', true, 'data-id="' + esc(admin.id || '') + '"'));
  }

async function saveStaff(id) {
    var password = byId('staffPassword').value;
    if (!id) {
      await request('/api/admin/admins', {
        method: 'POST',
        body: { username: byId('staffUsername').value.trim(), password: password, role: byId('staffRole').value }
      });
    } else {
      var body = {};
      var roleNode = byId('staffRole');
      if (!roleNode.disabled) body.role = roleNode.value;
      if (password) body.password = password;
      if (!Object.keys(body).length) throw new Error('没有需要保存的修改');
      await request('/api/admin/admins/' + encodeURIComponent(id), { method: 'PUT', body: body });
    }
    toast(id ? '员工账号已保存' : '员工账号已创建');
    closeAndRefresh();
  }

async function toggleStaff(id) {
    var admin = state.staffMap[id];
    if (!admin) throw new Error('员工账号不存在');
    await request('/api/admin/admins/' + encodeURIComponent(id), {
      method: 'PUT',
      body: { status: admin.status === 'active' ? 'disabled' : 'active' }
    });
    toast(admin.status === 'active' ? '员工账号已停用' : '员工账号已启用');
    loadRoute();
  }

function openLocationForm(location) {
    location = location || { pickupEnabled: true, deliveryEnabled: true, status: 'active', brandColor: '#b84a35', hours: '每日 09:00-20:00' };
    openDialog(location.id ? '编辑履约门店' : '新增履约门店', '<div class="form-grid">' +
      field('门店名称', '<input id="locationName" maxlength="40" value="' + esc(location.name || '') + '">') + field('门店编码', '<input id="locationCode" maxlength="20" value="' + esc(location.code || '') + '" placeholder="例如 EAST">') +
      field('详细地址', '<input id="locationAddress" maxlength="160" value="' + esc(location.address || '') + '">', true) + field('联系电话', '<input id="locationPhone" maxlength="30" value="' + esc(location.phone || '') + '">') +
      field('营业时间', '<input id="locationHours" maxlength="80" value="' + esc(location.hours || '') + '">') + field('品牌色', '<input id="locationBrandColor" type="color" value="' + esc(location.brandColor || '#b84a35') + '">') +
      field('能力', '<div class="check-row"><label><input id="locationPickup" type="checkbox" ' + (location.pickupEnabled !== false ? 'checked' : '') + '> 支持自提</label><label><input id="locationDelivery" type="checkbox" ' + (location.deliveryEnabled !== false ? 'checked' : '') + '> 支持配送</label></div>', true) +
      field('状态', '<select id="locationStatus"><option value="active" ' + (location.status !== 'disabled' ? 'selected' : '') + '>启用</option><option value="disabled" ' + (location.status === 'disabled' ? 'selected' : '') + '>停用</option></select>') +
      field('主门店', '<label class="checkbox-row"><input id="locationPrimary" type="checkbox" ' + (location.isPrimary ? 'checked' : '') + '> 设为默认履约门店</label>') +
      '</div>', button('取消', 'close-dialog') + button(location.id ? '保存' : '创建', 'location-save', true, 'data-id="' + esc(location.id || '') + '"'));
  }

async function saveLocation(id) {
    var body = {
      name: byId('locationName').value.trim(), code: byId('locationCode').value.trim(),
      address: byId('locationAddress').value.trim(), phone: byId('locationPhone').value.trim(),
      hours: byId('locationHours').value.trim(), brandColor: byId('locationBrandColor').value,
      pickupEnabled: byId('locationPickup').checked, deliveryEnabled: byId('locationDelivery').checked,
      status: byId('locationStatus').value, isPrimary: byId('locationPrimary').checked
    };
    await request('/api/admin/locations' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PUT' : 'POST', body: body });
    toast(id ? '履约门店已更新' : '履约门店已创建');
    closeAndRefresh();
  }

function openTemplateForm(event) {
    var item = state.templateMap[event];
    if (!item) return;
    var dataJson = JSON.stringify(item.data || {}, null, 2);
    openDialog('订阅消息 · ' + (item.title || event), '<div class="form-grid">' +
      field('事件标识', '<input value="' + esc(item.event) + '" readonly>') + field('模板 ID', '<input id="templateIdInput" maxlength="128" value="' + esc(item.templateId || '') + '">') +
      field('点击跳转页面', '<input id="templatePage" maxlength="200" value="' + esc(item.page || '') + '" placeholder="pages/order/detail?id={orderId}">', true) +
      field('字段映射 JSON', '<textarea id="templateData" class="code-input" maxlength="8000">' + esc(dataJson) + '</textarea>', true) +
      field('状态', '<label class="checkbox-row"><input id="templateEnabled" type="checkbox" ' + (item.enabled !== false ? 'checked' : '') + '> 启用此事件</label>') +
      '</div><p class="form-help">字段映射示例：{"thing1":{"value":"订单 {orderNo}"},"amount2":{"value":"{amount}"}}。模板 ID 留空会覆盖环境变量配置为空，请谨慎保存。</p>',
      button('取消', 'close-dialog') + button('保存模板', 'template-save', true, 'data-id="' + esc(event) + '"'));
  }

async function saveTemplate(event) {
    var raw = byId('templateData').value.trim() || '{}';
    var data;
    try { data = JSON.parse(raw); } catch (error) { throw new Error('字段映射必须是有效 JSON'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('字段映射必须是 JSON 对象');
    await request('/api/admin/subscriptions/' + encodeURIComponent(event), { method: 'PUT', body: {
      templateId: byId('templateIdInput').value.trim(), page: byId('templatePage').value.trim(),
      data: data, enabled: byId('templateEnabled').checked
    } });
    toast('订阅消息模板已保存');
    closeAndRefresh();
  }

async function testTemplate(event) {
    var result = await request('/api/admin/subscriptions/' + encodeURIComponent(event) + '/test', { method: 'POST', body: {} });
    toast(result && result.mock ? '测试消息已写入模拟发送记录' : '测试消息已发送');
    loadRoute();
  }

async function toggleTemplate(event) {
    var item = state.templateMap[event];
    if (!item) throw new Error('消息模板不存在');
    await request('/api/admin/subscriptions/' + encodeURIComponent(event), { method: 'PUT', body: {
      templateId: item.templateId || '', page: item.page || '', data: item.data || {}, enabled: !item.enabled
    } });
    toast(item.enabled ? '消息事件已停用' : '消息事件已启用');
    loadRoute();
  }

async function revokeStaffSessions(id) {
    var admin = state.staffMap[id];
    if (!admin) throw new Error('员工账号不存在');
    if (!confirm('撤销 ' + admin.username + ' 的全部登录会话？对方需要重新登录。')) return;
    await request('/api/admin/admins/' + encodeURIComponent(id) + '/revoke-sessions', { method: 'POST', body: {} });
    toast('该账号的全部会话已撤销');
  }

async function revokeOwnSessions() {
    if (!confirm('撤销当前账号的全部会话？当前页面也会退出，需要重新登录。')) return;
    await request('/api/admin/session/revoke', { method: 'POST', body: {} });
    logout();
    toast('会话已撤销，请重新登录');
  }

async function resetDemoData() {
    if (!confirm('重新载入演示数据？当前演示订单、会员和团购数据会被替换。')) return;
    await request('/api/admin/demo/reset', { method: 'POST', body: {} });
    localStorage.removeItem('lt-shop-token');
    localStorage.removeItem('lt-shop-member-id');
    state.session = null;
    state.store = null;
    closeDialog();
    toast('演示数据已重新载入，顾客端会从全新体验开始');
    loadRoute();
  }

  A.register({
    routes: { settings: renderSettings },
    headers: {  },
    actions: {
      'demo-reset': function () { return resetDemoData(); },
      'asset-copy': function (node) { return copyAssetUrl(node.getAttribute('data-url')); },
      'store-save': function () { return saveStoreProfile(); },
      'staff-new': function () { openStaffForm(null); },
      'staff-edit': function (node) { openStaffForm(state.staffMap[node.getAttribute('data-id')]); },
      'staff-save': function (node) { return saveStaff(node.getAttribute('data-id')); },
      'staff-toggle': function (node) { return toggleStaff(node.getAttribute('data-id')); },
      'staff-revoke': function (node) { return revokeStaffSessions(node.getAttribute('data-id')); },
      'location-new': function () { openLocationForm(null); },
      'location-edit': function (node) { openLocationForm(state.locationMap[node.getAttribute('data-id')]); },
      'location-save': function (node) { return saveLocation(node.getAttribute('data-id')); },
      'template-edit': function (node) { openTemplateForm(node.getAttribute('data-id')); },
      'template-save': function (node) { return saveTemplate(node.getAttribute('data-id')); },
      'template-toggle': function (node) { return toggleTemplate(node.getAttribute('data-id')); },
      'template-test': function (node) { return testTemplate(node.getAttribute('data-id')); },
      'session-revoke': function () { return revokeOwnSessions(); }
    },
    onChange: function (node) {

      if (node.hasAttribute('data-asset-kind')) {
        uploadBrandAsset(node).catch(function (error) { toast(error.message, true); });
      }
    }
  });
})(window.AdminRuntime);
