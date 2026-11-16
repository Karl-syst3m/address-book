# 云部署记录（已上线）

- 服务器：`103.236.57.2`（RainYun-G1zwXAfd，Debian 12 bookworm，x86_64，Node v24.15.0）
- 访问地址：**<http://103.236.57.2:3000>**
- 部署时间：2026-11-16 16:21
- 运行方式：systemd 服务 `address-book`（`enabled` + `active`，开机自启，异常自动重启）

## 部署结构

| 项 | 值 |
| --- | --- |
| 代码目录 | `/opt/address-book/app` |
| 数据库 | `/opt/address-book/app/data/address_book.db`（36 KB，8 人 / 3 收藏 / 38 条联系方式） |
| 运行用户 | `addressbook`（系统账号，无登录 shell） |
| 服务单元 | `/etc/systemd/system/address-book.service` |
| 监听 | `0.0.0.0:3000`（Express 直出，未经过你这台机器的 nginx，避免动现有站点） |
| 防火墙 | `ufw allow 3000/tcp # address-book-deploy` |
| 内存占用 | 约 43 MB |
| 依赖 | express 4.x / exceljs / multer，`npm ci --omit=dev` 安装；数据库为 Node 内置 `node:sqlite` |

> 说明：这台机器同时在跑 AstrBot、NapCat ×2、DSH multichar、QQ Gateway 等服务，nginx 由宝塔管理（`/www/server/nginx`）。
> 为**不触碰任何现有站点与端口**，本次没有改 nginx，也没有占用 80/443，而是新开 3000 给应用直连。

## 验证记录（全部从公网完成）

| 检查 | 结果 |
| --- | --- |
| `GET /` 首页 | 200 |
| `GET /api/stats` | `{contacts:8, bookmarked:3, methods:38}` |
| `GET /api/export` | 200，8504 字节，表头 14 列、8 数据行、冻结首行、autoFilter A1:N1 |
| 导出→导入往返 | `{created:0, updated:0, skipped:8}`，人数保持 8（无重复建人）|
| 外部新建/收藏/删除 | 建号 201 → 收藏 true → 删除 200 → 再查 404 |
| `systemctl restart` | 服务自动恢复，数据持久化正常 |
| 浏览器访问 | 页面与本地一致（截图 `screens/04-云部署-公网访问.png`）|

## 运维命令

```bash
# 状态 / 日志
systemctl status address-book
journalctl -u address-book -f

# 重启 / 停止 / 开机自启
systemctl restart address-book
systemctl stop address-book
systemctl disable address-book

# 重新灌演示数据（会清空现有联系人）
cd /opt/address-book/app && sudo -u addressbook npm run seed
```

更新代码（在本地项目目录执行）：

```bash
cd /d/DeepSeekHarness/dsh/se-xp-2026-11
tar czf deploy/app.tgz --exclude=node_modules --exclude=data --exclude=.tmp app
cat deploy/app.tgz | ssh fartooth.bot 'tar xzf - -C /opt/address-book && chown -R addressbook:addressbook /opt/address-book/app'
ssh fartooth.bot 'cd /opt/address-book/app && sudo -u addressbook npm ci --omit=dev && systemctl restart address-book'
```

## 回滚（完全撤除）

```bash
ssh fartooth.bot '
systemctl disable --now address-book
rm -f /etc/systemd/system/address-book.service
systemctl daemon-reload
ufw delete allow 3000/tcp
rm -rf /opt/address-book
userdel -r addressbook 2>/dev/null
'
```

## 已知风险（建议在博客里如实写 1-2 条）

1. **无鉴权**：端口 3000 对公网开放，任何人可读写这份通讯录。作为课程演示够用；若担心，可以告诉我，我用 nginx 加一层 HTTP Basic Auth（会占用一个 80 端口下的 location，需改你现有站点，所以要先征得你同意）。
2. **无 HTTPS**：没有域名和证书，走的是明文 HTTP。
3. 演示数据是 `npm run seed` 生成的假数据，未含真实个人信息。
