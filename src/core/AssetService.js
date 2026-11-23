/** 品牌素材上传：校验文件签名、限制大小、随机文件名并保留租户归属。 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { business } = require('../errors');

const TYPES = {
  'image/png': { ext: 'png', check: b => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'image/jpeg': { ext: 'jpg', check: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', check: b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'image/gif': { ext: 'gif', check: b => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString()) },
  'image/x-icon': { ext: 'ico', check: b => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 }
};

class AssetService {
  constructor(store, config, logger) {
    this.store = store;
    this.config = config || {};
    this.logger = logger;
  }

  async upload(tenantId, actor, input) {
    const mimeType = String(input.mimeType || '').toLowerCase();
    const type = TYPES[mimeType];
    if (!type) throw business('仅支持 PNG、JPEG、WebP、GIF 或 ICO 图片');
    const raw = String(input.data || '').replace(/^data:[^;]+;base64,/, '');
    let buffer;
    try { buffer = Buffer.from(raw, 'base64'); } catch (error) { throw business('图片内容不是有效的 Base64'); }
    if (!buffer.length) throw business('图片内容为空');
    if (buffer.length > (Number(this.config.maxBytes) || 2 * 1024 * 1024)) throw business('图片超过大小限制');
    if (!type.check(buffer)) throw business('图片内容与文件类型不匹配');

    const dir = path.resolve(this.config.dir || './data/uploads', tenantId);
    await fs.promises.mkdir(dir, { recursive: true });
    const id = crypto.randomUUID();
    const name = id + '.' + type.ext;
    const file = path.join(dir, name);
    const handle = await fs.promises.open(file, 'wx', 0o440);
    try {
      await handle.writeFile(buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const url = String(this.config.publicPrefix || '/uploads').replace(/\/$/, '') + '/' +
      encodeURIComponent(tenantId) + '/' + name;
    const asset = {
      id, tenantId, kind: String(input.kind || 'brand').slice(0, 30),
      originalName: String(input.filename || '').slice(0, 120), mimeType, size: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'), url,
      file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
      createdBy: actor && actor.id || '', createdAt: new Date().toISOString()
    };
    await this.store.insert('brandAssets', asset);
    return asset;
  }

  async list(tenantId) {
    return (await this.store.find('brandAssets', item => item.tenantId === tenantId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

module.exports = AssetService;
