const API = '/api';

const TYPE_META = {
  phone: { label: '电话', icon: 'i-phone' },
  email: { label: '邮箱', icon: 'i-mail' },
  wechat: { label: '微信', icon: 'i-wechat' },
  qq: { label: 'QQ', icon: 'i-qq' },
  address: { label: '地址', icon: 'i-address' },
  other: { label: '其他', icon: 'i-other' },
};

const TYPE_ORDER = ['phone', 'email', 'wechat', 'qq', 'address', 'other'];
const AVATAR_CLASSES = ['avatar-0', 'avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5'];
const TOAST_ICONS = { success: 'i-check', error: 'i-alert', info: 'i-info' };

const state = {
  contacts: [],
  total: 0,
  stats: { contacts: 0, bookmarked: 0, methods: 0, byType: {} },
  filters: { q: '', bookmarked: false, sort: 'name' },
  editingId: null,
  requestSeq: 0,
};

let emptyMode = 'add';
let searchTimer = null;
let modalCloseTimer = null;
const pendingStars = new Set();

const $ = (selector) => document.querySelector(selector);

const els = {
  statContacts: $('#statContacts'),
  statBookmarked: $('#statBookmarked'),
  statMethods: $('#statMethods'),
  countAll: $('#countAll'),
  countFav: $('#countFav'),
  searchInput: $('#searchInput'),
  searchClear: $('#searchClear'),
  sortSelect: $('#sortSelect'),
  templateBtn: $('#templateBtn'),
  exportBtn: $('#exportBtn'),
  importBtn: $('#importBtn'),
  importInput: $('#importInput'),
  importResult: $('#importResult'),
  listMeta: $('#listMeta'),
  loading: $('#loading'),
  contactList: $('#contactList'),
  emptyState: $('#emptyState'),
  emptyTitle: $('#emptyTitle'),
  emptyText: $('#emptyText'),
  emptyAction: $('#emptyAction'),
  fabAdd: $('#fabAdd'),
  modalOverlay: $('#modalOverlay'),
  modalTitle: $('#modalTitle'),
  modalSubtitle: $('#modalSubtitle'),
  modalClose: $('#modalClose'),
  contactForm: $('#contactForm'),
  nameInput: $('#nameInput'),
  companyInput: $('#companyInput'),
  noteInput: $('#noteInput'),
  bookmarkInput: $('#bookmarkInput'),
  methodRows: $('#methodRows'),
  addMethodBtn: $('#addMethodBtn'),
  cancelBtn: $('#cancelBtn'),
  saveBtn: $('#saveBtn'),
  toastStack: $('#toastStack'),
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#${name}"></use></svg>`;
}

function initialOf(name) {
  const characters = Array.from(String(name || '?').trim());
  return characters[0] || '?';
}

function avatarClass(id) {
  return AVATAR_CLASSES[Math.abs(Number(id) || 0) % AVATAR_CLASSES.length];
}

async function api(url, options = {}) {
  const config = { ...options, headers: { ...(options.headers || {}) } };
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    config.headers['Content-Type'] = 'application/json';
    config.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  const response = await fetch(url, config);
  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null);
  }

  if (!response.ok) {
    throw new Error(data?.error || `请求失败（HTTP ${response.status}）`);
  }
  return data;
}

function toast(message, type = 'success') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.innerHTML = `${icon(TOAST_ICONS[type] || 'i-info')}<div>${escapeHtml(message)}</div>`;
  els.toastStack.append(element);

  window.setTimeout(() => {
    element.classList.add('leaving');
    window.setTimeout(() => element.remove(), 220);
  }, type === 'error' ? 4200 : 2800);
}

function setStat(element, value) {
  const text = String(value);
  if (element.textContent === text) return;
  element.textContent = text;
  element.classList.remove('bump');
  void element.offsetWidth;
  element.classList.add('bump');
}

