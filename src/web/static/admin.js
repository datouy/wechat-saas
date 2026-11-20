var state = { page: 'dashboard', products: [], categories: [], groupBuys: [], orders: [], members: [], coupons: [], forms: [], services: [], appointments: [] };

function api(path, options) {
  options = options || {};
  var headers = { 'Content-Type': 'application/json' };
  var token = localStorage.getItem('lt-admin-token');
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(path, {
    method: options.method || 'GET',
    headers: headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  }).then(function(r){
    if (r.status === 401) { localStorage.removeItem('lt-admin-token'); showLogin(); throw new Error('登录已过期'); }
    return r.json();
  }).then(function(j){
    if (!j.success) throw new Error(j.error || '请求失败');
    return j.data;
  });
}
function showLogin(){ document.getElementById('loginOverlay').classList.remove('hidden'); }
function hideLogin(){ document.getElementById('loginOverlay').classList.add('hidden'); }
function doLogin(){
  var u = document.getElementById('loginUser').value.trim();
  var p = document.getElementById('loginPass').value;
  var err = document.getElementById('loginErr');
  err.textContent = '';
  fetch('/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username:u, password:p }) })
    .then(function(r){ return r.json(); })
    .then(function(j){ if(!j.success) throw new Error(j.error || '登录失败'); localStorage.setItem('lt-admin-token', j.data.token); hideLogin(); loadAll(); })
    .catch(function(e){ err.textContent = e.message; });
}
function toast(msg, isErr) {
  var t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function(){ t.classList.add('hide'); setTimeout(function(){ t.remove(); }, 300); }, 2200);
}
function money(fen) { return '¥' + (fen / 100).toFixed(2); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; }); }

document.addEventListener('DOMContentLoaded', function(){
  // 导航
  document.querySelectorAll('.nav-item').forEach(function(el){
    el.addEventListener('click', function(){ go(el.getAttribute('data-page')); });
  });
  // 主题
  var theme = localStorage.getItem('lt-theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeBtn').addEventListener('click', function(){
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('lt-theme', next);
  });
  // 订单筛选
  document.getElementById('orderFilter').addEventListener('change', function(){ renderOrders(this.value); });
  // 全局按钮委托
  document.addEventListener('click', function(e){
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'add-product') addProduct();
    if (act === 'del-product') delProduct(btn.getAttribute('data-id'));
    if (act === 'toggle-product') toggleProduct(btn.getAttribute('data-id'));
    if (act === 'add-groupbuy') addGroupBuy();
    if (act === 'cancel-groupbuy') cancelGroupBuy(btn.getAttribute('data-id'));
    if (act === 'deliver-order') deliverOrder(btn.getAttribute('data-id'));
    if (act === 'add-coupon') addCoupon();
    if (act === 'add-form') addForm();
    if (act === 'view-form-stats') viewFormStats(btn.getAttribute('data-id'));
    if (act === 'go-page') go(btn.getAttribute('data-page'));
  });
  if (localStorage.getItem('lt-admin-token')) { loadAll(); } else { showLogin(); }
});

function go(p) {
  state.page = p;
  document.querySelectorAll('.nav-item').forEach(function(i){ i.classList.toggle('active', i.getAttribute('data-page') === p); });
  document.querySelectorAll('.page').forEach(function(pg){ pg.classList.toggle('active', pg.id === 'page-' + p); });
  var titles = { dashboard:'经营概览', products:'商品管理', groupbuys:'团购活动', orders:'订单管理', members:'会员中心', coupons:'优惠券', forms:'问卷表单', appointments:'预约管理', settings:'系统设置' };
  document.getElementById('pageTitle').textContent = titles[p] || p;
}

function loadAll() {
  Promise.all([
    api('/api/admin/stats'),
    api('/api/admin/categories'),
    api('/api/admin/products'),
    api('/api/admin/groupbuys'),
    api('/api/admin/orders'),
    api('/api/admin/members'),
    api('/api/admin/coupons'),
    api('/api/admin/forms'),
    api('/api/admin/appointments/services'),
    api('/api/admin/appointments'),
    api('/api/admin/system')
  ]).then(function(r){
    var stats = r[0];
    var arr = function(x){ return Array.isArray(x) ? x : ((x && x.list) || []); };
    state.categories = arr(r[1]); state.products = arr(r[2]); state.groupBuys = arr(r[3]);
    state.orders = arr(r[4]); state.members = arr(r[5]); state.coupons = arr(r[6]);
    state.forms = arr(r[7]); state.services = arr(r[8]); state.appointments = arr(r[9]);
    state.system = r[10];
    renderDashboard(stats);
    renderProducts();
    renderGroupBuys();
    renderOrders('');
    renderMembers();
    renderCoupons();
    renderForms();
    renderAppointments();
    renderSettings();
    fillSelects();
    document.getElementById('wxMode').textContent = '微信: ' + (state.system.wechatMock ? '模拟模式' : '正式对接');
  }).catch(function(e){
    toast('加载数据失败: ' + e.message, true);
  });
}

