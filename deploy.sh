#!/bin/bash
set -e

# ============================================
# 阿里云 ECS 部署 Bouldering AI Pro
# 保留现有服务 (80/443)，新增 8090 端口
# ============================================

echo "=== 1. 安装 Node.js 22 ==="
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "Node: $(node --version)"

echo "=== 2. 安装 Nginx ==="
if ! command -v nginx &>/dev/null; then
  apt-get update -qq
  apt-get install -y nginx openssl
fi

echo "=== 3. 克隆项目 ==="
cd /root
if [ ! -d "Bouldering-AI-Pro" ]; then
  git clone https://github.com/bolun-ha/Bouldering-AI-Pro.git
fi
cd Bouldering-AI-Pro
git fetch origin
git reset --hard origin/main

echo "=== 4. 安装依赖 & 构建 ==="
npm install
npm run build

echo "=== 5. 安装 pm2 进程管理 ==="
npm install -g pm2

echo "=== 6. 生成自签名 SSL 证书 ==="
mkdir -p /etc/nginx/ssl
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/selfsigned.key \
  -out /etc/nginx/ssl/selfsigned.crt \
  -subj "/C=CN/ST=Beijing/L=Beijing/O=BoulderingAI/CN=47.92.123.82" 2>/dev/null

echo "=== 7. 创建 Nginx 配置（端口 8090，不影响现有 80/443）==="
cat > /etc/nginx/sites-available/bouldering << 'NGINXCONF'
# 抱石项目 - 独立 8090 端口，不干扰现有服务
server {
    listen 8090 ssl;
    server_name 47.92.123.82;

    ssl_certificate /etc/nginx/ssl/selfsigned.crt;
    ssl_certificate_key /etc/nginx/ssl/selfsigned.key;

    client_max_body_size 200M;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location / {
        root /root/Bouldering-AI-Pro/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
NGINXCONF

ln -sf /etc/nginx/sites-available/bouldering /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
echo "Nginx 配置 OK"

echo "=== 8. 启动服务 ==="
cd /root/Bouldering-AI-Pro
pm2 delete bouldering 2>/dev/null || true
pm2 start node_modules/.bin/tsx --name bouldering -- server.ts --time
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo "======================================"
echo "✅ 部署完成！浏览器打开："
echo "   https://47.92.123.82:8090"
echo ""
echo "首次访问会提示"连接不安全""
echo "→ 点击「高级 - 继续前往」即可"
echo "摄像头调用正常"
echo "======================================"
