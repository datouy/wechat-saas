/**
 * 表单问卷工具
 * - 表单模板（单行/多行/单选/多选/评分）
 * - 会员提交问卷
 * - 统计结果（各选项分布）
 */
const { randomUUID: uuidv4 } = require('crypto');
const { business } = require('../errors');

class FormManager {
  constructor(store) { this.store = store; }

  async create(tenantId, data) {
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
    await this.store.insert('forms', form);
    return form;
  }

  async list(tenantId) {
    return (await this.store.find('forms', f => f.tenantId === tenantId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async get(id) { return this.store.findById('forms', id); }

  async update(id, data) {
    const form = await this.get(id);
    if (!form) throw business('表单不存在');
    const patch = {};
    if (data.title !== undefined) patch.title = String(data.title).slice(0, 50);
    if (data.description !== undefined) patch.description = String(data.description).slice(0, 300);
    if (data.status !== undefined) patch.status = data.status === 'closed' ? 'closed' : 'open';
    if (data.fields !== undefined) {
      patch.fields = data.fields.map((field, index) => ({
        id: (form.fields[index] && form.fields[index].id) || 'f' + (index + 1),
        label: String(field.label || '').slice(0, 50),
        type: ['text', 'textarea', 'radio', 'checkbox', 'rating', 'number'].includes(field.type) ? field.type : 'text',
        options: Array.isArray(field.options) ? field.options.slice(0, 20) : [],
        required: !!field.required
      }));
    }
    return this.store.update('forms', id, patch);
  }

  /** 提交表单 */
  async submit(formId, memberId, answers) {
    return this.store.transaction(async () => {
    await this.store.lock('form-submit:' + formId + ':' + memberId);
    const form = await this.get(formId);
    if (!form) throw business('表单不存在');
    if (form.status !== 'open') throw business('表单已关闭');
    if ((await this.store.find('formSubmissions', s => s.formId === formId && s.memberId === memberId)).length > 0) {
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
    await this.store.insert('formSubmissions', submission);
    return submission;
    });
  }

  /** 表单统计 */
  async stats(formId) {
    const form = await this.get(formId);
    if (!form) throw business('表单不存在');
    const subs = await this.store.find('formSubmissions', s => s.formId === formId);
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
