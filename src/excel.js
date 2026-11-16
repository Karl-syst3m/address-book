import ExcelJS from 'exceljs';
import { ApiError } from './errors.js';
import {
  createContact,
  exportAllContacts,
  findDuplicateContact,
  mergeImportedContact,
  validateImportedFields,
} from './contacts.js';

export const HEADERS = [
  '姓名', '公司', '收藏',
  '电话1', '电话2', '电话3',
  '邮箱1', '邮箱2', '邮箱3',
  '微信', 'QQ', '地址', '其他', '备注',
];

const COLUMN_WIDTHS = [12, 20, 8, 18, 18, 18, 26, 26, 26, 18, 14, 30, 30, 32];

const TYPE_CN_TO_KEY = {
  电话: 'phone',
  手机: 'phone',
  邮箱: 'email',
  电子邮件: 'email',
  微信: 'wechat',
  QQ: 'qq',
  qq: 'qq',
  地址: 'address',
  其他: 'other',
};

const FAVORITE_TRUE = new Set(['是', '1', 'true', 'yes']);

function cellText(cell) {
  if (!cell) return '';
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
  if (value.text !== undefined && value.text !== null) return String(value.text);
  if (value.formula !== undefined && value.result !== undefined && value.result !== null) {
    return String(value.result);
  }
  if (value.error) return '';
  return String(value);
}

function normalizeHeader(text) {
  return String(text || '').replace(/\uFEFF/g, '').replace(/\s+/g, '').trim();
}

/** 把一个联系人拆成固定 14 列；同一类型超过列位上限的内容合并进「其他」列。 */
function contactToRow(contact) {
  const methods = [...contact.methods].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id,
  );
  const byType = { phone: [], email: [], wechat: [], qq: [], address: [], other: [] };
  for (const method of methods) {
    if (byType[method.type]) byType[method.type].push(method.value);
  }

  const extras = [];
  const phones = byType.phone.slice(0, 3);
  byType.phone.slice(3).forEach((value) => extras.push(`电话:${value}`));
  const emails = byType.email.slice(0, 3);
  byType.email.slice(3).forEach((value) => extras.push(`邮箱:${value}`));

  const wechat = byType.wechat[0] || '';
  byType.wechat.slice(1).forEach((value) => extras.push(`微信:${value}`));

  const qq = byType.qq[0] || '';
  byType.qq.slice(1).forEach((value) => extras.push(`QQ:${value}`));

  const address = byType.address[0] || '';
  byType.address.slice(1).forEach((value) => extras.push(`地址:${value}`));

  byType.other.forEach((value) => extras.push(`其他:${value}`));

  return [
    contact.name,
    contact.company || '',
    contact.bookmarked ? '是' : '',
    phones[0] || '',
    phones[1] || '',
    phones[2] || '',
    emails[0] || '',
    emails[1] || '',
    emails[2] || '',
    wechat,
    qq,
    address,
    extras.join('; '),
    contact.note || '',
  ];
}

function styleWorksheet(worksheet) {
  worksheet.columns = HEADERS.map((header, index) => ({
    header,
    width: COLUMN_WIDTHS[index],
  }));

  const headerRow = worksheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { name: '微软雅黑', size: 11, bold: true, color: { argb: 'FF1F2937' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  });

  worksheet.autoFilter = { from: 'A1', to: 'N1' };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function styleDataRows(worksheet) {
  const rowCount = worksheet.rowCount;
  for (let rowNumber = 2; rowNumber <= rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: '微软雅黑', size: 10.5, color: { argb: 'FF334155' } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: columnNumber === 3 ? 'center' : 'left',
        wrapText: columnNumber === 13 || columnNumber === 14,
      };
      if (rowNumber % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    });
  }
}

