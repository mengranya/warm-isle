# 暖屿 · Cloudflare Workers 部署

当前项目使用 **Cloudflare Workers + Static Assets**，不是 Docker，也不需要 Postgres。

结构：

```text
worker.js                     Worker 入口：/api/* 与静态资源分流
functions/api/[[path]].js     /api/health、/api/check、/api/chat
public/                       静态页面、PWA、图标
wrangler.toml                 main + assets 配置
```

## 必须使用 HTTPS

API Key 使用浏览器 WebCrypto 加密保存。`crypto.subtle` 只在安全上下文（`https://` 或 localhost）提供。

如果手机打开的是：

```text
http://nuanyunb.top
http://192.168.x.x:4173
```

会提示“当前环境不支持 WebCrypto”，并且无法记住 API Key。

处理：

1. 确认地址栏是 `https://`
2. 自定义域名激活后，在 Cloudflare 开启：
   `SSL/TLS → Edge Certificates → Always Use HTTPS`
3. 如果暂时只能使用 HTTP，不要输入 API Key；先换回 HTTPS 地址

## 为什么之前报错

如果日志出现：

```text
Executing user deploy command: npx wrangler deploy
Could not detect a directory containing static files
```

说明当前是 **Workers Builds**，但 `wrangler.toml` 没有声明静态资源目录。

项目现在已加入：

```toml
name = "warm-isle"
main = "worker.js"
compatibility_date = "2025-01-01"

[assets]
directory = "./public"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

再次部署即可。

## 1. 确认项目类型

进入：

```text
Cloudflare Dashboard → Workers & Pages
```

当前项目应该是 **Worker**，不是 Pages。

直达：

```text
https://dash.cloudflare.com/?to=/:account/workers-and-pages
```

## 2. 上传代码

仓库根目录需要包含：

```text
worker.js
wrangler.toml
functions/
public/
package.json
server.mjs
```

不要上传：

```text
插件/
人格/
模版/
tests/
screenshots/
.env
```

## 3. 构建配置

Workers Builds 中：

```text
Root directory: /
Build command: 留空
Deploy command: npx wrangler deploy
```

`npx wrangler deploy` 会读取 `wrangler.toml`，自动：

- 打包 `worker.js`
- 识别 `public/` 为静态资源
- 上传 `functions/api/[[path]].js`

如果部署命令无法修改，重新连接仓库创建一个新的 Worker 项目即可。

## 4. 环境变量

推荐不要设置服务端模型 Key，让用户在手机设置里填写。

如果需要服务端 Key：

```text
DEEPSEEK_API_KEY=sk-xxxx
```

公开部署时请配合 Cloudflare Access，避免他人消耗额度。

## 5. 部署后检查

打开：

```text
https://你的项目.workers.dev/api/health
```

应返回：

```json
{"ok":true,"service":"warm-isle"}
```

静态页面：

```text
https://你的项目.workers.dev/
```

## 6. 手机安装

### Android Chrome

菜单 → **安装应用 / 添加到主屏幕**

### iPhone Safari

分享 → **添加到主屏幕**

Workers 默认提供 HTTPS，PWA 可安装。

## 7. 数据

- 存档保存在手机浏览器 IndexedDB
- Cloudflare 不保存对话
- 不需要数据库
- 更换域名前先导出备份

## 8. 常见问题

### 仍然报 static files 错误

确认 `wrangler.toml` 在仓库根目录，并且包含：

```toml
[assets]
directory = "./public"
```

不要把它写成：

```text
[assets]
directory = "public/public"
```

### `/api/health` 404

检查：

- `worker.js` 是否存在
- `functions/api/[[path]].js` 是否存在
- `wrangler.toml` 是否设置 `main = "worker.js"`
- 是否重新部署

### 页面 503 “Static assets binding is not configured”

说明 Worker 没有绑定 `ASSETS`。检查 `wrangler.toml` 的 `[assets]` 配置。

### PWA 安装不了

- 必须 HTTPS
- 不要用无痕模式
- 微信内置浏览器通常不能安装
- 检查 `/sw.js` 和 `/manifest.webmanifest`
