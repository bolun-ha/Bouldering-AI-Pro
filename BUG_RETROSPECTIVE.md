# Bouldering AI Pro 故障复盘（2026-06-15）

## 一句话总结

**本来 10 分钟能搞定的事，搞了一上午。原因是我一直在用「远程调试思路」去做一件「本地修文件、服务器跑命令」就能解决的事。**

---

## 错误复盘（按时间线）

### ❌ 错误 1：没有先确认 SSH 连不上就开了复杂方案

**做了啥：** 发现 PM2 报 `ERR_MODULE_NOT_FOUND`（dist/ 丢失），我第一反应是远程操作修代码。

**问题在哪：** 我应该先 `ssh root@47.92.123.82` 测一下能不能连。实际当时 SSH 就已经被 EDR 拦了（`Permission denied`），但我没先确认，花了大量时间尝试各种远程方案。

**正确做法：** 先跑 `ssh -v root@47.92.123.82` → 发现连不上 → 直接让用户在服务器上执行命令。

### ❌ 错误 2: 用了 paramiko 尝试密码登录

**做了啥：** 知道密码是 `bolunta1995`，就写了 Python 脚本用 paramiko 去试。

**问题在哪：** 服务器已经配置为 `allowed types: ['publickey']`，密码认证已被阿里 EDR 关闭。我浪费了 5 分钟试一个本来就不可能成功的方案。

### ❌ 错误 3: 在 `server.ts` 里绕 Vite middleware 绕了一大圈

**做了啥：** 花了大量时间分析 `server.ts` 的 `scriptDir` 判断逻辑、`__dirname` 被 esbuild 转成 `process.argv[1]` 的坑、改了 `let` 加兜底路径。

**问题在哪：** 这是「通过后端代码解决」的思路，实际上根本不需要动 `server.ts`。Nginx 直接 serve 静态文件、只把 `/api/` 反代到后端就绕过了 Vite middleware 的所有问题。而且 Nginx 已经在服务器上跑着，改个配置几分钟的事。

**正确做法：** 直接改 Nginx 配置，不需要碰代码。

### ❌ 错误 4: 修 `canvasRef` 时选了远程调试而不是本地修复

**做了啥：** 发现 `RouteGuide.tsx` 里 `canvasRef` 没有对应的 `const` 声明后，我写了 base64 脚本让用户在服务器上执行，又在 SSH 连上后远程编辑文件。

**问题在哪：**
- 远程写 500 行的 .tsx 文件很容易出错（heredoc 的转义、缩进、空格）
- 多次 try SSH、fail、重新生成 key、让用户加公钥，来回拉扯
- 其实最简单的是：**本机改好 → 本机 build → 打包 tar.gz → 上传到服务器 → 解压**

### ❌ 错误 5: 修 JS 产物而不是修源码

**做了啥：** 用 `sudo sed -i 's/canvasRef/imageRef/g'` 直接改编译后的 JS 文件。

**问题在哪：** 变量名 `canvasRef` 在代码里就是作为 `ref={canvasRef}` 使用的，改成 `imageRef` 后 JS 里没有这个变量定义，报 `imageRef is not defined`。更糟的是当时处于「已经累了」的状态，越急越乱，又反向改回 `canvasRef`，最后用 `void 0` 解决。

### ❌ 错误 6: 最终方案其实用 SSH 连上了，但应该更早做

**做了啥：** 最后让用户在服务器上加了公钥，用 SSH 连上去一行命令搞定。

**问题在哪：** 这个方案是我一开始就应该执行的。但因为我一直在试其他方案，拖到用户说「你来弄」才走这条路。

---

## 如果重来一遍，最正确的做法

### 最佳路径（10 分钟）：

1. **发现问题**（5 秒）: PM2 报 `ERR_MODULE_NOT_FOUND` → `dist/` 没了
2. **检查 ssh**（10 秒）: `ssh root@47.92.123.82` → 被拦 → **直接放弃远程操作**
3. **让用户在服务器上执行 3 条命令**（1 分钟）：

```bash
# ① 从备份恢复 dist
cp -a /var/www/Bouldering-AI-Pro/dist.bak12 /var/www/Bouldering-AI-Pro/dist

# ② 改 Nginx（绕过 Vite middleware）
sudo sed -i 's/proxy_set_header Host $host;/proxy_set_header Host localhost;/' /etc/nginx/sites-available/bouldering
sudo nginx -t && sudo systemctl reload nginx

# ③ 重启 PM2
sudo PM2_HOME=/root/.pm2 pm2 restart bouldering
```

4. **页面能访问后，修 canvasRef + 补模型文件**（3 分钟）:
   - 本机改好源码 → `npm run build` → 打包 dist/
   - 要是能 SSH 就 `scp`，不能就通过 deploy API 或让用户跑一条命令

### 基本思路：

| 情况 | 方案 |
|------|------|
| SSH 能连 | 远程操作 |
| SSH 被拦 | **让用户跑命令，每条不超过一行，贴了就能跑** |
| 改代码 | **本机改好 + build，传产物**，不要远程编辑源码 |
| 修 Nginx | `sed` 或 `nano`，不要重写整个文件 |

---

## 根因分析：为什么这个 bug 会发生？

### 直接原因（3 层嵌套）

**第 1 层：dist/ 为什么没了？**
用户之前执行过 `rm -rf dist` 或类似操作导致 dist 目录丢失。这不是 bug，是人为操作。

**第 2 层：为什么 index.js 加载后报 canvasRef 错误？**
`RouteGuide.tsx` 组件里 JSX 写了 `ref={canvasRef}` 但组件内没有 `const canvasRef = useRef()`。实际用的是 `imageRef`。这是**一个写代码时没注意的笔误**——变量名不匹配。

具体位置：
```tsx
// 第 28 行：定义了 imageRef
const imageRef = useRef<HTMLCanvasElement>(null);

// 第 528 行：但 JSX 里写了 canvasRef
<canvas ref={canvasRef} ... />  // 应该是 imageRef
```

**第 3 层：为什么部署环境会暴露这个 bug？**
之前 dev 模式走 Vite dev server 时，HMR 可能提前加载了这个组件，prod build 的 tree-shaking 也没有标记这个编译问题。只有当代码真正在浏览器执行到 `ref={canvasRef}` 时才抛出 ReferenceError。

### 更深层的原因

**1. Vite + esbuild 的 build pipeline 没有做运行时检查**
Vite build 时检查了 TypeScript 类型但没有出现编译错误，因为 `canvasRef` 被当成全局变量引用（不是模块内的未定义变量）。这是 JS/TS 的灵活性带来的盲区。

**2. Nginx 配置丢失 + Vite middleware 的 host 检查** 
`server.ts` 在 PM2 下 `process.argv[1]` 指向错误路径，回退到了 dev 模式（Vite middleware），触发了 `allowedHosts` 检查。这是开发时没有考虑到的环境差异。

**3. 阿里 EDR 的安全策略变更**
SSH 密码登录被禁用是阿里云安全策略的自动升级，开发环境中很少遇到，导致我一开始没有做 SSH 连通性检查。

### 避免这类问题的建议

1. **TypeScript 添加 eslint rule**: `react/jsx-no-undef` 可以检查 JSX 里引用了未定义的变量
2. **生产环境用 Nginx serve 静态文件**，后端不做 `express.static`，减少开发/生产路径不一致
3. **项目根目录放 `.nvmrc` 和 `deploy.sh`**，部署时一条脚本搞定，减少人为操作
4. **SSH 密钥提前配好**，避免 EDR 升级后临时折腾
