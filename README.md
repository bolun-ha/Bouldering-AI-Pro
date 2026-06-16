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

### □ 1. SSH 连通性检查
```
ssh root@<服务器IP>
```
- 如果被 EDR 拦截（`Permission denied (publickey)`），不要尝试密码或 paramiko
- **方案**：让有权限的人把你的公钥加入 `~/.ssh/authorized_keys`，然后用 SSH 执行所有操作

### □ 2. Nginx 配置（最重要！）
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
    proxy_set_header Host localhost;   # 必须用 localhost 不能用 $host（Vite middleware 的 allowedHosts 检查会拦截域名）
    proxy_http_version 1.1;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```
- `proxy_set_header Host` 必须写 `localhost`，否则当 server.ts 回退到 dev 模式时会被 Vite host 检查拦截

### □ 3. PM2 启动
```bash
sudo PM2_HOME=/root/.pm2 pm2 start /var/www/xxx/dist/server.cjs --name <app-name> --time
```
- **必须用 `sudo` + `PM2_HOME=/root/.pm2`**，否则 PM2 进程归属不一致会导致重启问题

### □ 4. 构建后检查
```
# 确认 JS/CSS hash 是否正确（不要用旧缓存的 hash）
cat dist/index.html | grep 'src='
# 确认 API 是否正常
curl -s https://你的域名/api/health
# 确认 Nginx 返回的是新 build 产物
curl -s https://你的域名/ | grep 'src='
```

### □ 5. 资源文件（模型等）
- `npm run build` 的 `postbuild` 步骤会复制 `public/*.task` 到 `dist/`
- 如果 `postbuild` 失败，手动检查：
```bash
ls -la dist/*.task    # pose_landmarker_lite.task, hand_landmarker.task
```

### □ 6. 浏览器强制刷新
- 部署后必须 **`Cmd+Shift+R`（Mac）/ `Ctrl+F5`（Windows）** 强制刷新
- 浏览器缓存可能保留旧 JS，导致奇怪的运行时错误

### □ 7. 源码提交前检查
- ✗ `ref={xxx}` 和 `const xxx = useRef(...)` 是否匹配（这是本项目的常见 bug）
- ✗ 不要在 helm 或 `<canvas ref={canvasRef}>` 里写一个组件内没有 `useRef` 声明的 ref

### □ 8. 常见坑速查
| 现象 | 原因 | 解决 |
|------|------|------|
| `Blocked request. This host is not allowed` | Vite middleware 模式，`Host` 透传到后端 | Nginx `proxy_set_header Host localhost` |
| `Cannot POST /api/deploy` | deploy API 路由未匹配 | 确认 Nginx `/api/` 正确反代到后端端口 |
| `canvasRef is not defined` | JSX `ref={xxx}` 的变量名与 `useRef` 声明不一致 | 修复源码中的变量名 |
| `Unable to open zip archive` (PoseLandmarker) | 模型文件 `.task` 未复制到 `dist/` | 手动复制 `public/*.task` 到 `dist/` |
| `ERR_MODULE_NOT_FOUND` | `dist/` 目录缺失 | 重建或从备份恢复 |
| `WebSocket connection to ws://localhost:8081/` | 浏览器开发插件 | 可忽略，不影响功能 |
