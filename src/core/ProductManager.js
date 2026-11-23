/**
 * 商品与分类管理
 * - 分类、商品、库存、上下架
 * - 商品价格（分单位存储避免浮点误差）
 * - 库存分“可用库存 stock”与“销量 sales”：
 *   下单只扣减可用库存，支付成功才累加销量
 */

const { business } = require('../errors');
const { randomUUID: uuidv4 } = require('crypto');

class ProductManager {
  constructor(store) {
    this.store = store;
  }

  // ---------- 分类 ----------
  async createCategory(tenantId, data) {
    const cat = {
      id: uuidv4(),
      tenantId,
      name: String(data.name || '未命名分类').slice(0, 20),
      sort: Number(data.sort) || 0,
      createdAt: new Date().toISOString()
    };
    await this.store.insert('categories', cat);
    return cat;
  }

  async listCategories(tenantId) {
    return (await this.store.find('categories', c => c.tenantId === tenantId))
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  }

  async updateCategory(id, data) {
    const category = await this.store.findById('categories', id);
    if (!category) throw business('分类不存在');
    const patch = {};
    if (data.name !== undefined) patch.name = String(data.name).slice(0, 20);
    if (data.sort !== undefined) patch.sort = Number(data.sort) || 0;
    return this.store.update('categories', id, patch);
  }

  async removeCategory(id) {
    const category = await this.store.findById('categories', id);
    if (!category) throw business('分类不存在');
    const used = await this.store.count('products', p => p.categoryId === id);
    if (used > 0) throw business('该分类下仍有 ' + used + ' 个商品，请先调整商品分类');
    return this.store.remove('categories', id);
  }

  // ---------- 商品 ----------
  async create(tenantId, data) {
    const price = Math.round(Number(data.price) * 100); // 元 -> 分
    if (!(price > 0)) throw business('商品价格必须大于0');
    const item = {
      id: uuidv4(),
      tenantId,
      categoryId: data.categoryId || '',
      name: String(data.name || '').slice(0, 50),
      description: String(data.description || '').slice(0, 500),
      image: String(data.image || ''),
      unit: String(data.unit || '份').slice(0, 10),
      price,
      originalPrice: Math.round(Number(data.originalPrice || data.price) * 100),
      stock: Math.max(0, Number(data.stock) || 0),
      sales: 0,
      onSale: data.onSale !== false,
      createdAt: new Date().toISOString()
    };
    if (!item.name) throw business('商品名称不能为空');
    await this.store.insert('products', item);
    return item;
  }

  async update(id, patch) {
    const item = await this.store.findById('products', id);
    if (!item) throw business('商品不存在');
    const allow = ['name', 'description', 'image', 'categoryId', 'unit', 'stock', 'onSale', 'sort'];
    const clean = {};
    for (const k of allow) if (patch[k] !== undefined) clean[k] = patch[k];
    if (patch.stock !== undefined) clean.stock = Math.max(0, Math.floor(Number(patch.stock) || 0));
    if (patch.price !== undefined) clean.price = Math.round(Number(patch.price) * 100);
    if (patch.originalPrice !== undefined) clean.originalPrice = Math.round(Number(patch.originalPrice) * 100);
    return this.store.update('products', id, clean);
  }

  async remove(id) {
    return this.store.remove('products', id);
  }

  async adjustStock(tenantId, productId, data, actor = {}) {
    const product = await this.get(productId);
    if (!product || product.tenantId !== tenantId) throw business('商品不存在');
    const delta = Math.trunc(Number(data.delta) || 0);
    if (!delta) throw business('库存调整数量不能为 0');
    const reason = String(data.reason || '').trim().slice(0, 100);
    if (!reason) throw business('请填写库存调整原因');
    const before = Math.max(0, Number(product.stock || 0));
    const after = before + delta;
    if (after < 0) throw business('调整后库存不能小于 0');
    return this.store.transaction(async () => {
      await this.store.update('products', productId, { stock: after });
      const record = {
        id: uuidv4(),
        tenantId,
        productId,
        productName: product.name,
        before,
        delta,
        after,
        reason,
        actorId: actor.id || '',
        actorName: actor.name || '',
        createdAt: new Date().toISOString()
      };
      await this.store.insert('inventoryAdjustments', record);
      return record;
    });
  }

  async listInventoryAdjustments(tenantId, productId, limit = 20) {
    return (await this.store.find('inventoryAdjustments', item =>
      item.tenantId === tenantId && (!productId || item.productId === productId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, Math.max(1, Number(limit) || 20)));
  }

  async undoInventoryAdjustment(tenantId, adjustmentId, actor = {}) {
    const record = await this.store.findById('inventoryAdjustments', adjustmentId);
    if (!record || record.tenantId !== tenantId) throw business('库存调整记录不存在');
    if (record.undoneAt || record.reversedAdjustmentId) throw business('该库存调整已经撤销');
    const product = await this.get(record.productId);
    if (!product || product.tenantId !== tenantId) throw business('商品不存在');
    const next = Number(product.stock || 0) - Number(record.delta || 0);
    if (next < 0) throw business('当前库存不足以撤销这次调整');
    return this.store.transaction(async () => {
      await this.store.update('products', product.id, { stock: next });
      await this.store.update('inventoryAdjustments', record.id, { undoneAt: new Date().toISOString(), undoneBy: actor.id || '' });
      const reversal = {
        id: uuidv4(),
        tenantId,
        productId: product.id,
        productName: product.name,
        before: Number(product.stock || 0),
        delta: -Number(record.delta || 0),
        after: next,
        reason: '撤销库存调整：' + record.reason,
        actorId: actor.id || '',
        actorName: actor.name || '',
        reversedAdjustmentId: record.id,
        createdAt: new Date().toISOString()
      };
      await this.store.insert('inventoryAdjustments', reversal);
      return reversal;
    });
  }

  async get(id) {
    return this.store.findById('products', id);
  }

  async list(tenantId, opts = {}) {
    let list = await this.store.find('products', p => p.tenantId === tenantId);
    if (opts.categoryId) list = list.filter(p => p.categoryId === opts.categoryId);
    if (opts.onSaleOnly) list = list.filter(p => p.onSale);
    if (opts.keyword) {
      const k = opts.keyword.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(k));
    }
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /** 下单时扣减可用库存，库存不足返回false（不影响销量） */
  async deductStock(productId, qty) {
    const p = await this.get(productId);
    if (!p) throw business('商品不存在');
    if (p.stock < qty) return false;
    // 原子条件扣减：防并发超卖
    return this.store.atomicDec('products', productId, 'stock', qty);
  }

  /** 取消/超时释放库存（不影响销量） */
  async restoreStock(productId, qty) {
    const p = await this.get(productId);
    if (!p) return;
    await this.store.update('products', productId, { stock: p.stock + qty });
  }

  /** 支付成功后累加销量 */
  async increaseSales(productId, qty) {
    const p = await this.get(productId);
    if (!p) return;
    await this.store.update('products', productId, { sales: p.sales + qty });
  }

  /** 退款时回退销量 */
  async decreaseSales(productId, qty) {
    const p = await this.get(productId);
    if (!p) return;
    await this.store.update('products', productId, { sales: Math.max(0, p.sales - qty) });
  }
}

module.exports = ProductManager;

