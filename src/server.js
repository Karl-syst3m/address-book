import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { DB_PATH } from './db.js';
import { ApiError } from './errors.js';
import {
  createContact,
  deleteContact,
  getContact,
  getStats,
  listContacts,
  setBookmark,
  updateContact,
} from './contacts.js';
import { buildExportBuffer, buildTemplateBuffer, importWorkbook } from './excel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!['.xlsx', '.xls'].includes(extension)) {
      callback(new ApiError(400, '只支持 .xlsx 或 .xls 文件'));
      return;
    }
    callback(null, true);
  },
});

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(404, '联系人不存在');
  return id;
}

function sendXlsx(res, buffer, utf8Name, asciiName) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
  );
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Cache-Control', 'no-store');
  res.end(buffer);
}

// ---------- 联系人 ----------

app.get('/api/contacts', wrap(async (req, res) => {
  const sort = req.query.sort === undefined ? 'name' : String(req.query.sort);
  if (!['name', 'updated'].includes(sort)) {
    throw new ApiError(400, 'sort 只支持 name 或 updated');
  }
  const bookmarked = ['1', 'true', 'yes'].includes(String(req.query.bookmarked || '').toLowerCase());
  const result = listContacts({
    q: req.query.q ? String(req.query.q) : '',
    bookmarked,
    sort,
  });
  res.json(result);
}));

app.post('/api/contacts', wrap(async (req, res) => {
  const contact = createContact(req.body);
  res.status(201).json({ contact });
}));

app.get('/api/contacts/:id', wrap(async (req, res) => {
  const contact = getContact(parseId(req.params.id));
  if (!contact) throw new ApiError(404, '联系人不存在');
  res.json({ contact });
}));

app.put('/api/contacts/:id', wrap(async (req, res) => {
  const contact = updateContact(parseId(req.params.id), req.body);
  res.json({ contact });
}));

app.delete('/api/contacts/:id', wrap(async (req, res) => {
  deleteContact(parseId(req.params.id));
  res.json({ deleted: true });
}));

app.patch('/api/contacts/:id/bookmark', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (
    !req.body
    || typeof req.body !== 'object'
    || Array.isArray(req.body)
    || !Object.prototype.hasOwnProperty.call(req.body, 'bookmarked')
  ) {
    throw new ApiError(400, '请求体必须包含 bookmarked 字段');
  }
  const contact = setBookmark(id, req.body.bookmarked);
  res.json({ contact });
}));

// ---------- 统计 ----------

app.get('/api/stats', wrap(async (req, res) => {
  res.json(getStats());
}));

// ---------- Excel 导入导出 ----------

app.get('/api/export', wrap(async (req, res) => {
  const isTemplate = ['1', 'true', 'yes'].includes(String(req.query.template || '').toLowerCase());

  if (isTemplate) {
    const buffer = await buildTemplateBuffer();
    sendXlsx(res, buffer, '通讯录导入模板.xlsx', 'address-book-template.xlsx');
    return;
  }

  const { buffer, count } = await buildExportBuffer();
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  res.setHeader('X-Export-Count', String(count));
  sendXlsx(res, buffer, `通讯录_${stamp}.xlsx`, `address-book-${stamp}.xlsx`);
}));

app.post('/api/import', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new ApiError(400, '请选择要导入的 Excel 文件（表单字段名 file）');
  const result = await importWorkbook(req.file.buffer);
  res.json(result);
}));

// ---------- 静态资源与 SPA 回落 ----------

app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

app.use((req, res) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    res.status(404).json({ error: '接口不存在' });
    return;
  }
  if (req.method !== 'GET') {
    res.status(404).json({ error: '资源不存在' });
    return;
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ---------- 统一错误处理 ----------

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: '文件大小不能超过 5MB' });
      return;
    }
    res.status(400).json({ error: `文件上传失败：${error.message}` });
    return;
  }

  if (error instanceof ApiError) {
    if (error.status >= 500) console.error('[api]', error);
    res.status(error.status).json({ error: error.message });
    return;
  }

  if (error.type === 'entity.too.large') {
    res.status(413).json({ error: '请求体过大，JSON 上限为 2MB' });
    return;
  }
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: '请求体不是合法的 JSON' });
    return;
  }
  if (error.status === 400) {
    res.status(400).json({ error: error.message || '请求格式不正确' });
    return;
  }

  console.error('[server] 未处理的错误：', error);
  res.status(500).json({ error: '服务器内部错误' });
});

const server = app.listen(PORT, () => {
  console.log(`通讯录服务已启动：http://localhost:${PORT}`);
  console.log(`数据库文件：${DB_PATH}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，请设置 PORT 环境变量或先释放端口。`);
  } else {
    console.error('[server] 启动失败：', error);
  }
  process.exitCode = 1;
});
