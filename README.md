# 通讯录 · Address Book

一个用于软件工程课程作业的通讯录 Web 应用：支持**收藏联系人**、**一个联系人挂多条多种类型的联系方式**、**Excel 导入 / 导出 / 模板下载**，并将首页仪表、搜索、筛选、排序、卡片编辑等交互整合在单页界面中。

技术栈固定为纯 JavaScript（ESM，无构建步骤）：

- 后端：Node.js + Express 4
- 数据库：Node.js 内置 `node:sqlite` 的 `DatabaseSync`（无需 better-sqlite3 / sqlite3 等原生依赖）
- Excel：ExcelJS
- 上传：Multer（内存存储）
- 前端：原生 HTML + CSS + JavaScript，无框架、无 CDN、无构建

## 功能清单

- **收藏联系人**：卡片星标一键收藏 / 取消收藏，统计数字即时更新；支持「仅收藏」筛选。
- **多种联系方式**：一个联系人可添加任意条 `phone / email / wechat / qq / address / other`，每条含 `type / value / label / is_primary`。新增与编辑弹窗支持动态加行、删行。
- **联系人管理**：新增、查看、编辑、删除（删除有 `confirm` 确认）；姓名 / 公司模糊搜索，匹配姓名、公司或任意联系方式值；按姓名或最近更新排序。
- **Excel 导出**：固定 14 列表头，每个联系人一行；同一类型超过列位上限的内容合并到「其他」列（`类型:值; ...`），保证信息不丢失；表头加粗 + 浅灰底、列宽、首行冻结、自动筛选。
- **Excel 导入**：按固定表头解析，逐行校验，错误行不阻断整体；自动去重、补全空字段、追加新联系方式。
- **模板下载**：`GET /api/export?template=1` 返回表头 + 一行示例数据。
- **首页仪表**：顶栏显示总联系人 / 收藏数 / 联系方式数；空状态、搜索无结果、操作 toast、导入结果条（新建 / 更新 / 跳过 + 前 5 条错误）。
- **样式**：浅色卡片、圆角、柔和阴影、主色 `#2563eb`、内联 SVG 图标、响应式单列布局、悬停 / 聚焦态。

## 目录结构

```text
app/
├─ package.json          # 依赖与 scripts（start / seed）
├─ package-lock.json
├─ README.md
├─ .gitignore
├─ src/
│  ├─ server.js          # Express 入口、路由、multer、错误中间件
│  ├─ db.js              # node:sqlite 连接、PRAGMA、幂等建表、事务封装
│  ├─ contacts.js        # 联系人 / 联系方式校验、CRUD、统计、导入合并
│  ├─ excel.js           # Excel 导出、模板、导入解析
│  ├─ seed.js            # 8 条中文演示数据（先清空再插入，可反复执行）
│  └─ errors.js          # ApiError（携带 HTTP 状态码）
├─ public/
│  ├─ index.html         # 单页结构、SVG symbol、弹窗
│  ├─ style.css          # 全部样式与响应式
│  └─ app.js             # 前端状态、API 调用、渲染、交互
└─ data/                 # 运行时自动创建（.gitignore）
   └─ address_book.db
```

## 启动步骤

环境要求：**Node.js >= 22.5**（`node:sqlite` 内置模块）。本机验证使用 Node.js v24.15.0。

```bash
cd se-xp-2026-11/app
npm install
npm run seed     # 可选：写入 8 条中文演示数据（会先清空）
npm start        # 默认 http://localhost:3000
```

- 自定义端口：`PORT=4000 npm start`（Git Bash）/ `set PORT=4000 && npm start`（cmd）。
- 首次启动会自动创建 `data/address_book.db` 并建表，重复启动安全（`CREATE TABLE IF NOT EXISTS`）。
- 数据库文件：`app/data/address_book.db`。

## 数据模型

```sql
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT DEFAULT '',
  note TEXT DEFAULT '',
  bookmarked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- phone|email|wechat|qq|address|other
  value TEXT NOT NULL,
  label TEXT DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0
);
```

- 连接后执行 `PRAGMA foreign_keys = ON`，删除联系人时由 SQLite 级联删除其联系方式。
- 索引：`contacts(name)`、`contacts(bookmarked)`、`contacts(updated_at)`、`contact_methods(contact_id)`、`contact_methods(value)`。
- 时间使用 ISO 8601 字符串（UTC）。

## API 一览

除 xlsx 下载外，所有接口返回 JSON；错误统一为 `{ "error": "说明" }`。

