FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# 仅复制依赖清单，利用缓存
COPY package*.json .npmrc ./
RUN npm ci --omit=dev --registry=https://registry.npmjs.org

# 复制源码
COPY . .

# 运行期数据目录（生产建议挂载持久卷）
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3100/healthz',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "src/index.js"]
