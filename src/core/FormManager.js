/**
 * 表单问卷工具
 * - 表单模板（单行/多行/单选/多选/评分）
 * - 会员提交问卷
 * - 统计结果（各选项分布）
 */
const { randomUUID: uuidv4 } = require('crypto');

class FormManager {
  constructor(store) { this.store = store; }

  create(tenantId, data) {
    const form = {
      id: uuidv4(),
      tenantId,
      title: String(data.title || '未命名表单').slice(0, 50),
      description: String(data.description || '').slice(0, 300),
      fields: (data.fields || []).map((f, i) => ({
        id: 'f' + (i + 1),
        label: String(f.label || '').slice(0, 50),
        type: ['text', 'textarea', 'radio', 'checkbox', 'rating', 'number'].includes(f.type) ? f.type : 'text',
        options: Array.isArray(f.options) ? f.options.slice(0, 20) : [],
        required: !!f.required
      })),
      status: data.status === 'closed' ? 'closed' : 'open',
      createdAt: new Date().toISOString()
    };
    if (!form.title) throw business('表单标题不能为空');
    this.store.insert('forms', form);
    return form;
  }

  list(tenantId) {
    return this.store.find('forms', f => f.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  get(id) { return this.store.findById('forms', id); }

  /** 提交表单 */
  submit(formId, memberId, answers) {
    const form = this.get(formId);
    if (!form) throw business('表单不存在');
    if (form.status !== 'open') throw business('表单已关闭');
    if (this.store.find('formSubmissions', s => s.formId === formId && s.memberId === memberId).length > 0) {
      throw business('您已提交过该表单');
    }
    // 必填校验
    const valueMap = {};
    for (const f of form.fields) {
      const v = answers ? answers[f.id] : undefined;
      valueMap[f.id] = v;
      if (f.required && (v === undefined || v === '' || (Array.isArray(v) && v.length === 0))) {
        throw business('必填项未填写: ' + f.label);
      }
    }
    const submission = {
      id: uuidv4(),
      tenantId: form.tenantId,
      formId,
      memberId,
      answers: valueMap,
      createdAt: new Date().toISOString()
    };
    this.store.insert('formSubmissions', submission);
    return submission;
  }

  /** 表单统计 */
  stats(formId) {
    const form = this.get(formId);
    if (!form) throw business('表单不存在');
    const subs = this.store.find('formSubmissions', s => s.formId === formId);
    const result = { formId, title: form.title, total: subs.length, fields: [] };
    for (const f of form.fields) {
      const dist = {};
      let sum = 0, cnt = 0;
      for (const s of subs) {
        const v = s.answers[f.id];
        if (v === undefined || v === '') continue;
        if (f.type === 'radio') dist[v] = (dist[v] || 0) + 1;
        if (f.type === 'checkbox' && Array.isArray(v)) v.forEach(x => (dist[x] = (dist[x] || 0) + 1));
        if (f.type === 'rating' || f.type === 'number') {
          const n = Number(v);
          if (!isNaN(n)) { sum += n; cnt++; }
        }
      }
      result.fields.push({
        id: f.id,
        label: f.label,
        type: f.type,
        distribution: dist,
        average: cnt > 0 ? Math.round((sum / cnt) * 10) / 10 : null,
        answered: subs.filter(s => s.answers[f.id] !== undefined && s.answers[f.id] !== '').length
      });
    }
    return result;
  }
}

module.exports = FormManager;
