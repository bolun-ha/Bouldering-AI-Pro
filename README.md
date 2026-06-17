<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/69894fb5-9fc1-4359-ad7c-d57227610276

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

---

## 🚀 生产环境部署检查清单

> 本清单记录了部署过程中实际踩过的坑，每次上线前逐条核对。

### □ SSH 连通性检查
```
ssh root@<服务器IP>
```
- 如果被 EDR 拦截（`Permission denied (publickey)`），不要尝试密码或 paramiko
- **方案**：让有权限的人把你的公钥加入 `~/.ssh/authorized_keys`，然后用 SSH 执行所有操作

### □ Nginx 配置（最重要！）
**不要依赖 Node.js 后端 serve 静态文件**，用 Nginx 直接在 `/` 和 `/assets/` 位置 serve build 产物：
```nginx
location /assets/ {
    alias /var/www/xxx/dist/assets/;
    expires 30d;
    add_header Cache-Control "public, immutable";
}
location / {
    root /var/www/xxx/dist;
    index index.html;
    try_files $uri $uri/ /index.html;
}
location /api/ {
    proxy_pass http://127.0.0.1:3003;
    proxy_set_header Host localhost;
    proxy_http_version 1.1;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```
- `proxy_set_header Host` 必须写 `localhost`，避免 Vite middleware 的 allowedHosts 检查拦截

### □ PM2 启动
```bash
sudo PM2_HOME=/root/.pm2 pm2 start /var/www/xxx/dist/server.cjs --name <app-name> --time
```

### □ 构建后检查
```
cat dist/index.html | grep 'src='
curl -s https://你的域名/api/health
```

### □ 资源文件（模型等）
```bash
ls -la dist/*.task    # pose_landmarker_lite.task, hand_landmarker.task
```

### □ 浏览器强制刷新
- 部署后必须 **`Cmd+Shift+R`（Mac）/ `Ctrl+F5`（Windows）** 强制刷新

### □ 源码提交前检查
- `ref={xxx}` 和 `const xxx = useRef(...)` 是否匹配
- index.html 入口是引用 hash 还是 `src/main.tsx`（决定了 Vite 构建模块数）

### □ 常见坑速查
| 现象 | 原因 | 解决 |
|------|------|------|
| `Blocked request. This host is not allowed` | Vite middleware 模式，`Host` 透传 | Nginx `proxy_set_header Host localhost` |
| `canvasRef is not defined` | JSX `ref={xxx}` 变量名与 useRef 声明不一致 | 修复源码中的变量名 |
| `Unable to open zip archive` | 模型文件 `.task` 未复制到 `dist/` | 手动复制 `public/*.task` 到 `dist/` |
| `ERR_MODULE_NOT_FOUND` | `dist/` 目录缺失 | 重建或从备份恢复 |