| 方法 | 路径 | 说明 | 成功响应 |
| --- | --- | --- | --- |
| `GET` | `/api/contacts?q=&bookmarked=1&sort=name\|updated` | 列表；`q` 模糊匹配姓名 / 公司 / 联系方式值；`bookmarked=1` 只看收藏；`sort` 默认 `name` | `200 { total, items }` |
| `POST` | `/api/contacts` | 新建联系人 | `201 { contact }` |
| `GET` | `/api/contacts/:id` | 联系人详情 | `200 { contact }`，不存在 `404` |
| `PUT` | `/api/contacts/:id` | 更新联系人；请求含 `methods` 时**整体替换**联系方式 | `200 { contact }`，不存在 `404` |
| `DELETE` | `/api/contacts/:id` | 删除联系人（级联删联系方式） | `200 { deleted: true }`，不存在 `404` |
| `PATCH` | `/api/contacts/:id/bookmark` | 收藏 / 取消收藏，body `{ bookmarked: true\|false }` | `200 { contact }` |
| `GET` | `/api/stats` | 首页统计 | `200 { contacts, bookmarked, methods, byType }` |
| `GET` | `/api/export` | 导出全部联系人 xlsx | `200` + xlsx 文件 |
| `GET` | `/api/export?template=1` | 下载导入模板（表头 + 一行示例） | `200` + xlsx 文件 |
| `POST` | `/api/import` | multipart 上传，字段名 `file` | `200 { created, updated, skipped, errors }` |

### 请求体示例

```json
{
  "name": "张三",
  "company": "示例科技",
  "note": "周一上午通常有空",
  "bookmarked": true,
  "methods": [
    { "type": "phone", "value": "13800138000", "label": "手机", "is_primary": true },
    { "type": "email", "value": "zhangsan@example.com", "label": "工作邮箱", "is_primary": true },
    { "type": "wechat", "value": "zhangsan_wx" }
  ]
}
```

`contact` 结构：

```json
{
  "id": 1,
  "name": "张三",
  "company": "示例科技",
  "note": "",
  "bookmarked": true,
  "created_at": "2026-11-15T10:00:00.000Z",
  "updated_at": "2026-11-15T10:00:00.000Z",
  "methods": [
    { "id": 1, "type": "phone", "value": "13800138000", "label": "手机", "is_primary": true }
  ]
}
```

### 校验与限制

- `name` 去空格后不能为空，长度 ≤ 100。
- `company` ≤ 100，`note` ≤ 2000，联系方式 `label` ≤ 50。
- `type` 只允许 `phone | email | wechat | qq | address | other`，非法返回 `400`。
- 联系方式 `value` 去空格后不能为空，长度 ≤ 200。
- 同一类型只保留一个 `is_primary`；电话 / 邮箱未指定首选时默认第一条为首选。
- JSON body 上限 **2MB**；上传文件上限 **5MB**，扩展名只接受 `.xlsx` / `.xls`。
- 统一错误中间件：业务错误返回对应状态码和 `{ error }`；未预期异常只向客户端返回「服务器内部错误」，堆栈打印到服务端 `console.error`。

## Excel 列格式

导出 / 导入使用同一套固定表头（第 1 行），共 14 列：

| 列 | 表头 | 说明 |
| --- | --- | --- |
| A | 姓名 | 必填，≤ 100 字 |
| B | 公司 | 可空 |
| C | 收藏 | `是` 或空；导入时 `是 / 1 / true / yes` 均视为收藏 |
| D-F | 电话1 / 电话2 / 电话3 | 按顺序填 3 个电话 |
| G-I | 邮箱1 / 邮箱2 / 邮箱3 | 按顺序填 3 个邮箱 |
| J | 微信 | 第一个微信 |
| K | QQ | 第一个 QQ |
| L | 地址 | 第一个地址 |
| M | 其他 | 溢出的同类型联系方式，格式 `类型:值`，多个用 `; ` 分隔；也承载 `other` 类型 |
| N | 备注 | 联系人备注 |

示例数据：

| 姓名 | 公司 | 收藏 | 电话1 | 电话2 | 电话3 | 邮箱1 | 邮箱2 | 邮箱3 | 微信 | QQ | 地址 | 其他 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 张三 | 示例科技有限公司 | 是 | 13800138000 | 010-88886666 |  | zhangsan@example.com |  |  | zhangsan_wx | 10001 | 北京市朝阳区示例路 1 号 | 其他:备用号码 13900139000 | 示例备注 |

