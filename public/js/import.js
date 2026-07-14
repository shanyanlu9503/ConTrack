// import.js - 合同导入前端逻辑

let currentFileId = null;
let currentFileType = null;
let extractedData = null;

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', () => {
  initUploadZone();
  loadImportHistory();
});

function initUploadZone() {
  const zone = document.getElementById('upload-zone');
  if (!zone) return;
  const input = document.getElementById('file-input');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => {
    if (input.files.length > 0) handleFile(input.files[0]);
  });
}

// ==================== 步骤1: 上传文件 ====================

async function handleFile(file) {
  // 校验文件大小
  if (file.size > 20 * 1024 * 1024) {
    alert('文件大小不能超过 20MB');
    return;
  }

  const status = document.getElementById('upload-status');
  status.style.display = 'block';
  status.textContent = '正在上传并解析文件...';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/import/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) { alert('上传失败: ' + (data.error || '未知错误')); status.style.display = 'none'; return; }

    currentFileId = data.id;
    currentFileType = data.file_type;

    status.textContent = '✓ 文件解析完成';
    status.style.background = '#f6ffed';
    status.style.borderColor = '#b7eb8f';
    status.style.color = '#52c41a';

    // 显示文件信息
    const typeNames = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel' };
    document.getElementById('file-info').innerHTML =
      '文件名: <strong>' + data.original_name + '</strong> &nbsp;|&nbsp; ' +
      '类型: <strong>' + (typeNames[data.file_type] || data.file_type) + '</strong> &nbsp;|&nbsp; ' +
      '大小: <strong>' + formatFileSize(data.file_size) + '</strong>';

    // 显示文本预览
    const preview = document.getElementById('raw-text-preview');
    preview.textContent = (data.raw_text || '(未能提取文本内容，可能是扫描版PDF)').substring(0, 5000);

    document.getElementById('file-preview').style.display = 'block';
    updateStep(1);
  } catch (err) {
    status.textContent = '上传失败: ' + err.message;
    status.style.background = '#fff1f0';
    status.style.borderColor = '#ffa39e';
    status.style.color = '#ff4d4f';
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ==================== 步骤2-3: 提取 & 预览 ====================

async function goToExtract() {
  if (!currentFileId) return;

  // 切换面板
  document.getElementById('import-upload-panel').style.display = 'none';
  document.getElementById('import-extract-panel').style.display = 'block';
  document.getElementById('extract-loading').style.display = 'block';
  document.getElementById('extract-result').style.display = 'none';
  updateStep(2);

  try {
    const res = await fetch('/api/import/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: currentFileId })
    });
    const data = await res.json();
    if (!res.ok) { alert('提取失败: ' + (data.error || '未知错误')); return; }

    extractedData = data;
    populateExtractForm(data);

    document.getElementById('extract-loading').style.display = 'none';
    document.getElementById('extract-result').style.display = 'block';
    updateStep(3);
  } catch (err) {
    alert('提取失败: ' + err.message);
    goToUpload();
  }
}

