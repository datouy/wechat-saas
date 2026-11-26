<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

interface CommandItem {
  label: string
  path: string
  hint: string
}

const router = useRouter()
const open = ref(false)
const query = ref('')
const active = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

const items: CommandItem[] = [
  { label: '今天', path: '/dashboard', hint: '经营总览' },
  { label: '商品', path: '/products', hint: '商品与库存' },
  { label: '订单', path: '/orders', hint: '订单履约' },
  { label: '客户', path: '/members', hint: '会员与积分' },
  { label: '设置', path: '/settings', hint: '门店与安全' },
  { label: '审计', path: '/audit', hint: '操作留痕' },
  { label: '优惠券', path: '/coupons', hint: '满减与领取' },
  { label: '团购', path: '/group-buys', hint: '成团活动' },
  { label: '问卷', path: '/forms', hint: '表单与统计' },
  { label: '预约', path: '/appointments', hint: '服务与时段' },
  { label: '微信能力', path: '/wechat', hint: '登录支付订阅' },
  { label: '退出登录', path: '/login', hint: '会话' }
]

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return items
  return items.filter(item => item.label.toLowerCase().includes(keyword) || item.hint.toLowerCase().includes(keyword))
})

function show() {
  open.value = true
  query.value = ''
  active.value = 0
  nextTick(() => inputRef.value?.focus())
}

function hide() {
  open.value = false
}

function navigate(item?: CommandItem) {
  const target = item || filtered.value[active.value]
  if (!target) return
  hide()
  if (target.path === '/login') {
    localStorage.clear()
  }
  router.push(target.path)
}

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    open.value ? hide() : show()
    return
  }
  if (!open.value) return
  if (event.key === 'Escape') hide()
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    active.value = Math.min(active.value + 1, filtered.value.length - 1)
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    active.value = Math.max(active.value - 1, 0)
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    navigate()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

defineExpose({ open: show })
</script>

<template>
  <Teleport to="body">
    <Transition name="palette">
      <div v-if="open" class="command-layer" @click.self="hide">
        <div class="command-panel">
          <input ref="inputRef" v-model="query" placeholder="搜索页面或命令…" aria-label="命令搜索" />
          <div class="command-list">
            <button
              v-for="(item, index) in filtered"
              :key="item.path"
              type="button"
              class="command-item"
              :class="{ active: index === active }"
              @mouseenter="active = index"
              @click="navigate(item)"
            >
              <span>{{ item.label }}</span>
              <small>{{ item.hint }}</small>
            </button>
            <p v-if="filtered.length === 0" class="command-empty">没有匹配结果</p>
          </div>
          <footer class="command-foot"><span>↑↓ 选择</span><span>Enter 跳转</span><span>Esc 关闭</span></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