async function workbookToBuffer(workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

export async function buildExportBuffer() {
  const contacts = exportAllContacts();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '通讯录 Address Book';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('通讯录', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  styleWorksheet(worksheet);

  for (const contact of contacts) {
    worksheet.addRow(contactToRow(contact));
  }
  styleDataRows(worksheet);

  return { buffer: await workbookToBuffer(workbook), count: contacts.length };
}

export async function buildTemplateBuffer() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '通讯录 Address Book';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('通讯录', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  styleWorksheet(worksheet);

  worksheet.addRow([
    '张三',
    '示例科技有限公司',
    '是',
    '13800138000',
    '010-88886666',
    '',
    'zhangsan@example.com',
    '',
    '',
    'zhangsan_wx',
    '10001',
    '北京市朝阳区示例路 1 号',
    '其他:备用号码 13900139000',
    '这是一行示例数据，导入前可删除或覆盖。',
  ]);
  styleDataRows(worksheet);

  return workbookToBuffer(workbook);
}

function parseFavorite(text) {
  return FAVORITE_TRUE.has(String(text || '').trim().toLowerCase());
}

/** 解析「其他」列：`电话:139...; 微信:abc`，无法识别的前缀按 other 原样保留。 */
function parseOtherValue(text, addMethod) {
  const segments = String(text || '')
    .split(/[;；]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const colonIndex = segment.indexOf(':');
    if (colonIndex > 0) {
      const prefix = segment.slice(0, colonIndex).trim();
      const mapped = TYPE_CN_TO_KEY[prefix] || TYPE_CN_TO_KEY[prefix.toLowerCase()];
      if (mapped) {
        addMethod(mapped, segment.slice(colonIndex + 1));
        continue;
      }
    }
    addMethod('other', segment);
  }
}

/**
 * 解析 Excel 并逐行导入。格式错误（如缺表头）抛 400；
 * 单行校验失败只计入 errors/skipped，不阻断其他行。
 */
export async function importWorkbook(buffer) {
  if (!buffer || buffer.length === 0) throw new ApiError(400, '上传的 Excel 文件为空');

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new ApiError(400, '无法解析 Excel 文件，请使用 .xlsx 格式（旧版 .xls 请先另存为 .xlsx）');
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new ApiError(400, 'Excel 文件中没有工作表');

  const headerRow = worksheet.getRow(1);
  const columns = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const header = normalizeHeader(cellText(cell));
    if (header && columns[header] === undefined) columns[header] = columnNumber;
  });

  if (!columns['姓名']) {
    throw new ApiError(400, '缺少「姓名」列，请使用模板格式（第一行必须是表头）');
  }

  const result = { created: 0, updated: 0, skipped: 0, errors: [] };
  const totalRows = worksheet.rowCount;

  for (let rowNumber = 2; rowNumber <= totalRows; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const read = (header) => {
      const column = columns[header];
      if (!column) return '';
      return cellText(row.getCell(column)).trim();
    };

    const values = {
      name: read('姓名'),
      company: read('公司'),
      favorite: read('收藏'),
      phone1: read('电话1'),
      phone2: read('电话2'),
      phone3: read('电话3'),
      email1: read('邮箱1'),
      email2: read('邮箱2'),
      email3: read('邮箱3'),
      wechat: read('微信'),
      qq: read('QQ'),
      address: read('地址'),
      other: read('其他'),
      note: read('备注'),
    };

    const isBlank = Object.values(values).every((value) => !value);
    if (isBlank) continue;

    try {
      if (!values.name) throw new ApiError(400, '姓名不能为空');
      if (values.name.length > 100) throw new ApiError(400, '姓名长度不能超过 100 个字符');
      if (values.company.length > 100) throw new ApiError(400, '公司长度不能超过 100 个字符');

      const methods = [];
      const seen = new Set();
      const addMethod = (type, rawValue) => {
        const value = String(rawValue || '').trim();
        if (!value) return;
        if (value.length > 200) throw new ApiError(400, '联系方式长度不能超过 200 个字符');
        const key = `${type}\u0000${value}`;
        if (seen.has(key)) return;
        seen.add(key);
        methods.push({ type, value, label: '', is_primary: false });
      };

      let phoneAdded = false;
      for (const phone of [values.phone1, values.phone2, values.phone3]) {
        if (phone) {
          addMethod('phone', phone);
          if (!phoneAdded) {
            const last = methods[methods.length - 1];
            if (last && last.type === 'phone') last.is_primary = true;
            phoneAdded = true;
          }
        }
      }

      let emailAdded = false;
      for (const email of [values.email1, values.email2, values.email3]) {
        if (email) {
          addMethod('email', email);
          if (!emailAdded) {
            const last = methods[methods.length - 1];
            if (last && last.type === 'email') last.is_primary = true;
            emailAdded = true;
          }
        }
      }

      addMethod('wechat', values.wechat);
      addMethod('qq', values.qq);
      addMethod('address', values.address);
      parseOtherValue(values.other, addMethod);

      const normalized = validateImportedFields({
        name: values.name,
        company: values.company,
        note: values.note,
        methods,
      });

      const existing = findDuplicateContact(normalized.name, normalized.methods);
      const favoriteText = String(values.favorite ?? '').trim();
      if (existing) {
        const merged = mergeImportedContact(existing.id, {
          company: normalized.company,
          note: normalized.note,
          // 收藏列为空时视为「文件未表态」，保留原有收藏状态，避免误清除
          bookmarked: favoriteText ? parseFavorite(favoriteText) : undefined,
          methods: normalized.methods,
        });
        if (merged.changed) result.updated += 1;
        else result.skipped += 1;
      } else {
        createContact({
          name: normalized.name,
          company: normalized.company,
          note: normalized.note,
          bookmarked: parseFavorite(values.favorite),
          methods: normalized.methods,
        });
        result.created += 1;
      }
    } catch (error) {
      if (error instanceof ApiError) {
        result.skipped += 1;
        result.errors.push({ row: rowNumber, reason: error.message });
      } else {
        console.error('[import] 未预期的错误：', error);
        throw error;
      }
    }
  }

  return result;
}
