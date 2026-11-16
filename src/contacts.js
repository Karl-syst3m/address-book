import { db, nowIso, transaction } from './db.js';
import { ApiError, badRequest, notFound } from './errors.js';

export const METHOD_TYPES = ['phone', 'email', 'wechat', 'qq', 'address', 'other'];

export const METHOD_TYPE_LABELS = {
  phone: '电话',
  email: '邮箱',
  wechat: '微信',
  qq: 'QQ',
  address: '地址',
  other: '其他',
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value, field, { max, required = false } = {}) {
  let text = '';
  if (value !== undefined && value !== null) {
    if (typeof value === 'string') {
      text = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      text = String(value);
    } else {
      throw badRequest(`${field}必须是字符串`);
    }
  }
  text = text.trim();
  if (required && !text) throw badRequest(`${field}不能为空`);
  if (max && text.length > max) throw badRequest(`${field}长度不能超过 ${max} 个字符`);
  return text;
}

function parseBoolean(value, field) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', '是', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', '否', 'off', ''].includes(normalized)) return false;
  }
  throw badRequest(`${field}必须是布尔值`);
}

function normalizeMethods(input) {
  if (!Array.isArray(input)) throw badRequest('methods 必须是数组');

  const methods = input.map((item, index) => {
    const scope = `第 ${index + 1} 条联系方式`;
    if (!isPlainObject(item)) throw badRequest(`${scope}格式不正确`);

    const type = normalizeText(item.type, `${scope}的类型`, { max: 20 }).toLowerCase();
    if (!METHOD_TYPES.includes(type)) {
      throw badRequest(`${scope}的类型不合法，只允许：${METHOD_TYPES.join(' / ')}`);
    }
    const value = normalizeText(item.value, `${scope}的内容`, { max: 200, required: true });
    const label = normalizeText(item.label, `${scope}的标签`, { max: 50 });
    const isPrimary = item.is_primary === undefined || item.is_primary === null
      ? false
      : parseBoolean(item.is_primary, `${scope}的 is_primary`);

    return { type, value, label, is_primary: isPrimary };
  });

  // 同一类型只允许一个首选，重复时保留最先出现的那个。
  const primaryTypes = new Set();
  for (const method of methods) {
    if (method.is_primary && primaryTypes.has(method.type)) method.is_primary = false;
    if (method.is_primary) primaryTypes.add(method.type);
  }
  // 电话/邮箱若完全没有指定首选，默认第一条为首选（便于导入去重与前端展示）。
  for (const type of ['phone', 'email']) {
    const group = methods.filter((method) => method.type === type);
    if (group.length > 0 && !group.some((method) => method.is_primary)) {
      group[0].is_primary = true;
    }
  }
  return methods;
}