导出细节：

- 表头加粗、浅灰底（`FFF1F5F9`）、居中、底部细边框；列宽按内容设置。
- 首行冻结：`views: [{ state: "frozen", ySplit: 1 }]`。
- 自动筛选：`autoFilter = A1:N1`。
- 超过 3 个电话 / 邮箱，或多个微信 / QQ / 地址 / 其他，统一追加到「其他」列，例如 `电话:13900139000; 微信:backup_wx`，导入时可还原为对应类型。
- 下载响应头使用 `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...`（RFC 5987），中文文件名不会乱码。

## 导入规则

1. 读取第一个工作表，**第 1 行必须是表头**；缺少「姓名」列返回 `400`（例如文件不是模板格式）。
2. 空行（所有已识别列均为空）直接跳过，不计入 `skipped`。
3. 每行独立校验：姓名必填、联系方式值非空且 ≤ 200、公司 ≤ 100 等；校验失败的行计入 `skipped`，并写入 `errors: [{ row, reason }]`，**不阻断其他行**。
4. 去重键：
   - 优先：同一 `name` + 同一**首选电话**或**首选邮箱** → 同一人；
   - 回退：同一 `name` + 任意电话 / 邮箱值相同 → 同一人（避免导出再导入时因首选标记不同而重复建人）；
   - 都未命中 → 新建。
5. 命中已有联系人时执行合并：补全空的公司 / 备注；收藏取并集；追加缺失的 `type + value` 联系方式（相同 `type + value` 去重）；若没有任何实际变化，则计入 `skipped`。
6. 返回结构：

```json
{
  "created": 2,
  "updated": 1,
  "skipped": 1,
  "errors": [{ "row": 5, "reason": "姓名不能为空" }]
}
```

> 导入按行提交，不是整批原子事务：某行失败不会回滚此前已成功导入的行。课程作业场景下这样更符合「错误行不阻断整体」的要求。

## 前端说明

- 单页应用，所有请求同源 `/api/...`；Express 静态托管 `public`，非 `/api` 的 GET 回落 `index.html`。
- 联系人卡片：头像首字、姓名 / 公司、收藏星标、每条联系方式（类型图标、标签、首选圆点、复制按钮）、编辑 / 删除。
- 新增 / 编辑弹窗：姓名、公司、备注、动态联系方式行（类型下拉、值、标签、首选、删除）、收藏开关。
- 工具条：全部 / 仅收藏筛选、排序、下载模板、导出 Excel、导入 Excel。
- 空状态区分「通讯录为空」与「筛选无结果」；操作后 toast；请求失败显示后端 `error` 文案。
- 键盘：`/` 聚焦搜索，`Esc` 关闭弹窗。
- 响应式：≤ 1020px 顶栏折行，≤ 760px 单列卡片，≤ 620px 联系方式行折行，≤ 480px 隐藏 FAB 文案。

## 本地自测记录

已验证：

- `npm install`、`npm run seed`、`npm start` 均正常。
- 首页 `GET /` 返回 `200`，HTML 含顶栏、搜索、筛选、导入导出、空状态、弹窗等关键元素。
- 联系人 CRUD、收藏、搜索、仅收藏筛选、`methods` 整体替换正常。
- 导出 xlsx 可被 ExcelJS 重新读回：表头 14 列完全一致，行数 = 联系人数量 + 1，冻结 / 筛选 / 样式已设置。
- 导出文件再次导入：`created = 0`，无重复联系人。
- 模板下载后填入 2 行导入：`created = 2`。
- 删除联系人后 `GET` 返回 `404`，`contact_methods` 级联删除，`/api/stats` 的 `methods` 数下降。
- 空姓名、非法 type、不存在 id、缺表头、非法扩展名、非法 JSON 均返回预期状态码与 `{ error }`。

## 已知限制

- 无用户系统 / 鉴权，假设单用户本地使用。
- 列表一次返回全部匹配数据，未做分页；数据量特别大时需要补充分页。
- 姓名排序使用 SQLite 的 Unicode 码点顺序，不是拼音排序。
- 旧版二进制 `.xls` 仅做扩展名校验；ExcelJS 只能解析 `.xlsx`，遇到旧 `.xls` 会返回 400 并提示另存为 `.xlsx`。
- 导入不是整批原子事务（见上）。
- 未实现云服务器部署（作业可选项）。
- 联系方式 `label` 不进入固定 Excel 模板列；导入时新联系人的 label 为空，已有联系人在合并时保留原 label。