function renderStats() {
  setStat(els.statContacts, state.stats.contacts);
  setStat(els.statBookmarked, state.stats.bookmarked);
  setStat(els.statMethods, state.stats.methods);
  els.countAll.textContent = String(state.stats.contacts);
  els.countFav.textContent = String(state.stats.bookmarked);
}

function renderListMeta() {
  if (state.filters.q) {
    els.listMeta.textContent = `搜索「${state.filters.q}」：${state.total} 位联系人`;
  } else if (state.filters.bookmarked) {
    els.listMeta.textContent = `收藏的联系人：${state.total} 位`;
  } else {
    els.listMeta.textContent = `共 ${state.total} 位联系人`;
  }
}

function methodRowHtml(method) {
  const meta = TYPE_META[method.type] || TYPE_META.other;
  const label = method.label || meta.label;
  return `
    <div class="method" title="${escapeHtml(method.value)}">
      <span class="method-icon type-${escapeHtml(method.type)}">${icon(meta.icon)}</span>
      <div class="method-body">
        <span class="method-label">${escapeHtml(label)}${method.is_primary ? '<span class="primary-dot" title="首选"></span>' : ''}</span>
        <span class="method-value">${escapeHtml(method.value)}</span>
      </div>
      <button class="copy-btn" type="button" data-action="copy" data-id="${method.contactId}" data-method-id="${method.id}" aria-label="复制${escapeHtml(meta.label)}" title="复制">${icon('i-copy')}</button>
    </div>`;
}

function contactCardHtml(contact, index) {
  const methods = contact.methods.map((method) => methodRowHtml({ ...method, contactId: contact.id })).join('');
  const starLabel = contact.bookmarked ? '取消收藏' : '收藏';
  return `
    <article class="card" style="--i:${index}">
      <div class="card-top">
        <div class="avatar ${avatarClass(contact.id)}" aria-hidden="true">${escapeHtml(initialOf(contact.name))}</div>
        <div class="card-title">
          <h3>${escapeHtml(contact.name)}${contact.bookmarked ? '<span class="bookmark-badge">收藏</span>' : ''}</h3>
          <p class="company">${escapeHtml(contact.company || '未填写公司')}</p>
        </div>
        <button class="fav-star ${contact.bookmarked ? 'active' : ''}" type="button" data-action="star" data-id="${contact.id}" aria-label="${starLabel}${escapeHtml(contact.name)}" aria-pressed="${contact.bookmarked}" title="${starLabel}">${icon('i-star')}</button>
      </div>
      <div class="methods">${methods || '<div class="no-methods">暂无联系方式</div>'}</div>
      <div class="card-foot">
        <span class="method-count">${contact.methods.length} 个联系方式</span>
        <div class="card-actions">
          <button class="text-btn" type="button" data-action="edit" data-id="${contact.id}">${icon('i-edit')}编辑</button>
          <button class="text-btn danger" type="button" data-action="delete" data-id="${contact.id}">${icon('i-trash')}删除</button>
        </div>
      </div>
    </article>`;
}

function renderEmptyState() {
  if (state.contacts.length > 0) {
    els.emptyState.hidden = true;
    els.contactList.hidden = false;
    return;
  }

  const hasActiveFilters = Boolean(state.filters.q) || state.filters.bookmarked;
  els.contactList.hidden = true;
  els.emptyState.hidden = false;

  if (state.stats.contacts === 0 && !hasActiveFilters) {
    emptyMode = 'add';
    els.emptyTitle.textContent = '通讯录还是空的';
    els.emptyText.textContent = '添加第一位联系人，开始整理你的电话、邮箱和社交账号。';
    els.emptyAction.innerHTML = `${icon('i-plus')}新增联系人`;
  } else {
    emptyMode = 'reset';
    els.emptyTitle.textContent = '没有找到匹配的联系人';
    els.emptyText.textContent = state.filters.q
      ? '换一个关键词试试，或清空搜索条件重新查看全部联系人。'
      : '当前还没有收藏的联系人，去全部列表点亮星标吧。';
    els.emptyAction.innerHTML = `${icon('i-refresh')}清空筛选`;
  }
}

