<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import type { InventoryAdjustmentRow, ProductRow } from '../types'

const products = ref<ProductRow[]>([])
const keyword = ref('')
const filter = ref<'all' | 'on_sale' | 'low_stock'>('all')
const loading = ref(true)
const error = ref('')
const filterPulse = ref(false)

const productDialog = ref(false)
const editingId = ref<number | null>(null)
const productForm = reactive({
  name: '',
  description: '',
  priceYuan: 0,
  originalPriceYuan: 0,
  stock: 0,
  onSale: true
})

const stockDialog = ref(false)
const stockTarget = ref<ProductRow | null>(null)
const stockForm = reactive({ delta: 1, reason: '' })

const historyDialog = ref(false)
const historyTarget = ref<ProductRow | null>(null)
const historyRows = ref<InventoryAdjustmentRow[]>([])

const filtered = computed(() => {
  const keywordValue = keyword.value.trim().toLowerCase()
  return products.value.filter(product => {
    if (keywordValue && !product.name.toLowerCase().includes(keywordValue)) return false
    if (filter.value === 'on_sale' && !product.onSale) return false
    if (filter.value === 'low_stock' && product.stock > 10) return false
    return true
  })
})

const counts = computed(() => ({
  all: products.value.length,
  on_sale: products.value.filter(item => item.onSale).length,
  low_stock: products.value.filter(item => item.stock <= 10).length
}))

function setFilter(value: 'all' | 'on_sale' | 'low_stock') {
  filter.value = value
  filterPulse.value = false
  requestAnimationFrame(() => { filterPulse.value = true })
  setTimeout(() => { filterPulse.value = false }, 420)
}

function money(cents: number) {
  return '¥' + (cents / 100).toFixed(2)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await api.products({ page: 1, size: 100 })
    products.value = result.content
  } catch (err) {
    error.value = err instanceof Error ? err.message : '商品加载失败'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  productForm.name = ''
  productForm.description = ''
  productForm.priceYuan = 0
  productForm.originalPriceYuan = 0
  productForm.stock = 0
  productForm.onSale = true
  productDialog.value = true
}

function openEdit(product: ProductRow) {
  editingId.value = product.id
  productForm.name = product.name
  productForm.description = product.description || ''
  productForm.priceYuan = product.priceCent / 100
  productForm.originalPriceYuan = product.originalPriceCent / 100
  productForm.stock = product.stock
  productForm.onSale = product.onSale
  productDialog.value = true
}

async function saveProduct() {
  if (!productForm.name.trim() || productForm.priceYuan <= 0) {
    ElMessage.warning('请填写商品名称和有效价格')
    return
  }
  const payload = {
    name: productForm.name.trim(),
    description: productForm.description,
    priceCent: Math.round(productForm.priceYuan * 100),
    originalPriceCent: Math.round((productForm.originalPriceYuan || productForm.priceYuan) * 100),
    onSale: productForm.onSale
  }
  try {
    if (editingId.value) {
      await api.updateProduct(editingId.value, payload)
      ElMessage.success('商品已更新')
    } else {
      await api.createProduct({ ...payload, stock: productForm.stock })
      ElMessage.success('商品已创建')
    }
    productDialog.value = false
    await load()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败')
  }
}

async function offShelf(product: ProductRow) {
  try {
    await ElMessageBox.confirm('下架后商品仍保留历史订单数据，是否继续？', '下架商品', { type: 'warning' })
    await api.offShelfProduct(product.id)
    ElMessage.success('商品已下架')
    await load()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

function openStock(product: ProductRow) {
  stockTarget.value = product
  stockForm.delta = 1
  stockForm.reason = ''
  stockDialog.value = true
}

async function saveStock() {
  if (!stockTarget.value || !stockForm.reason.trim() || stockForm.delta === 0) {
    ElMessage.warning('请填写调整数量和原因')
    return
  }
  try {
    await api.adjustStock(stockTarget.value.id, { delta: stockForm.delta, reason: stockForm.reason })
    ElMessage.success('库存已调整')
    stockDialog.value = false
    await load()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '库存调整失败')
  }
}

async function openHistory(product: ProductRow) {
  historyTarget.value = product
  historyRows.value = await api.adjustments(product.id)
  historyDialog.value = true
}

async function undoAdjustment(row: InventoryAdjustmentRow) {
  try {
    await ElMessageBox.confirm('撤销后将反向调整库存，是否继续？', '撤销库存调整', { type: 'warning' })
    await api.undoAdjustment(row.id)
    ElMessage.success('库存调整已撤销')
    if (historyTarget.value) historyRows.value = await api.adjustments(historyTarget.value.id)
    await load()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err instanceof Error ? err.message : '撤销失败')
  }
}

function time(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : ''
}

onMounted(load)
</script>