function fillSelects() {
  var catHtml = state.categories.map(function(c){ return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
  document.getElementById('pCategory').innerHTML = catHtml;
  var pHtml = state.products.map(function(p){ return '<option value="' + p.id + '">' + esc(p.name) + ' (' + money(Math.round(p.price * 100)) + ')</option>'; }).join('');
  document.getElementById('gbProduct').innerHTML = pHtml;
}

function renderDashboard(s) {
  var cards = [
    { label: '今日销售额', value: '¥' + s.today.amount.toFixed(2) },
    { label: '今日订单', value: s.today.orders + ' 单' },
    { label: '累计销售额', value: '¥' + s.total.amount.toFixed(2) },
    { label: '会员总数', value: s.memberCount + ' 人' },
    { label: '待支付订单', value: s.pendingOrders + ' 单' },
    { label: '进行中团购', value: s.groupBuys.active + ' 个' },
    { label: '今日预约', value: s.appointments.today + ' 个' },
    { label: '问卷提交', value: s.forms.submissions + ' 份' }
  ];
  document.getElementById('statCards').innerHTML = cards.map(function(c){
    return '<div class="stat"><div class="stat-label">' + c.label + '</div><div class="stat-value">' + c.value + '</div></div>';
  }).join('');

  var max = 1;
  s.trend.forEach(function(t){ if (t.amount > max) max = t.amount; });
  document.getElementById('trendBars').innerHTML = s.trend.map(function(t){
    var h = Math.round((t.amount / max) * 120);
    return '<div class="bar-wrap"><div class="bar" style="height:' + h + 'px" title="' + t.orders + '单 / ¥' + t.amount.toFixed(2) + '"></div><div class="bar-label">' + t.date.slice(5) + '</div></div>';
  }).join('');

  if (!s.topProducts.length) {
    document.getElementById('topProducts').innerHTML = '<div class="empty">暂无成交数据，下单后这里会显示热销商品</div>';
  } else {
    document.getElementById('topProducts').innerHTML = s.topProducts.map(function(p, i){
      return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span>' + (i+1) + '. ' + esc(p.name) + '</span><span style="color:var(--sub)">' + p.qty + ' 件 · ¥' + p.amount.toFixed(2) + '</span></div>';
    }).join('');
  }
}

function renderProducts() {
  var rows = state.products.map(function(p){
    return '<tr><td><strong>' + esc(p.name) + '</strong><div style="color:var(--sub);font-size:12px">' + esc(p.description || '') + '</div></td>' +
      '<td>¥' + p.price.toFixed(2) + '</td><td>' + p.stock + '</td><td>' + p.sales + '</td>' +
      '<td>' + (p.onSale ? '<span class="tag green">在售</span>' : '<span class="tag gray">下架</span>') + '</td>' +
      '<td><button class="btn sm ghost" data-act="toggle-product" data-id="' + p.id + '">' + (p.onSale ? '下架' : '上架') + '</button> ' +
      '<button class="btn sm danger" data-act="del-product" data-id="' + p.id + '">删除</button></td></tr>';
  }).join('');
  document.getElementById('productTable').innerHTML = '<tr><th>商品</th><th>价格</th><th>库存</th><th>销量</th><th>状态</th><th>操作</th></tr>' + (rows || '<tr><td colspan="6" class="empty">暂无商品</td></tr>');
}

function renderGroupBuys() {
  var rows = state.groupBuys.map(function(g){
    var pct = Math.min(100, Math.round((g.participantCount / g.minParticipants) * 100));
    var statusTag = { active:'<span class="tag blue">进行中</span>', success:'<span class="tag green">已成团</span>', closed:'<span class="tag gray">已结束</span>', cancelled:'<span class="tag red">已取消</span>' }[g.status] || g.status;
    return '<tr><td><strong>' + esc(g.title) + '</strong><div style="color:var(--sub);font-size:12px">' + esc(g.product ? g.product.name : '') + '</div></td>' +
      '<td>¥' + (g.groupPrice / 100).toFixed(2) + '</td><td>' + g.participantCount + '/' + g.minParticipants + '<div class="progress" style="margin-top:6px"><div style="width:' + pct + '%"></div></div></td>' +
      '<td>' + statusTag + '</td><td>' + new Date(g.endAt).toLocaleString() + '</td>' +
      '<td>' + (g.status === 'active' ? '<button class="btn sm danger" data-act="cancel-groupbuy" data-id="' + g.id + '">取消</button>' : '-') + '</td></tr>';
  }).join('');
  document.getElementById('groupBuyTable').innerHTML = '<tr><th>活动</th><th>团购价</th><th>进度</th><th>状态</th><th>截止时间</th><th>操作</th></tr>' + (rows || '<tr><td colspan="6" class="empty">暂无团购活动</td></tr>');
}

function renderOrders(filter) {
  var list = state.orders;
  if (filter) list = list.filter(function(o){ return o.status === filter; });
  var statusMap = { pending:'<span class="tag amber">待支付</span>', paid:'<span class="tag blue">待发货</span>', delivering:'<span class="tag blue">配送中</span>', completed:'<span class="tag green">已完成</span>', cancelled:'<span class="tag red">已取消</span>' };
  var rows = list.map(function(o){
    var itemStr = o.items.map(function(it){ return esc(it.name) + '×' + it.quantity; }).join('、');
    return '<tr><td>' + esc(o.orderNo) + '</td><td style="max-width:260px">' + itemStr + '</td><td><strong>' + money(o.payAmount) + '</strong></td>' +
      '<td>' + (statusMap[o.status] || o.status) + '</td><td>' + new Date(o.createdAt).toLocaleString() + '</td>' +
      '<td>' + (o.status === 'paid' ? '<button class="btn sm" data-act="deliver-order" data-id="' + o.id + '">发货</button>' : '-') + '</td></tr>';
  }).join('');
  document.getElementById('orderTable').innerHTML = '<tr><th>订单号</th><th>商品</th><th>实付</th><th>状态</th><th>下单时间</th><th>操作</th></tr>' + (rows || '<tr><td colspan="6" class="empty">暂无订单，去小程序端下单试试</td></tr>');
}

function renderMembers() {
  var rows = state.members.map(function(m){
    return '<tr><td>' + esc(m.nickname) + '</td><td>' + esc(m.phone || '-') + '</td><td>¥' + (m.totalSpent || 0).toFixed(2) + '</td><td>' + (m.orderCount || 0) + '</td><td>' + new Date(m.createdAt).toLocaleDateString() + '</td></tr>';
  }).join('');
  document.getElementById('memberTable').innerHTML = '<tr><th>昵称</th><th>手机号</th><th>累计消费</th><th>订单数</th><th>注册时间</th></tr>' + (rows || '<tr><td colspan="5" class="empty">暂无会员</td></tr>');
}

function renderCoupons() {
  var rows = state.coupons.map(function(c){
    return '<tr><td><strong>' + esc(c.name) + '</strong></td><td>满' + c.threshold + '元</td><td>减' + c.amount + '元</td><td>' + c.validDays + '天</td><td>每人限' + c.limitPerMember + '张</td><td>' + (c.enabled ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>') + '</td></tr>';
  }).join('');
  document.getElementById('couponTable').innerHTML = '<tr><th>名称</th><th>门槛</th><th>优惠</th><th>有效期</th><th>限领</th><th>状态</th></tr>' + (rows || '<tr><td colspan="6" class="empty">暂无优惠券</td></tr>');
}

function renderForms() {
  var rows = state.forms.map(function(f){
    return '<tr><td><strong>' + esc(f.title) + '</strong><div style="color:var(--sub);font-size:12px">' + esc(f.description || '') + '</div></td><td>' + f.fields.length + ' 个问题</td><td>' + (f.status === 'open' ? '<span class="tag green">收集中</span>' : '<span class="tag gray">已关闭</span>') + '</td><td><button class="btn sm ghost" data-act="view-form-stats" data-id="' + f.id + '">查看统计</button></td></tr>';
  }).join('');
  document.getElementById('formTable').innerHTML = '<tr><th>问卷</th><th>题数</th><th>状态</th><th>操作</th></tr>' + (rows || '<tr><td colspan="4" class="empty">暂无问卷</td></tr>');
}

function renderAppointments() {
  var srows = state.services.map(function(s){
    return '<tr><td><strong>' + esc(s.name) + '</strong></td><td>¥' + s.price.toFixed(2) + '</td><td>' + s.durationMinutes + ' 分钟</td><td>' + esc(s.slots.join('、')) + '</td><td>' + s.capacityPerSlot + ' 人/时段</td></tr>';
  }).join('');
  document.getElementById('serviceTable').innerHTML = '<tr><th>服务</th><th>价格</th><th>时长</th><th>可约时段</th><th>容量</th></tr>' + (srows || '<tr><td colspan="5" class="empty">暂无服务</td></tr>');

  var arows = state.appointments.map(function(a){
    var st = { booked:'<span class="tag blue">已预约</span>', completed:'<span class="tag green">已完成</span>', cancelled:'<span class="tag gray">已取消</span>' }[a.status] || a.status;
    return '<tr><td>' + esc(a.serviceName) + '</td><td>' + esc(a.date) + ' ' + esc(a.slot) + '</td><td>' + st + '</td><td>' + esc(a.note || '-') + '</td></tr>';
  }).join('');
  document.getElementById('apptTable').innerHTML = '<tr><th>服务</th><th>时间</th><th>状态</th><th>备注</th></tr>' + (arows || '<tr><td colspan="4" class="empty">暂无预约记录</td></tr>');
}

function renderSettings() {
  var s = state.system || {};
  document.getElementById('sysInfo').innerHTML =
    '<div class="form-grid"><div class="field"><label>系统名称</label><div>' + esc(s.name) + '</div></div>' +
    '<div class="field"><label>版本</label><div>v' + s.version + '</div></div>' +
    '<div class="field"><label>Node版本</label><div>' + s.nodeVersion + '</div></div>' +
    '<div class="field"><label>运行时长</label><div>' + Math.round(s.uptime) + ' 秒</div></div>' +
    '<div class="field"><label>商户ID</label><div>' + esc(s.tenantId) + '</div></div>' +
    '<div class="field"><label>微信模式</label><div>' + (s.wechatMock ? '模拟模式（本地联调）' : '正式对接') + '</div></div></div>';
  document.getElementById('wxHelp').innerHTML =
    '<div style="line-height:1.9;font-size:13.5px;color:var(--sub)">' +
    '<p>1. 当前为 <b style="color:var(--warn)">模拟模式</b>：小程序登录、支付均本地模拟，可跑通完整业务流程。</p>' +
    '<p>2. 正式上线需要在 <b>config/default.js</b> 填入微信小程序 AppID / AppSecret / 商户号，并设置 <b>WX_MOCK=false</b>。</p>' +
    '<p>3. 小程序端域名需在微信公众平台配置 request 合法域名（需 HTTPS）。</p>' +
    '<p>4. 支付需商户API证书与 v3 签名，详见 docs/微信上线清单.md。</p>' +
    '</div>';
}

// ===== 操作 =====
function addProduct() {
  var body = {
    name: document.getElementById('pName').value.trim(),
    price: Number(document.getElementById('pPrice').value),
    originalPrice: Number(document.getElementById('pOriginal').value || document.getElementById('pPrice').value),
    stock: Number(document.getElementById('pStock').value || 0),
    unit: document.getElementById('pUnit').value.trim() || '份',
    categoryId: document.getElementById('pCategory').value,
    description: document.getElementById('pDesc').value.trim()
  };
  if (!body.name || !(body.price > 0)) return toast('请填写商品名称和价格', true);
  api('/api/admin/products', { method: 'POST', body: body }).then(function(){
    toast('商品已添加');
    ['pName','pPrice','pOriginal','pStock','pUnit','pDesc'].forEach(function(id){ document.getElementById(id).value = ''; });
    loadAll();
  }).catch(function(e){ toast(e.message, true); });
}

function delProduct(id) {
  if (!confirm('确定删除该商品？')) return;
  api('/api/admin/products/' + id, { method: 'DELETE' }).then(function(){ toast('已删除'); loadAll(); }).catch(function(e){ toast(e.message, true); });
}

function toggleProduct(id) {
  var p = state.products.find(function(x){ return x.id === id; });
  if (!p) return;
  api('/api/admin/products/' + id, { method: 'PUT', body: { onSale: !p.onSale } }).then(function(){ toast(p.onSale ? '已下架' : '已上架'); loadAll(); }).catch(function(e){ toast(e.message, true); });
}

function addGroupBuy() {
  var body = {
    productId: document.getElementById('gbProduct').value,
    groupPrice: Number(document.getElementById('gbPrice').value),
    minParticipants: Number(document.getElementById('gbMin').value || 3),
    durationHours: Number(document.getElementById('gbHours').value || 24),
    title: document.getElementById('gbTitle').value.trim()
  };
  if (!(body.groupPrice > 0)) return toast('请填写团购价', true);
  api('/api/admin/groupbuys', { method: 'POST', body: body }).then(function(){
    toast('团购活动已发起'); loadAll();
  }).catch(function(e){ toast(e.message, true); });
}

function cancelGroupBuy(id) {
  if (!confirm('确定取消该团购？')) return;
  api('/api/admin/groupbuys/' + id + '/cancel', { method: 'POST', body: {} }).then(function(){ toast('已取消'); loadAll(); }).catch(function(e){ toast(e.message, true); });
}

function deliverOrder(id) {
  api('/api/admin/orders/' + id + '/deliver', { method: 'POST', body: {} }).then(function(){ toast('已标记发货'); loadAll(); }).catch(function(e){ toast(e.message, true); });
}

function addCoupon() {
  var body = {
    name: document.getElementById('cName').value.trim(),
    threshold: Number(document.getElementById('cThreshold').value || 0),
    amount: Number(document.getElementById('cAmount').value),
    validDays: Number(document.getElementById('cDays').value || 30),
    limitPerMember: Number(document.getElementById('cLimit').value || 1)
  };
  if (!body.name || !(body.amount > 0)) return toast('请填写券名称和优惠金额', true);
  api('/api/admin/coupons', { method: 'POST', body: body }).then(function(){ toast('优惠券已创建'); loadAll(); }).catch(function(e){ toast(e.message, true); });
}

function addForm() {
  var body = {
    title: document.getElementById('fTitle').value.trim(),
    description: document.getElementById('fDesc').value.trim(),
    fields: [
      { label: '总体满意度', type: 'rating', required: true },
      { label: '您最常购买哪类商品？', type: 'radio', options: ['生鲜蔬果','肉禽蛋奶','粮油副食','日用百货'], required: true },
      { label: '其他建议', type: 'textarea', required: false }
    ]
  };
  if (!body.title) return toast('请填写问卷标题', true);
  api('/api/admin/forms', { method: 'POST', body: body }).then(function(){ toast('问卷已创建'); loadAll(); }).catch(function(e){ toast(e.message, true); });
}

function viewFormStats(id) {
  if (!id && state.forms.length) id = state.forms[0].id;
  if (!id) return toast('暂无问卷', true);
  api('/api/admin/forms/' + id + '/stats').then(function(s){
    document.getElementById('formStatsPanel').style.display = 'block';
    var html = '<div style="margin-bottom:12px;color:var(--sub)">共收到 <b style="color:var(--text)">' + s.total + '</b> 份提交</div>';
    s.fields.forEach(function(f){
      html += '<div style="padding:10px 0;border-bottom:1px solid var(--border)"><div style="font-weight:600;margin-bottom:6px">' + esc(f.label) + '</div>';
      if (Object.keys(f.distribution).length) {
        Object.keys(f.distribution).forEach(function(k){
          html += '<div style="font-size:13px;color:var(--sub)">' + esc(k) + '：' + esc(f.distribution[k]) + ' 次</div>';
        });
      } else if (f.average !== null) {
        html += '<div style="font-size:13px;color:var(--sub)">平均分：' + f.average + '</div>';
      } else {
        html += '<div style="font-size:13px;color:var(--sub)">暂无统计数据</div>';
      }
      html += '</div>';
    });
    document.getElementById('formStats').innerHTML = html;
  }).catch(function(e){ toast(e.message, true); });
}

// 登录按钮事件绑定（移除内联 onclick，配合 CSP script-src 'self'）
document.getElementById('loginBtn').addEventListener('click', doLogin);