function toContact(row) {
  return {
    id: row.id,
    name: row.name,
    company: row.company || '',
    note: row.note || '',
    bookmarked: Boolean(row.bookmarked),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toMethod(row) {
  return {
    id: row.id,
    type: row.type,
    value: row.value,
    label: row.label || '',
    is_primary: Boolean(row.is_primary),
  };
}

/** 批量补全 methods，避免列表接口 N+1 查询。 */
function hydrateRows(rows) {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const methodRows = db
    .prepare(
      `SELECT id, contact_id, type, value, label, is_primary
         FROM contact_methods
        WHERE contact_id IN (${placeholders})
        ORDER BY is_primary DESC, id ASC`,
    )
    .all(...ids);

  const grouped = new Map();
  for (const method of methodRows) {
    if (!grouped.has(method.contact_id)) grouped.set(method.contact_id, []);
    grouped.get(method.contact_id).push(toMethod(method));
  }
  return rows.map((row) => ({ ...toContact(row), methods: grouped.get(row.id) || [] }));
}

function insertMethods(contactId, methods) {
  const insert = db.prepare(
    `INSERT INTO contact_methods (contact_id, type, value, label, is_primary)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const method of methods) {
    insert.run(contactId, method.type, method.value, method.label, method.is_primary ? 1 : 0);
  }
}

export function getContact(id) {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  if (!row) return null;
  return hydrateRows([row])[0];
}

export function listContacts({ q = '', bookmarked = false, sort = 'name' } = {}) {
  const keyword = String(q || '').trim();
  const where = [];
  const params = [];

  if (keyword) {
    const like = `%${keyword}%`;
    where.push(`(
      c.name LIKE ?
      OR c.company LIKE ?
      OR EXISTS (
        SELECT 1 FROM contact_methods m
         WHERE m.contact_id = c.id AND m.value LIKE ?
      )
    )`);
    params.push(like, like, like);
  }
  if (bookmarked) where.push('c.bookmarked = 1');

  const orderBy = sort === 'updated'
    ? 'c.updated_at DESC, c.id DESC'
    : 'c.name COLLATE NOCASE ASC, c.id ASC';

  const rows = db
    .prepare(`SELECT c.* FROM contacts c ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderBy}`)
    .all(...params);

  const items = hydrateRows(rows);
  return { total: items.length, items };
}

export function exportAllContacts() {
  const rows = db
    .prepare('SELECT * FROM contacts ORDER BY name COLLATE NOCASE ASC, id ASC')
    .all();
  return hydrateRows(rows);
}

export function createContact(payload) {
  if (!isPlainObject(payload)) throw badRequest('请求体必须是 JSON 对象');

  const name = normalizeText(payload.name, '姓名', { max: 100, required: true });
  const company = normalizeText(payload.company, '公司', { max: 100 });
  const note = normalizeText(payload.note, '备注', { max: 2000 });
  const bookmarked = payload.bookmarked === undefined || payload.bookmarked === null
    ? false
    : parseBoolean(payload.bookmarked, 'bookmarked');
  const methods = payload.methods === undefined || payload.methods === null
    ? []
    : normalizeMethods(payload.methods);

  const timestamp = nowIso();
  const id = transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO contacts (name, company, note, bookmarked, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(name, company, note, bookmarked ? 1 : 0, timestamp, timestamp);
    const contactId = Number(info.lastInsertRowid);
    insertMethods(contactId, methods);
    return contactId;
  });

  return getContact(id);
}

export function updateContact(id, payload) {
  if (!isPlainObject(payload)) throw badRequest('请求体必须是 JSON 对象');

  const existing = getContact(id);
  if (!existing) throw notFound('联系人不存在');

  const name = normalizeText(payload.name, '姓名', { max: 100, required: true });
  const company = payload.company === undefined
    ? existing.company
    : normalizeText(payload.company, '公司', { max: 100 });
  const note = payload.note === undefined
    ? existing.note
    : normalizeText(payload.note, '备注', { max: 2000 });
  const bookmarked = payload.bookmarked === undefined
    ? existing.bookmarked
    : parseBoolean(payload.bookmarked, 'bookmarked');
  const replaceMethods = Object.prototype.hasOwnProperty.call(payload, 'methods');
  const methods = replaceMethods
    ? normalizeMethods(payload.methods === null ? [] : payload.methods)
    : null;

  const timestamp = nowIso();
  transaction(() => {
    db.prepare(
      `UPDATE contacts
          SET name = ?, company = ?, note = ?, bookmarked = ?, updated_at = ?
        WHERE id = ?`,
    ).run(name, company, note, bookmarked ? 1 : 0, timestamp, id);

    if (replaceMethods) {
      db.prepare('DELETE FROM contact_methods WHERE contact_id = ?').run(id);
      insertMethods(id, methods);
    }
  });

  return getContact(id);
}

export function deleteContact(id) {
  const existing = getContact(id);
  if (!existing) throw notFound('联系人不存在');
  db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  return true;
}

export function setBookmark(id, bookmarked) {
  const existing = getContact(id);
  if (!existing) throw notFound('联系人不存在');
  const value = parseBoolean(bookmarked, 'bookmarked');
  db.prepare('UPDATE contacts SET bookmarked = ?, updated_at = ? WHERE id = ?')
    .run(value ? 1 : 0, nowIso(), id);
  return getContact(id);
}

export function getStats() {
  const contacts = Number(db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n);
  const bookmarked = Number(
    db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE bookmarked = 1').get().n,
  );
  const methods = Number(db.prepare('SELECT COUNT(*) AS n FROM contact_methods').get().n);

  const byType = Object.fromEntries(METHOD_TYPES.map((type) => [type, 0]));
  const typeRows = db
    .prepare('SELECT type, COUNT(*) AS n FROM contact_methods GROUP BY type')
    .all();
  for (const row of typeRows) {
    if (Object.prototype.hasOwnProperty.call(byType, row.type)) {
      byType[row.type] = Number(row.n);
    }
  }

  return { contacts, bookmarked, methods, byType };
}

/**
 * 导入去重：同名联系人，优先比较「首选电话 / 首选邮箱」；
 * 未命中时回退为「同名且任意电话 / 邮箱值相同」，避免导出再导入时因首选标记不同而重复建人。
 */
export function findDuplicateContact(name, methods) {
  const candidates = db.prepare('SELECT * FROM contacts WHERE name = ? ORDER BY id ASC').all(name);
  if (candidates.length === 0) return null;

  const connected = hydrateRows(candidates);
  const importedAny = new Set(
    methods
      .filter((method) => method.type === 'phone' || method.type === 'email')
      .map((method) => `${method.type}\u0000${method.value}`),
  );

  // 只有微信/QQ/地址等、没有任何电话或邮箱时，如果同名联系人唯一，则视为同一人，
  // 保证这类联系人导出再导入不会重复建人。
  if (importedAny.size === 0 && connected.length === 1) return connected[0];

  const importedIdentity = new Set(
    methods
      .filter((method) => (method.type === 'phone' || method.type === 'email') && method.is_primary)
      .map((method) => `${method.type}\u0000${method.value}`),
  );

  let fallback = null;
  for (const contact of connected) {
    const existingIdentity = new Set(
      contact.methods
        .filter((method) => (method.type === 'phone' || method.type === 'email') && method.is_primary)
        .map((method) => `${method.type}\u0000${method.value}`),
    );
    if ([...importedIdentity].some((key) => existingIdentity.has(key))) return contact;

    if (!fallback) {
      const existingAny = new Set(
        contact.methods
          .filter((method) => method.type === 'phone' || method.type === 'email')
          .map((method) => `${method.type}\u0000${method.value}`),
      );
      if ([...importedAny].some((key) => existingAny.has(key))) fallback = contact;
    }
  }
  return fallback;
}

/**
 * 合并一行导入数据：补全空字段、追加缺失联系方式、收藏取并集。
 * 若没有任何实际变化则返回 changed:false，导入统计中计为 skipped。
 */
export function mergeImportedContact(id, data) {
  const existing = getContact(id);
  if (!existing) return { contact: null, changed: false };

  const company = existing.company || data.company || '';
  const note = existing.note || data.note || '';
  const bookmarked = existing.bookmarked || Boolean(data.bookmarked);
  const methods = data.methods || [];

  const existingKeys = new Set(existing.methods.map((method) => `${method.type}\u0000${method.value}`));
  const primaryTypes = new Set(
    existing.methods.filter((method) => method.is_primary).map((method) => method.type),
  );

  const toAdd = [];
  for (const method of methods) {
    const key = `${method.type}\u0000${method.value}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);

    let isPrimary = Boolean(method.is_primary);
    if (isPrimary && primaryTypes.has(method.type)) isPrimary = false;
    if (isPrimary) primaryTypes.add(method.type);

    toAdd.push({
      type: method.type,
      value: method.value,
      label: method.label || '',
      is_primary: isPrimary,
    });
  }

  const changed = company !== existing.company
    || note !== existing.note
    || bookmarked !== existing.bookmarked
    || toAdd.length > 0;
  if (!changed) return { contact: existing, changed: false };

  const timestamp = nowIso();
  transaction(() => {
    db.prepare(
      `UPDATE contacts
          SET company = ?, note = ?, bookmarked = ?, updated_at = ?
        WHERE id = ?`,
    ).run(company, note, bookmarked ? 1 : 0, timestamp, id);
    if (toAdd.length > 0) insertMethods(id, toAdd);
  });

  return { contact: getContact(id), changed: true };
}

/** seed 脚本使用：清空联系人；联系方式由外键级联删除。 */
export function clearAllContacts() {
  transaction(() => {
    db.exec('DELETE FROM contact_methods');
    db.exec('DELETE FROM contacts');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('contacts', 'contact_methods')");
  });
}

/** 给导入错误等场景复用严格的字段校验（保持与 API 一致）。 */
export function validateImportedFields({ name, company, note, methods }) {
  const normalizedName = normalizeText(name, '姓名', { max: 100, required: true });
  const normalizedCompany = normalizeText(company, '公司', { max: 100 });
  const normalizedNote = normalizeText(note, '备注', { max: 2000 });
  const normalizedMethods = normalizeMethods(methods || []);
  return { name: normalizedName, company: normalizedCompany, note: normalizedNote, methods: normalizedMethods };
}