<template>
  <div class="view-stack">
    <section class="view-head glass-card">
      <div><p class="eyebrow">CATALOG</p><h2>商品与库存</h2><p>把社区好物放在一张会呼吸的玻璃货架上。</p></div>
      <div class="search-row">
        <input v-model="keyword" class="glass-input" placeholder="搜索商品名称" />
        <button type="button" class="button primary" @click="openCreate">新增商品</button>
      </div>
    </section>

    <div class="filter-capsules" :class="{ pulse: filterPulse }">
      <button type="button" :class="{ active: filter === 'all' }" @click="setFilter('all')">全部 <span>{{ counts.all }}</span></button>
      <button type="button" :class="{ active: filter === 'on_sale' }" @click="setFilter('on_sale')">在售 <span>{{ counts.on_sale }}</span></button>
      <button type="button" :class="{ active: filter === 'low_stock' }" @click="setFilter('low_stock')">低库存 <span>{{ counts.low_stock }}</span></button>
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>
    <el-skeleton v-if="loading" :rows="5" animated />
    <div v-else-if="filtered.length === 0" class="empty-glass glass-card">没有匹配的商品</div>
    <section v-else class="product-grid">
      <article v-for="product in filtered" :key="product.id" class="product-card glass-card" v-tilt>
        <div class="product-visual">{{ product.name.slice(0, 1) }}</div>
        <div class="product-copy">
          <div class="product-title-row"><h3>{{ product.name }}</h3><span class="status-pill" :class="{ off: !product.onSale }">{{ product.onSale ? '在售' : '下架' }}</span></div>
          <p>{{ product.description || '社区精选商品' }}</p>
          <div class="product-meta"><strong>{{ money(product.priceCent) }}</strong><span>库存 {{ product.stock }}</span><span>销量 {{ product.sales }}</span></div>
          <div class="card-actions">
            <button type="button" class="text-link" @click="openEdit(product)">编辑</button>
            <button type="button" class="text-link" @click="openStock(product)">调库存</button>
            <button type="button" class="text-link" @click="openHistory(product)">记录</button>
            <button type="button" class="text-link danger" @click="offShelf(product)">下架</button>
          </div>
        </div>
      </article>
    </section>

    <el-dialog v-model="productDialog" :title="editingId ? '编辑商品' : '新增商品'" width="520px">
      <el-form label-position="top">
        <el-form-item label="商品名称"><el-input v-model="productForm.name" maxlength="80" /></el-form-item>
        <el-form-item label="商品描述"><el-input v-model="productForm.description" type="textarea" :rows="3" maxlength="500" /></el-form-item>
        <div class="dialog-grid">
          <el-form-item label="售价（元）"><el-input-number v-model="productForm.priceYuan" :min="0.01" :precision="2" :step="1" /></el-form-item>
          <el-form-item label="原价（元）"><el-input-number v-model="productForm.originalPriceYuan" :min="0.01" :precision="2" :step="1" /></el-form-item>
        </div>
        <el-form-item v-if="!editingId" label="初始库存"><el-input-number v-model="productForm.stock" :min="0" :step="1" /></el-form-item>
        <el-form-item label="上架状态"><el-switch v-model="productForm.onSale" active-text="在售" inactive-text="下架" /></el-form-item>
      </el-form>
      <template #footer><button class="button" type="button" @click="productDialog = false">取消</button><button class="button primary" type="button" @click="saveProduct">保存</button></template>
    </el-dialog>

    <el-dialog v-model="stockDialog" title="库存调整" width="440px">
      <p class="dialog-hint">{{ stockTarget?.name }} · 当前库存 {{ stockTarget?.stock }}</p>
      <el-form label-position="top">
        <el-form-item label="调整数量（正数补货，负数扣减）"><el-input-number v-model="stockForm.delta" :step="1" /></el-form-item>
        <el-form-item label="调整原因"><el-input v-model="stockForm.reason" maxlength="200" placeholder="例如：社区补货 / 盘点差异" /></el-form-item>
      </el-form>
      <template #footer><button class="button" type="button" @click="stockDialog = false">取消</button><button class="button primary" type="button" @click="saveStock">确认调整</button></template>
    </el-dialog>

    <el-dialog v-model="historyDialog" title="库存调整记录" width="680px">
      <el-table :data="historyRows" class="glass-table" empty-text="暂无库存调整">
        <el-table-column label="时间" width="150"><template #default="{ row }">{{ time(row.createdAt) }}</template></el-table-column>
        <el-table-column prop="reason" label="原因" min-width="170" />
        <el-table-column label="变化" width="120"><template #default="{ row }">{{ row.beforeStock }} → {{ row.afterStock }}（{{ row.delta > 0 ? '+' : '' }}{{ row.delta }}）</template></el-table-column>
        <el-table-column prop="actorName" label="操作人" width="100" />
        <el-table-column label="操作" width="90"><template #default="{ row }"><button v-if="!row.undoneAt" type="button" class="text-link" @click="undoAdjustment(row)">撤销</button><span v-else class="muted">已撤销</span></template></el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<style scoped>
.card-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.35); }
.card-actions .danger { color: #9f3f32; }
.dialog-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.dialog-hint { margin: 0 0 14px; color: var(--muted); font-size: 12px; }
.muted { color: var(--muted); font-size: 10px; }
</style>

