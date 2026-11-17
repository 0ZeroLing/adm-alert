# ADM 预警系统（团队共享版）——阿里云轻量应用服务器部署指南

## 架构

- **前端**：单页 `index.html`，浏览器打开即用
- **后端**：`server.js`（Node 18+，**零第三方依赖**，无需 npm install）
- **存储**：服务器本地 JSON 文件 `data/adm-data.json`（原子写入，几十行数据绰绰有余）
- 数据互通：所有人读写同一份服务器数据，页面每 60 秒自动同步；每个星系有独立数据时间戳，成员各自上传互不影响

```
浏览器 ──HTTP──> Node server.js ──fs──> data/adm-data.json
```

**不需要数据库**（Supabase/MySQL 都不用）——数据量只有 39 行左右，JSON 文件即可，备份就是复制这个文件。

## 文件清单

```
adm-cloud/
├── server.js      # 后端服务（唯一入口）
├── index.html     # 前端页面（由 server.js 托管）
├── package.json   # 无第三方依赖
└── DEPLOY.md      # 本文档
```

## 部署步骤

### 1. 购买/准备轻量应用服务器

- 阿里云轻量应用服务器，任意地域，最低配（2核2G 甚至 1核1G）即可，流量包按月够用
- 应用镜像选 **Ubuntu 22.04 / 24.04**（或 CentOS/Alibaba Linux，命令自行对应）
- 防火墙（控制台 → 防火墙页签）：放行 80 端口（HTTP）。**不要直接放行 8081**，Node 服务只监听本机，由 nginx 转发

### 2. 安装 Node 18+

```bash
ssh root@你的服务器IP
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs nginx
node -v   # 确认 ≥ 18
```

（国内网络慢可用阿里镜像：`curl -fsSL https://npm.aliyun.com/mirrors/node/setup_20.x | bash -`）

### 3. 上传代码

把整个 `adm-cloud/` 目录上传到服务器，例如 `/opt/adm-cloud/`：

```bash
# 本地执行（macOS/Linux）
scp -r adm-cloud root@你的服务器IP:/opt/

# 或服务器上直接用 git 拉你的仓库
```

### 4. 常驻运行（systemd）

```ini
# /etc/systemd/system/adm-alert.service
[Unit]
Description=ADM Alert System
After=network.target

[Service]
WorkingDirectory=/opt/adm-cloud
ExecStart=/usr/bin/node server.js
Environment=PORT=8081
Environment=HOST=127.0.0.1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now adm-alert
curl http://127.0.0.1:8081/api/state   # 应返回 JSON {"systems":[...]}
```

### 5. nginx 反代到 80

```nginx
# /etc/nginx/sites-available/adm
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/adm /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

浏览器访问 `http://你的服务器IP/` 即可，手机同理。团队把链接发群里，人人可看可改。

### 6.（推荐）绑定域名 + HTTPS

- 阿里云买/转入域名（需实名+备案才能用国内服务器 80/443 对外）
- 轻量服务器控制台可一键申请免费 SSL 证书并开启 HTTPS
- 不想备案的替代：用海外轻量服务器（如香港）+ 域名免备案，或直接 IP 走 80 端口先用着

## 数据备份

所有数据就一个文件：

```bash
# 手动备份
cp /opt/adm-cloud/data/adm-data.json ~/adm-backup-$(date +%F).json

# 建议加一条 crontab，每天凌晨备份
echo '0 4 * * * cp /opt/adm-cloud/data/adm-data.json /root/adm-backup-$(date +\%F).json' | crontab -
```

恢复：把备份文件覆盖回去，`systemctl restart adm-alert`。

## API 一览（排障用）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/state` | 全量状态（星系+元数据） |
| GET | `/api/meta` | 元数据（ADM 目标） |
| POST | `/api/meta` | 更新元数据 |
| POST | `/api/system` | 新增/编辑星系（按名 upsert，可带 `updAt` 数据时间） |
| PATCH | `/api/system` | 编辑+改名 |
| DELETE | `/api/system?name=X` | 删除单个星系 |
| POST | `/api/systems` | 批量导入（跳过已有） |
| DELETE | `/api/systems` | 清空全部（前端有二次确认） |
| GET | `/api/seed` | 空库时播撒 39 个 WINGS 初始星系 |

首次打开页面时若服务器无数据，前端会自动调用 `/api/seed` 初始化 39 个 WINGS 星系（Delve/Period Basis/Querious 战术图名单），之后任何人编辑全员 60 秒内可见。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `PORT` | 否 | 默认 8081 |
| `HOST` | 否 | 默认 0.0.0.0（建议 nginx 场景设 127.0.0.1） |

## 每星系独立数据时间

不同成员上传数据的时刻不同，每个星系保存各自的 `updAt`（数据时间）：

- 编辑/添加星系时可填「数据时间」——即这份等级/指数数据实际是什么时候看到的；默认为保存时刻
- 衰减外推和预警缓冲（R = 24 − 数据时间的小时数）都按每个星系自己的时间独立计算
- 成员 A 今天 10 点更新的星系和成员 B 昨天 22 点更新的星系互不影响

## 常见问题

- **页面打不开**：`systemctl status adm-alert` 看服务是否运行；`curl 127.0.0.1:8081/api/state` 看后端是否正常；再查轻量控制台防火墙是否放行 80
- **改了没同步**：点页面「↻ 立即同步」；或强刷浏览器缓存
- **想重置**：页面「清空全部」→ 重新打开页面自动 seed；或直接删 `data/adm-data.json` 后 `systemctl restart adm-alert`
- **安全提示**：知道 IP 的人都能编辑。仅限团队内部使用；如需加访问口令，可在 nginx 加一层 Basic Auth（两行配置），需要的话再说