function renderContacts() {
  els.contactList.innerHTML = state.contacts
    .map((contact, index) => contactCardHtml(contact, index))
    .join('');
  renderEmptyState();
}

function render() {
  renderStats();
  renderContacts();
  renderListMeta();
}

function syncFilterUI() {
  document.querySelectorAll('.seg-btn').forEach((button) => {
    const isBookmarked = button.dataset.filter === 'bookmarked';
    button.classList.toggle('active', isBookmarked === state.filters.bookmarked);
  });
  els.sortSelect.value = state.filters.sort;
}

async function loadContacts() {
  const sequence = ++state.requestSeq;
  if (state.contacts.length === 0) els.loading.hidden = false;

  try {
    const params = new URLSearchParams();
    if (state.filters.q) params.set('q', state.filters.q);
    if (state.filters.bookmarked) params.set('bookmarked', '1');
    params.set('sort', state.filters.sort);

    const data = await api(`${API}/contacts?${params.toString()}`);
    if (sequence !== state.requestSeq) return;

    state.contacts = Array.isArray(data?.items) ? data.items : [];
    state.total = Number(data?.total) || 0;
    renderContacts();
    renderListMeta();
  } catch (error) {
    if (sequence === state.requestSeq) toast(error.message, 'error');
  } finally {
    if (sequence === state.requestSeq) els.loading.hidden = true;
  }
}

