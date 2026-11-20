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
  createCategory(tenantId, data) {
    const cat = {
      id: uuidv4(),
      tenantId,
      name: String(data.name || '未命名分类').slice(0, 20),
      sort: Number(data.sort) || 0,
      createdAt: new Date().toISOString()
    };
    this.store.insert('categories', cat);
    return cat;
  }

  listCategories(tenantId) {
    return this.store.find('categories', c => c.tenantId === tenantId)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  }

  // ---------- 商品 ----------
  create(tenantId, data) {
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
    this.store.insert('products', item);
    return item;
  }

  update(id, patch) {
    const item = this.store.findById('products', id);
    if (!item) throw business('商品不存在');
    const allow = ['name', 'description', 'image', 'categoryId', 'unit', 'stock', 'onSale', 'sort'];
    const clean = {};
    for (const k of allow) if (patch[k] !== undefined) clean[k] = patch[k];
    if (patch.stock !== undefined) clean.stock = Math.max(0, Math.floor(Number(patch.stock) || 0));
    if (patch.price !== undefined) clean.price = Math.round(Number(patch.price) * 100);
    if (patch.originalPrice !== undefined) clean.originalPrice = Math.round(Number(patch.originalPrice) * 100);
    return this.store.update('products', id, clean);
  }

  remove(id) {
    return this.store.remove('products', id);
  }

  get(id) {
    return this.store.findById('products', id);
  }

  list(tenantId, opts = {}) {
    let list = this.store.find('products', p => p.tenantId === tenantId);
    if (opts.categoryId) list = list.filter(p => p.categoryId === opts.categoryId);
    if (opts.onSaleOnly) list = list.filter(p => p.onSale);
    if (opts.keyword) {
      const k = opts.keyword.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(k));
    }
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /** 下单时扣减可用库存，库存不足返回false（不影响销量） */
  deductStock(productId, qty) {
    const p = this.get(productId);
    if (!p) throw business('商品不存在');
    if (p.stock < qty) return false;
    // 原子条件扣减：防并发超卖
    return this.store.atomicDec('products', productId, 'stock', qty);
  }

  /** 取消/超时释放库存（不影响销量） */
  restoreStock(productId, qty) {
    const p = this.get(productId);
    if (!p) return;
    this.store.update('products', productId, { stock: p.stock + qty });
  }

  /** 支付成功后累加销量 */
  increaseSales(productId, qty) {
    const p = this.get(productId);
    if (!p) return;
    this.store.update('products', productId, { sales: p.sales + qty });
  }

  /** 退款时回退销量 */
  decreaseSales(productId, qty) {
    const p = this.get(productId);
    if (!p) return;
    this.store.update('products', productId, { sales: Math.max(0, p.sales - qty) });
  }
}

module.exports = ProductManager;

