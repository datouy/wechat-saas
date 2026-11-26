<script setup lang="ts">
import { useAuthStore } from '../store/auth'

const auth = useAuthStore()
</script>

<template>
  <div class="view-stack">
    <section class="view-head glass-card">
      <div><p class="eyebrow">WORKSPACE</p><h2>门店设置</h2><p>当前租户、运行环境与后续安全配置入口。</p></div>
    </section>
    <section class="settings-grid">
      <article class="glass-card panel-card" v-tilt>
        <p class="eyebrow">TENANT</p>
        <h3>{{ auth.tenant?.name }}</h3>
        <dl class="settings-list">
          <div><dt>租户标识</dt><dd>{{ auth.tenant?.code }}</dd></div>
          <div><dt>租户状态</dt><dd><span class="status-pill">{{ auth.tenant?.status }}</span></dd></div>
          <div><dt>当前角色</dt><dd>{{ auth.user?.role }}</dd></div>
        </dl>
      </article>
      <article class="glass-card panel-card" v-tilt>
        <p class="eyebrow">API & SECURITY</p>
        <h3>Java + MySQL 底座</h3>
        <p class="muted-copy">管理端通过 JWT 访问 Spring Boot API；租户身份来自登录令牌，不在前端自行拼接 tenantId。</p>
        <div class="soft-note">OpenAPI：<a href="http://127.0.0.1:8080/swagger-ui.html" target="_blank" rel="noreferrer">/swagger-ui.html</a></div>
      </article>
      <article class="glass-card panel-card" v-tilt>
        <p class="eyebrow">NEXT</p>
        <h3>待接入能力</h3>
        <ul class="plain-list"><li>商品新增/编辑与库存调整</li><li>订单发货、退款与线下收款确认</li><li>微信登录、订阅消息与真实支付</li><li>审计日志与灾备演练</li></ul>
      </article>
    </section>
  </div>
</template>

