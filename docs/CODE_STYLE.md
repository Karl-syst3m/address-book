# 代码规范

本项目为纯 JavaScript（ESM）项目，不引入 ESLint/Prettier 等额外工具链，规范以「约定 + 评审」方式执行。

## 1. 通用

- 语言：ES Module（`import` / `export`），不混用 `require`（除读取 CJS 依赖如 ExcelJS）。
- 缩进 2 空格；语句结束带分号；字符串统一单引号（含内嵌时用模板串）。
- 文件编码 UTF-8，换行 LF。
- 禁止提交 `node_modules/`、数据库文件、日志；由 `.gitignore` 约束。

## 2. 命名

| 类型 | 约定 | 示例 |
| --- | --- | --- |
| 变量/函数 | lowerCamelCase | `contactId`、`listContacts` |
| 常量 | UPPER_SNAKE_CASE | `MAX_UPLOAD_BYTES`、`METHOD_TYPES` |
| 模块/文件 | kebab-case 或语义单词 | `contacts.js`、`excel.js` |
| 数据库表/列 | snake_case | `contact_methods`、`created_at` |
| REST 路径 | 复数名词小写 | `/api/contacts`、`/api/contacts/:id/bookmark` |

## 3. 分层职责

- `src/server.js`：只做路由装配、中间件、错误兜底，不写业务判断。
- `src/contacts.js`：业务规则（校验、去重、合并、统计），不直接拼 SQL 之外的 HTTP 细节。
- `src/db.js`：连接、PRAGMA、建表、事务封装。
- `src/excel.js`：只负责 xlsx 的读写与行列映射。
- 禁止跨层访问（如路由层直接写 SQL）。

## 4. 数据访问

- **所有 SQL 使用参数绑定**，禁止字符串拼接用户输入。
- 多表写入放在事务中，保证一致性。
- 外键约束开启（`PRAGMA foreign_keys = ON`），删除依赖级联。

## 5. 错误处理

- 业务错误统一抛 `ApiError(status, message)`，由中间件转成 `{error: "..."}`。
- 面向用户的错误信息用中文、说明「怎么改」；不把堆栈返回给客户端，服务端 `console.error` 记录。
- 输入校验在业务层入口统一做（姓名长度、类型白名单、值非空）。

## 6. API 约定

- 资源用名词复数；动作用 HTTP 方法表达（`PATCH .../bookmark` 用于子资源式动作）。
- 成功返回业务对象（`{contact}` / `{items, total}`），失败返回 `{error}`。
- 状态码：201 创建、200 成功、400 参数错误、404 不存在、413 超限、500 未预期。

## 7. Git 提交规范

采用 Conventional Commits：

```
<type>: <中文简述>

<可选正文：做了什么、为什么>
```

`type` 取值：`feat` 新功能、`fix` 修复、`docs` 文档、`chore` 工程配置、`refactor` 重构、`test` 测试。

要求：一个提交只做一件事；正文说明「为什么」而不是复述改动。

## 8. 前端

- 原生 DOM，无框架；所有动态文本经 `escapeHtml` 转义后插入，避免 XSS。
- 事件用委托绑定在列表容器上，避免逐条重复绑定。
- 请求统一走 `request()` 封装，集中处理错误提示与 loading 态。