async function loadStats() {
  try {
    const data = await api(`${API}/stats`);
    state.stats = {
      contacts: Number(data?.contacts) || 0,
      bookmarked: Number(data?.bookmarked) || 0,
      methods: Number(data?.methods) || 0,
      byType: data?.byType || {},
    };
    renderStats();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function refreshAll() {
  await Promise.all([loadContacts(), loadStats()]);
}

async function toggleStar(id) {
  if (pendingStars.has(id)) return;
  const contact = state.contacts.find((item) => item.id === id);
  if (!contact) return;

  const previous = contact.bookmarked;
  const next = !previous;
  pendingStars.add(id);

  contact.bookmarked = next;
  state.stats.bookmarked = Math.max(0, state.stats.bookmarked + (next ? 1 : -1));
  renderContacts();
  renderStats();

  const starButton = els.contactList.querySelector(`.fav-star[data-id="${id}"]`);
  if (starButton) {
    starButton.classList.add('pop');
    window.setTimeout(() => starButton.classList.remove('pop'), 320);
  }

  try {
    await api(`${API}/contacts/${id}/bookmark`, { method: 'PATCH', body: { bookmarked: next } });
    if (state.filters.bookmarked && !next) {
      await loadContacts();
    } else {
      renderContacts();
    }
    await loadStats();
    toast(next ? '已加入收藏' : '已取消收藏');
  } catch (error) {
    contact.bookmarked = previous;
    state.stats.bookmarked = Math.max(0, state.stats.bookmarked + (next ? -1 : 1));
    renderContacts();
    renderStats();
    toast(error.message, 'error');
  } finally {
    pendingStars.delete(id);
  }
}

async function removeContact(id) {
  const contact = state.contacts.find((item) => item.id === id);
  if (!contact) return;
  const confirmed = window.confirm(`确定删除联系人「${contact.name}」吗？\n该联系人的所有联系方式也会一并删除。`);
  if (!confirmed) return;

  try {
    await api(`${API}/contacts/${id}`, { method: 'DELETE' });
    toast('联系人已删除');
    await refreshAll();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 继续尝试兼容方案
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('复制失败，请手动选择文本复制');
}

async function handleCopy(button, contactId, methodId) {
  const contact = state.contacts.find((item) => item.id === contactId);
  const method = contact?.methods.find((item) => item.id === methodId);
  if (!method) return;

  try {
    await copyText(method.value);
    button.classList.add('copied');
    button.innerHTML = icon('i-check');
    toast(`${TYPE_META[method.type]?.label || '内容'}已复制`);
    window.setTimeout(() => {
      button.classList.remove('copied');
      button.innerHTML = icon('i-copy');
    }, 1500);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function addMethodRow(method = { type: 'phone', value: '', label: '', is_primary: false }, focus = false) {
  const row = document.createElement('div');
  row.className = 'method-row';
  row.innerHTML = `
    <select class="method-type" aria-label="联系方式类型">
      ${TYPE_ORDER.map((type) => `<option value="${type}">${TYPE_META[type].label}</option>`).join('')}
    </select>
    <input class="method-value" type="text" maxlength="200" placeholder="号码 / 账号 / 地址" aria-label="联系方式内容">
    <input class="method-label" type="text" maxlength="50" placeholder="标签（可选）" aria-label="联系方式标签">
    <label class="primary-check"><input class="method-primary" type="checkbox">首选</label>
    <button class="remove-method" type="button" aria-label="删除这一行" title="删除这一行">${icon('i-trash')}</button>
  `;

  row.querySelector('.method-type').value = TYPE_META[method.type] ? method.type : 'phone';
  row.querySelector('.method-value').value = method.value || '';
  row.querySelector('.method-label').value = method.label || '';
  row.querySelector('.method-primary').checked = Boolean(method.is_primary);

  row.querySelector('.remove-method').addEventListener('click', () => {
    row.remove();
    if (els.methodRows.children.length === 0) addMethodRow();
  });

  els.methodRows.append(row);
  if (focus) row.querySelector('.method-value').focus();
}

function openModal(contact = null) {
  if (modalCloseTimer) {
    window.clearTimeout(modalCloseTimer);
    modalCloseTimer = null;
  }

  state.editingId = contact ? contact.id : null;
  els.contactForm.reset();
  els.nameInput.classList.remove('invalid');
  els.nameInput.value = contact?.name || '';
  els.companyInput.value = contact?.company || '';
  els.noteInput.value = contact?.note || '';
  els.bookmarkInput.checked = Boolean(contact?.bookmarked);
  els.methodRows.innerHTML = '';

  if (contact && contact.methods.length > 0) {
    contact.methods.forEach((method) => addMethodRow(method));
  } else {
    addMethodRow();
  }

  els.modalTitle.textContent = contact ? '编辑联系人' : '新增联系人';
  els.modalSubtitle.textContent = contact ? '修改基本信息与联系方式' : '填写基本信息与联系方式';
  els.saveBtn.textContent = contact ? '保存修改' : '保存联系人';

  els.modalOverlay.hidden = false;
  document.body.classList.add('modal-open');
  window.requestAnimationFrame(() => els.modalOverlay.classList.add('open'));
  window.setTimeout(() => els.nameInput.focus(), 50);
}

function closeModal() {
  if (els.modalOverlay.hidden) return;
  els.modalOverlay.classList.remove('open');
  document.body.classList.remove('modal-open');
  modalCloseTimer = window.setTimeout(() => {
    els.modalOverlay.hidden = true;
    modalCloseTimer = null;
  }, 190);
}

function resetFilters() {
  state.filters = { q: '', bookmarked: false, sort: 'name' };
  els.searchInput.value = '';
  els.searchClear.hidden = true;
  syncFilterUI();
  loadContacts();
}

function downloadFile(url) {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

function showImportLoading(fileName) {
  els.importResult.hidden = false;
  els.importResult.className = 'import-result';
  els.importResult.innerHTML = `
    <div class="import-result-icon"><span class="spinner"></span></div>
    <div class="import-result-body">
      <p class="import-result-title">正在导入 Excel…</p>
      <p class="import-result-sub">${escapeHtml(fileName)}</p>
    </div>`;
}

function showImportError(message, fileName) {
  els.importResult.hidden = false;
  els.importResult.className = 'import-result error';
  els.importResult.innerHTML = `
    <div class="import-result-icon">${icon('i-alert')}</div>
    <div class="import-result-body">
      <p class="import-result-title">导入失败</p>
      <p class="import-result-sub">${escapeHtml(fileName)} · ${escapeHtml(message)}</p>
    </div>
    <button class="import-result-close" type="button" aria-label="关闭导入结果">${icon('i-close')}</button>`;
}

function showImportResult(result, fileName) {
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  const hasErrors = errors.length > 0;
  const shown = errors.slice(0, 5);
  const rest = errors.length - shown.length;

  const errorList = hasErrors
    ? `<ul class="import-errors">${shown
      .map((item) => `<li>第 ${escapeHtml(item.row)} 行：${escapeHtml(item.reason)}</li>`)
      .join('')}${rest > 0 ? `<li>…另有 ${rest} 条错误未显示</li>` : ''}</ul>`
    : '';

  els.importResult.hidden = false;
  els.importResult.className = `import-result ${hasErrors ? 'warning' : 'success'}`;
  els.importResult.innerHTML = `
    <div class="import-result-icon">${icon(hasErrors ? 'i-alert' : 'i-check')}</div>
    <div class="import-result-body">
      <p class="import-result-title">导入完成</p>
      <p class="import-result-sub">${escapeHtml(fileName)} · 已处理 ${result.created + result.updated + result.skipped} 行</p>
      <div class="import-counts">
        <span class="created">新建 <strong>${result.created}</strong> 位</span>
        <span class="updated">更新 <strong>${result.updated}</strong> 位</span>
        <span class="skipped">跳过 <strong>${result.skipped}</strong> 行</span>
      </div>
      ${errorList}
    </div>
    <button class="import-result-close" type="button" aria-label="关闭导入结果">${icon('i-close')}</button>`;
}

async function importFile(file) {
  showImportLoading(file.name);
  const formData = new FormData();
  formData.append('file', file);

  try {
    const result = await api(`${API}/import`, { method: 'POST', body: formData });
    showImportResult(result, file.name);
    toast(`导入完成：新建 ${result.created} 位，更新 ${result.updated} 位`);
    await refreshAll();
  } catch (error) {
    showImportError(error.message, file.name);
    toast(error.message, 'error');
  }
}

// ---------- 事件绑定 ----------

els.contactList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const id = Number(button.dataset.id);
  const action = button.dataset.action;

  if (action === 'star') {
    toggleStar(id);
  } else if (action === 'edit') {
    const contact = state.contacts.find((item) => item.id === id);
    if (contact) openModal(contact);
  } else if (action === 'delete') {
    removeContact(id);
  } else if (action === 'copy') {
    handleCopy(button, id, Number(button.dataset.methodId));
  }
});

els.searchInput.addEventListener('input', () => {
  state.filters.q = els.searchInput.value.trim();
  els.searchClear.hidden = els.searchInput.value.length === 0;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(loadContacts, 220);
});

els.searchClear.addEventListener('click', () => {
  els.searchInput.value = '';
  state.filters.q = '';
  els.searchClear.hidden = true;
  els.searchInput.focus();
  loadContacts();
});

document.querySelectorAll('.seg-btn').forEach((button) => {
  button.addEventListener('click', () => {
    const bookmarked = button.dataset.filter === 'bookmarked';
    if (state.filters.bookmarked === bookmarked) return;
    state.filters.bookmarked = bookmarked;
    syncFilterUI();
    loadContacts();
  });
});

els.sortSelect.addEventListener('change', () => {
  state.filters.sort = els.sortSelect.value;
  loadContacts();
});

els.templateBtn.addEventListener('click', () => downloadFile(`${API}/export?template=1`));
els.exportBtn.addEventListener('click', () => downloadFile(`${API}/export`));

els.importBtn.addEventListener('click', () => els.importInput.click());
els.importInput.addEventListener('change', () => {
  const file = els.importInput.files?.[0];
  els.importInput.value = '';
  if (!file) return;

  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    toast('只支持 .xlsx 或 .xls 文件', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    toast('文件大小不能超过 5MB', 'error');
    return;
  }
  importFile(file);
});

els.importResult.addEventListener('click', (event) => {
  if (event.target.closest('.import-result-close')) els.importResult.hidden = true;
});

els.fabAdd.addEventListener('click', () => openModal());
els.emptyAction.addEventListener('click', () => {
  if (emptyMode === 'add') openModal();
  else resetFilters();
});

els.modalClose.addEventListener('click', closeModal);
els.cancelBtn.addEventListener('click', closeModal);
els.modalOverlay.addEventListener('mousedown', (event) => {
  if (event.target === els.modalOverlay) closeModal();
});

els.addMethodBtn.addEventListener('click', () => addMethodRow({ type: 'phone', value: '', label: '', is_primary: false }, true));

els.contactForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  els.nameInput.classList.remove('invalid');

  const name = els.nameInput.value.trim();
  if (!name) {
    els.nameInput.classList.add('invalid');
    els.nameInput.focus();
    toast('请填写联系人姓名', 'error');
    return;
  }

  const methods = [];
  let rowError = '';
  els.methodRows.querySelectorAll('.method-row').forEach((row) => {
    const type = row.querySelector('.method-type').value;
    const value = row.querySelector('.method-value').value.trim();
    const label = row.querySelector('.method-label').value.trim();
    const isPrimary = row.querySelector('.method-primary').checked;

    if (!value) {
      if (label || isPrimary) rowError = rowError || '请填写联系方式内容，或删除空行';
      return;
    }
    if (value.length > 200) {
      rowError = rowError || '联系方式长度不能超过 200 个字符';
      return;
    }
    methods.push({ type, value, label, is_primary: isPrimary });
  });

  if (rowError) {
    toast(rowError, 'error');
    return;
  }

  const editingId = state.editingId;
  const payload = {
    name,
    company: els.companyInput.value.trim(),
    note: els.noteInput.value.trim(),
    bookmarked: els.bookmarkInput.checked,
    methods,
  };

  const originalText = els.saveBtn.textContent;
  els.saveBtn.disabled = true;
  els.saveBtn.textContent = '保存中…';

  try {
    if (editingId) {
      await api(`${API}/contacts/${editingId}`, { method: 'PUT', body: payload });
    } else {
      await api(`${API}/contacts`, { method: 'POST', body: payload });
    }
    closeModal();
    toast(editingId ? '联系人已更新' : '联系人已新增');
    await refreshAll();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = originalText;
  }
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const isTyping = target instanceof HTMLElement && (
    target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
    || target.isContentEditable
  );

  if (event.key === 'Escape' && !els.modalOverlay.hidden) {
    closeModal();
    return;
  }
  if (event.key === '/' && !isTyping && els.modalOverlay.hidden) {
    event.preventDefault();
    els.searchInput.focus();
  }
});

// ---------- 启动 ----------


/* ---------- 主题切换 ---------- */

const THEME_KEY = 'address-book-theme';
const THEMES = ['classic', 'paper', 'midnight'];

function applyTheme(name) {
  const theme = THEMES.includes(name) ? name : 'classic';
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) { /* 忽略：无痕模式写不进去也不影响本次生效 */ }

  document.querySelectorAll('.theme-dot').forEach((dot) => {
    const isCurrent = dot.dataset.theme === theme;
    dot.classList.toggle('active', isCurrent);
    dot.setAttribute('aria-checked', isCurrent ? 'true' : 'false');
  });
}

document.querySelectorAll('.theme-dot').forEach((dot) => {
  dot.addEventListener('click', () => applyTheme(dot.dataset.theme));
});

applyTheme(document.documentElement.getAttribute('data-theme') || 'classic');

function init() {
  syncFilterUI();
  loadContacts();
  loadStats();
}

init();