function populateExtractForm(data) {
  // 合同信息
  if (data.contract) {
    document.getElementById('ext-contract-no').value = data.contract.contract_no || '';
    document.getElementById('ext-contract-type').value = data.contract.contract_type || 'sales';
    document.getElementById('ext-sign-date').value = data.contract.sign_date || '';
    document.getElementById('ext-total-amount').value = data.contract.total_amount || 0;
    document.getElementById('ext-tax-amount').value = data.contract.tax_amount || 0;
  }

  // 甲方 = parties[0]
  if (data.parties && data.parties.length >= 1) {
    const partyA = data.parties[0];
    populatePartyFields('a', partyA);
    document.getElementById('ext-party-a-side').value = partyA.side || 'buyer';
  }

  // 乙方 = parties[1]
  if (data.parties && data.parties.length >= 2) {
    const partyB = data.parties[1];
    populatePartyFields('b', partyB);
    document.getElementById('ext-party-b-side').value = partyB.side || 'seller';
  }

  // 产品明细
  const tbody = document.getElementById('extract-items-body');
  if (data.items && data.items.length > 0) {
    tbody.innerHTML = data.items.map((item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><input type="text" value="${escHtml(item.product_name || '')}" class="ext-item-name"></td>
        <td><input type="text" value="${escHtml(item.specification || '')}" class="ext-item-spec"></td>
        <td><input type="number" step="0.001" value="${item.quantity || 0}" class="ext-item-qty" oninput="recalcExtractItem(this)"></td>
        <td><input type="text" value="${escHtml(item.unit || '吨')}" class="ext-item-unit"></td>
        <td><input type="number" step="0.01" value="${item.unit_price || 0}" class="ext-item-price" oninput="recalcExtractItem(this)"></td>
        <td><input type="number" step="0.01" value="${item.amount || 0}" class="ext-item-amount" readonly></td>
        <td><input type="number" step="0.1" value="${item.tax_rate || 13}" class="ext-item-tax-rate" oninput="recalcExtractItem(this)"></td>
        <td><input type="number" step="0.01" value="${item.tax_amount || 0}" class="ext-item-tax-amount" readonly></td>
      </tr>
    `).join('');
    recalcAllExtractItems();
  } else {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#999">未提取到产品明细</td></tr>';
  }

  // 加载本公司主体
  loadOurCompaniesForImport();

  // PDF 文件禁用模板按钮
  const btnTemplate = document.getElementById('btn-create-template');
  if (currentFileType === 'pdf') {
    btnTemplate.disabled = true;
    btnTemplate.title = 'PDF 不支持自动生成模板';
    btnTemplate.style.opacity = '0.5';
  } else {
    btnTemplate.disabled = false;
    btnTemplate.title = '';
    btnTemplate.style.opacity = '1';
  }
}

function populatePartyFields(prefix, party) {
  document.getElementById('ext-' + prefix + '-name').value = party.name || '';
  document.getElementById('ext-' + prefix + '-legal').value = party.legal_representative || '';
  document.getElementById('ext-' + prefix + '-agent').value = party.agent || '';
  document.getElementById('ext-' + prefix + '-phone').value = party.phone || '';
  document.getElementById('ext-' + prefix + '-address').value = party.address || '';
  document.getElementById('ext-' + prefix + '-tax').value = party.tax_number || '';
  document.getElementById('ext-' + prefix + '-bank').value = party.bank || '';
  document.getElementById('ext-' + prefix + '-account').value = party.bank_account || '';
}

async function loadOurCompaniesForImport() {
  try {
    const res = await fetch('/api/our-companies');
    const companies = await res.json();
    const select = document.getElementById('ext-our-company');
    select.innerHTML = companies.map(c =>
      '<option value="' + c.id + '">' + c.name + '</option>'
    ).join('');
    if (companies.length === 0) {
      select.innerHTML = '<option value="">请先在"本公司主体"中添加</option>';
    }
  } catch (e) {
    document.getElementById('ext-our-company').innerHTML = '<option value="">加载失败</option>';
  }
}

// ==================== 步骤4: 保存 ====================

async function saveImportedContract() {
  if (!currentFileId) return;

  updateStep(4);

  // 收集表单数据
  const contractType = document.getElementById('ext-contract-type').value;

  const partyA = {
    role: '甲方',
    side: document.getElementById('ext-party-a-side').value,
    name: document.getElementById('ext-a-name').value,
    legal_representative: document.getElementById('ext-a-legal').value,
    agent: document.getElementById('ext-a-agent').value,
    phone: document.getElementById('ext-a-phone').value,
    address: document.getElementById('ext-a-address').value,
    tax_number: document.getElementById('ext-a-tax').value,
    bank: document.getElementById('ext-a-bank').value,
    bank_account: document.getElementById('ext-a-account').value
  };

  const partyB = {
    role: '乙方',
    side: document.getElementById('ext-party-b-side').value,
    name: document.getElementById('ext-b-name').value,
    legal_representative: document.getElementById('ext-b-legal').value,
    agent: document.getElementById('ext-b-agent').value,
    phone: document.getElementById('ext-b-phone').value,
    address: document.getElementById('ext-b-address').value,
    tax_number: document.getElementById('ext-b-tax').value,
    bank: document.getElementById('ext-b-bank').value,
    bank_account: document.getElementById('ext-b-account').value
  };

  const items = [];
  document.querySelectorAll('#extract-items-body tr').forEach(tr => {
    const nameEl = tr.querySelector('.ext-item-name');
    if (!nameEl) return;
    items.push({
      product_name: nameEl.value,
      specification: tr.querySelector('.ext-item-spec').value,
      quantity: parseFloat(tr.querySelector('.ext-item-qty').value) || 0,
      unit: tr.querySelector('.ext-item-unit').value || '吨',
      unit_price: parseFloat(tr.querySelector('.ext-item-price').value) || 0,
      amount: parseFloat(tr.querySelector('.ext-item-amount').value) || 0,
      tax_rate: parseFloat(tr.querySelector('.ext-item-tax-rate').value) || 13,
      tax_amount: parseFloat(tr.querySelector('.ext-item-tax-amount').value) || 0,
      remark: ''
    });
  });

  const ourCompanyEl = document.getElementById('ext-our-company');
  const ourCompanyId = ourCompanyEl.value ? parseInt(ourCompanyEl.value) : null;

  const payload = {
    file_id: currentFileId,
    parties: [partyA, partyB],
    contract: {
      contract_no: document.getElementById('ext-contract-no').value,
      contract_type: contractType,
      sign_date: document.getElementById('ext-sign-date').value,
      total_amount: parseFloat(document.getElementById('ext-total-amount').value) || 0,
      tax_amount: parseFloat(document.getElementById('ext-tax-amount').value) || 0,
      remark: ''
    },
    items: items,
    our_company_id: ourCompanyId
  };

  try {
    const res = await fetch('/api/import/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) { alert('保存失败: ' + (result.error || '未知错误')); updateStep(3); return; }

    alert('✓ 合同导入成功！\n合同ID: ' + result.contract_id);
    loadImportHistory();
    // 跳转到合同管理 Tab
    const contractsTab = document.querySelector('.tab[data-tab="contracts"]');
    if (contractsTab) contractsTab.click();
    if (typeof loadContracts === 'function') loadContracts();
    if (typeof loadStats === 'function') loadStats();
  } catch (err) {
    alert('保存失败: ' + err.message);
    updateStep(3);
  }
}

// ==================== 模板创建 ====================

async function createTemplate() {
  if (!currentFileId || currentFileType === 'pdf') {
    alert('PDF 文件不支持自动生成模板');
    return;
  }

  const templateName = prompt('请输入模板名称：', '自动生成模板-' + new Date().toISOString().slice(0, 10));
  if (!templateName) return;

  try {
    const res = await fetch('/api/import/create-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_id: currentFileId,
        template_name: templateName,
        template_type: document.getElementById('ext-contract-type').value
      })
    });
    const result = await res.json();
    if (!res.ok) { alert('模板创建失败: ' + (result.error || '未知错误')); return; }

    let msg = '✓ 模板创建成功！\n模板名: ' + result.template_name;
    if (result.warning) msg += '\n⚠️ ' + result.warning;
    alert(msg);
  } catch (err) {
    alert('模板创建失败: ' + err.message);
  }
}

// ==================== 导入历史 ====================

async function loadImportHistory() {
  try {
    const res = await fetch('/api/import/history');
    const records = await res.json();
    const tbody = document.getElementById('import-history-table');
    if (!tbody) return;

    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">暂无导入记录</td></tr>';
      return;
    }

    const typeNames = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel' };
    const statusNames = { uploaded: '已上传', parsed: '已解析', extracted: '已提取', imported: '已导入' };
    const statusBadges = { uploaded: 'badge-uploaded', parsed: 'badge-parsed', extracted: 'badge-extracted', imported: 'badge-imported' };

    tbody.innerHTML = records.map(r => '<tr>' +
      '<td>' + r.original_name + '</td>' +
      '<td><span class="badge badge-secondary">' + (typeNames[r.file_type] || r.file_type) + '</span></td>' +
      '<td><span class="badge ' + (statusBadges[r.status] || '') + '">' + (statusNames[r.status] || r.status) + '</span></td>' +
      '<td>' + (r.created_at ? r.created_at.replace('T', ' ').substring(0, 19) : '-') + '</td>' +
      '<td class="action-btns"><button class="btn btn-danger btn-sm" onclick="deleteImportRecord(' + r.id + ')">删除</button></td>' +
      '</tr>').join('');
  } catch (e) {}
}

async function deleteImportRecord(id) {
  if (!confirm('确定要删除这条导入记录吗？')) return;
  try {
    await fetch('/api/import/history/' + id, { method: 'DELETE' });
    loadImportHistory();
  } catch (e) {}
}

// ==================== 导航辅助 ====================

function goToUpload() {
  document.getElementById('import-upload-panel').style.display = 'block';
  document.getElementById('import-extract-panel').style.display = 'none';
  updateStep(1);
}

function updateStep(step) {
  document.querySelectorAll('.import-steps .step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active', 'completed');
    if (s < step) el.classList.add('completed');
    if (s === step) el.classList.add('active');
  });
}

// ==================== 工具函数 ====================

function recalcExtractItem(inp) {
  const tr = inp.closest('tr');
  const qty = parseFloat(tr.querySelector('.ext-item-qty').value) || 0;
  const price = parseFloat(tr.querySelector('.ext-item-price').value) || 0;
  const taxRate = parseFloat(tr.querySelector('.ext-item-tax-rate').value) || 0;
  const amount = qty * price;
  tr.querySelector('.ext-item-amount').value = amount.toFixed(2);
  tr.querySelector('.ext-item-tax-amount').value = (amount * taxRate / 100).toFixed(2);
}

function recalcAllExtractItems() {
  document.querySelectorAll('#extract-items-body tr').forEach(tr => {
    const qtyEl = tr.querySelector('.ext-item-qty');
    if (qtyEl) recalcExtractItem(qtyEl);
  });
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
