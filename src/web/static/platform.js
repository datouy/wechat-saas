(function () {
  'use strict';

  var state = { token: localStorage.getItem('platformToken') || '', operator: '', tenants: [], plans: [], invoices: [] };
  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };
  var money = function (cents) { return '¥' + (Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); };
  var esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  };
  var shortDate = function (value) {
    if (!value) return '—';
    var date = new Date(value);
    return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  };
  var statusLabel = { active: '经营中', trialing: '试用中', suspended: '已暂停', closed: '已关闭' };
  var invoiceLabel = { issued: '待支付', paid: '已支付', void: '已作废' };

  function toast(message, error) {
    var node = $('#toast');
    node.textContent = message;
    node.className = 'toast show' + (error ? ' error' : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { node.className = 'toast'; }, 3200);
  }

  async function request(path, options) {
    var init = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {});
    init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {});
    if (state.token) init.headers.Authorization = 'Bearer ' + state.token;
    var response = await fetch(path, init);
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok || data.success === false) {
      if (response.status === 401 && path !== '/api/platform/login') showLogin();
      var error = new Error(data.error || '请求失败');
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data.data;
  }

  function showLogin() {
    $('#loginLayer').classList.remove('hidden');
    $('#operatorName').textContent = '待登录';
  }

  function hideLogin() {
    $('#loginLayer').classList.add('hidden');
    $('#operatorName').textContent = state.operator || '平台运营';
  }

  function fillPlanOptions() {
    var select = $('#planSelect');
    select.innerHTML = state.plans.map(function (plan) {
      return '<option value="' + esc(plan.code) + '">' + esc(plan.name) + ' · ' + money(plan.monthlyPrice) + '/月</option>';
    }).join('');
  }

  function renderSummary() {
    var active = state.tenants.filter(function (item) { return item.status === 'active'; });
    var trials = state.tenants.filter(function (item) { return item.status === 'trialing'; });
    var risks = state.tenants.filter(function (item) { return item.status === 'suspended' || item.status === 'closed'; });
    var total = active.concat(trials).reduce(function (sum, item) { return sum + Number(item.plan && item.plan.monthlyPrice || 0); }, 0);
    $('#activeTenants').textContent = active.length;
    $('#trialTenants').textContent = trials.length;
    $('#monthlyValue').textContent = money(total);
    $('#riskTenants').textContent = risks.length;
    $('#boardTime').textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  function usageBar(label, used, limit) {
    var percent = limit == null ? 0 : Math.min(100, Math.round(Number(used || 0) / Math.max(1, Number(limit)) * 100));
    return '<span>' + esc(label) + ' ' + Number(used || 0) + '/' + (limit == null ? '∞' : Number(limit)) + '<i><b style="width:' + percent + '%"></b></i></span>';
  }

  function renderTenants() {
    var query = $('#tenantSearch').value.trim().toLowerCase();
    var rows = state.tenants.filter(function (tenant) {
      if (!query) return true;
      return [tenant.name, tenant.slug, tenant.status, tenant.plan && tenant.plan.name].join(' ').toLowerCase().indexOf(query) >= 0;
    });
    if (!rows.length) {
      $('#tenantRows').innerHTML = '<tr><td colspan="6" class="empty-cell">没有匹配的门店</td></tr>';
      return;
    }
    $('#tenantRows').innerHTML = rows.map(function (tenant) {
      var limits = tenant.plan && tenant.plan.limits || {};
      var planOptions = state.plans.map(function (plan) {
        return '<option value="' + esc(plan.code) + '"' + (tenant.plan && tenant.plan.code === plan.code ? ' selected' : '') + '>' + esc(plan.name) + '</option>';
      }).join('');
      var toggle = tenant.status === 'suspended'
        ? '<button class="mini-button" data-action="resume" data-id="' + esc(tenant.id) + '">恢复</button>'
        : '<button class="mini-button danger" data-action="suspend" data-id="' + esc(tenant.id) + '">暂停</button>';
      return '<tr>' +
        '<td class="tenant-name"><strong>' + esc(tenant.name) + '</strong><small>' + esc(tenant.id) + ' · ' + shortDate(tenant.createdAt) + '</small></td>' +
        '<td><span class="status-pill ' + esc(tenant.status) + '">' + esc(statusLabel[tenant.status] || tenant.status) + '</span></td>' +
        '<td><select class="mini-select" data-action="plan" data-id="' + esc(tenant.id) + '">' + planOptions + '</select></td>' +
        '<td><div class="usage-bars">' + usageBar('员工', tenant.usage.admins, limits.admins) + usageBar('会员', tenant.usage.members, limits.members) + usageBar('门店', tenant.usage.locations, limits.locations) + '</div></td>' +
        '<td class="usage-cell">' + (tenant.trialEndsAt ? '试用至 ' + shortDate(tenant.trialEndsAt) : '正式订阅') + '<small>' + shortDate(tenant.updatedAt || tenant.createdAt) + ' 更新</small></td>' +
        '<td><div class="row-actions">' + toggle + '<button class="mini-button" data-action="invoice" data-id="' + esc(tenant.id) + '">开账单</button></div></td>' +
        '</tr>';
    }).join('');
  }

  function renderPlans() {
    $('#planGrid').innerHTML = state.plans.map(function (plan, index) {
      return '<article class="plan-card">' +
        '<p class="eyebrow">' + (index === 1 ? 'RECOMMENDED' : 'PLAN ' + String(index + 1).padStart(2, '0')) + '</p>' +
        '<h3>' + esc(plan.name) + '</h3><div class="plan-price">' + money(plan.monthlyPrice) + '<small> / 月</small></div>' +
        '<ul>' +
        '<li><span>员工账号</span><strong>' + (plan.limits.admins || '不限') + '</strong></li>' +
        '<li><span>会员上限</span><strong>' + (plan.limits.members == null ? '不限' : plan.limits.members) + '</strong></li>' +
        '<li><span>履约门店</span><strong>' + (plan.limits.locations || '不限') + '</strong></li>' +
        '<li><span>核心能力</span><strong>' + esc((plan.features || []).join(' · ')) + '</strong></li>' +
        '</ul></article>';
    }).join('') || '<p class="empty-cell">暂无套餐</p>';
  }

  function renderInvoices() {
    if (!state.invoices.length) {
      $('#invoiceRows').innerHTML = '<tr><td colspan="6" class="empty-cell">暂无账单</td></tr>';
      return;
    }
    $('#invoiceRows').innerHTML = state.invoices.slice(0, 30).map(function (invoice) {
      var tenant = state.tenants.find(function (item) { return item.id === invoice.tenantId; });
      var actions = invoice.status === 'issued'
        ? '<button class="mini-button" data-invoice-action="paid" data-id="' + esc(invoice.id) + '">标记已支付</button> <button class="mini-button danger" data-invoice-action="void" data-id="' + esc(invoice.id) + '">作废</button>'
        : '<span class="status-pill">' + esc(invoiceLabel[invoice.status] || invoice.status) + '</span>';
      return '<tr><td><div class="tenant-name"><strong>' + esc(tenant ? tenant.name : invoice.tenantId) + '</strong><small>' + esc(invoice.id.slice(0, 8)) + '</small></div></td>' +
        '<td>' + esc(invoice.planCode) + '</td><td>' + money(invoice.amount) + '</td>' +
        '<td>' + shortDate(invoice.periodStart) + ' — ' + shortDate(invoice.periodEnd) + '</td>' +
        '<td><span class="status-pill ' + (invoice.status === 'paid' ? 'active' : '') + '">' + esc(invoiceLabel[invoice.status] || invoice.status) + '</span></td><td>' + actions + '</td></tr>';
    }).join('');
  }

  async function loadAll() {
    var results = await Promise.all([
      request('/api/platform/session'),
      request('/api/platform/plans'),
      request('/api/platform/tenants?pageSize=100'),
      request('/api/platform/invoices?pageSize=100')
    ]);
    state.operator = results[0].username;
    state.plans = results[1];
    state.tenants = results[2].list || [];
    state.invoices = results[3].list || [];
    fillPlanOptions();
    renderSummary();
    renderTenants();
    renderPlans();
    renderInvoices();
    hideLogin();
  }

  async function login(event) {
    event.preventDefault();
    var form = new FormData(event.currentTarget);
    $('#loginMessage').textContent = '';
    var button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      var result = await request('/api/platform/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) });
      state.token = result.token;
      localStorage.setItem('platformToken', state.token);
      await loadAll();
    } catch (error) {
      $('#loginMessage').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function createTenant(event) {
    event.preventDefault();
    var form = new FormData(event.currentTarget);
    var payload = {
      name: form.get('name'), slug: form.get('slug') || undefined,
      ownerUsername: form.get('ownerUsername'), ownerPassword: form.get('ownerPassword'),
      contactPhone: form.get('contactPhone') || '', planCode: form.get('planCode'),
      trial: form.get('trial') === 'on'
    };
    var button = event.currentTarget.querySelector('button[type="submit"]');
    $('#createMessage').textContent = '';
    button.disabled = true;
    try {
      var result = await request('/api/platform/tenants', { method: 'POST', body: JSON.stringify(payload) });
      event.currentTarget.reset();
      toast('门店「' + result.tenant.name + '」已开通');
      await loadAll();
      location.hash = 'tenants';
    } catch (error) {
      $('#createMessage').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function updateStatus(id, action) {
    try {
      await request('/api/platform/tenants/' + encodeURIComponent(id), {
        method: 'PATCH', body: JSON.stringify({ status: action === 'suspend' ? 'suspended' : 'active' })
      });
      toast(action === 'suspend' ? '门店已暂停' : '门店已恢复');
      await loadAll();
    } catch (error) { toast(error.message, true); }
  }

  async function changePlan(id, planCode) {
    try {
      await request('/api/platform/tenants/' + encodeURIComponent(id) + '/plan', {
        method: 'POST', body: JSON.stringify({ planCode: planCode })
      });
      toast('套餐已更新');
      await loadAll();
    } catch (error) { toast(error.message, true); }
  }

  async function createInvoice(id) {
    try {
      await request('/api/platform/tenants/' + encodeURIComponent(id) + '/invoices', { method: 'POST', body: '{}' });
      toast('账单已生成');
      await loadAll();
    } catch (error) { toast(error.message, true); }
  }

  async function updateInvoice(id, status) {
    try {
      await request('/api/platform/invoices/' + encodeURIComponent(id), {
        method: 'PATCH', body: JSON.stringify({ status: status, note: '平台运营台操作' })
      });
      toast(status === 'paid' ? '账单已确认收款' : '账单已作废');
      await loadAll();
    } catch (error) { toast(error.message, true); }
  }

  function bind() {
    $('#loginForm').addEventListener('submit', login);
    $('#createTenantForm').addEventListener('submit', createTenant);
    $('#refreshButton').addEventListener('click', function () { loadAll().then(function () { toast('运营数据已刷新'); }).catch(function (error) { toast(error.message, true); }); });
    $('#tenantSearch').addEventListener('input', renderTenants);
    $('#logoutButton').addEventListener('click', function () {
      state.token = '';
      localStorage.removeItem('platformToken');
      showLogin();
    });
    $('#newInvoiceButton').addEventListener('click', function () {
      var tenant = state.tenants.find(function (item) { return item.status === 'active' || item.status === 'trialing'; });
      if (!tenant) return toast('没有可开账单的门店', true);
      createInvoice(tenant.id);
    });
    document.addEventListener('click', function (event) {
      var button = event.target.closest('[data-action]');
      if (button && button.tagName !== 'SELECT') {
        if (button.dataset.action === 'suspend' || button.dataset.action === 'resume') updateStatus(button.dataset.id, button.dataset.action);
        if (button.dataset.action === 'invoice') createInvoice(button.dataset.id);
      }
      var invoiceButton = event.target.closest('[data-invoice-action]');
      if (invoiceButton) updateInvoice(invoiceButton.dataset.id, invoiceButton.dataset.invoiceAction);
    });
    document.addEventListener('change', function (event) {
      var select = event.target.closest('select[data-action="plan"]');
      if (select) changePlan(select.dataset.id, select.value);
    });
  }

  async function start() {
    bind();
    if (!state.token) return showLogin();
    try { await loadAll(); }
    catch (error) {
      if (error.status !== 401) toast(error.message, true);
      showLogin();
    }
  }

  start();
})();
