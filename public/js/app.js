// app.js - 前端应用逻辑
const API_BASE = '';
let companiesCache = [];
let productsCache = [];
let rulesCache = [];

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadStats();
  loadCompanies();
  loadProducts();
  loadContracts();
  loadDeliveryOrders();
  loadRules();
  loadOurCompanies();
});

function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
      // 切换到导入 Tab 时刷新列表并重置步骤
      if (tab.dataset.tab === 'import') {
        if (typeof loadImportHistory === 'function') loadImportHistory();
        if (typeof goToUpload === 'function') goToUpload();
        // 重置上传状态
        const status = document.getElementById('upload-status');
        if (status) { status.style.display = 'none'; status.style.background = ''; status.style.borderColor = ''; status.style.color = ''; }
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';
        currentFileId = null;
        extractedData = null;
        document.getElementById('file-preview').style.display = 'none';
      }
    });
  });
}

async function api(url, options = {}) {
  try {
    const res = await fetch(API_BASE + url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  } catch (err) {
    alert('错误: ' + err.message);
    throw err;
  }
}

async function loadStats() {
  try {
    const stats = await api('/api/stats');
    document.getElementById('stat-companies').textContent = stats.companies;
    document.getElementById('stat-products').textContent = stats.products;
    document.getElementById('stat-contracts').textContent = stats.contracts;
    document.getElementById('stat-delivery').textContent = stats.delivery_orders;
    document.getElementById('stat-contract-amount').textContent = '¥' + formatMoney(stats.total_contract_amount);
    document.getElementById('stat-delivery-amount').textContent = '¥' + formatMoney(stats.total_delivery_amount);
  } catch (e) {}
}

function formatMoney(val) {
  if (!val) return '0.00';
  return Number(val).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadCompanies() {
  try {
    const type = document.getElementById('company-type-filter').value;
    const search = document.getElementById('company-search').value;
    let url = '/api/companies';
    if (type) url += '?type=' + type;
    companiesCache = await api(url);
    let filtered = companiesCache;
    if (search) filtered = companiesCache.filter(c => c.name.includes(search));
    const tbody = document.getElementById('companies-table');
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">暂无数据</td></tr>';
      return;
    }
    tbody.innerHTML = filtered.map(c => '<tr><td>'+c.name+'</td><td><span class="badge badge-'+c.type+'">'+(c.type==='customer'?'客户':'供应商')+'</span></td><td>'+(c.address||'-')+'</td><td>'+(c.legal_representative||c.agent||'-')+'</td><td>'+(c.phone||'-')+'</td><td class="action-btns"><button class="btn btn-secondary btn-sm" onclick="editCompany('+c.id+')">编辑</button><button class="btn btn-danger btn-sm" onclick="deleteCompany('+c.id+')">删除</button></td></tr>').join('');
  } catch (e) {}
}

function showCompanyModal(company) {
  company = company || null;
  const isEdit = !!company;
  document.getElementById('modal-title').textContent = isEdit ? '编辑公司' : '新增公司';
  document.getElementById('modal-body').innerHTML = '<form id="company-form" onsubmit="saveCompany(event,'+(company?company.id:'null')+')"><div class="form-row"><div class="form-group"><label>公司名称 *</label><input type="text" name="name" value="'+(company?company.name:'')+'" required></div><div class="form-group"><label>公司类型 *</label><select name="type" required><option value="customer"'+(company&&company.type==='customer'?' selected':'')+'>客户</option><option value="supplier"'+(company&&company.type==='supplier'?' selected':'')+'>供应商</option></select></div></div><div class="form-group"><label>地址</label><input type="text" name="address" value="'+(company?company.address||'':'')+'"></div><div class="form-row"><div class="form-group"><label>法定代表人</label><input type="text" name="legal_representative" value="'+(company?company.legal_representative||'':'')+'"></div><div class="form-group"><label>委托代理人</label><input type="text" name="agent" value="'+(company?company.agent||'':'')+'"></div></div><div class="form-row"><div class="form-group"><label>电话</label><input type="text" name="phone" value="'+(company?company.phone||'':'')+'"></div><div class="form-group"><label>税号</label><input type="text" name="tax_number" value="'+(company?company.tax_number||'':'')+'"></div></div><div class="form-row"><div class="form-group"><label>开户行</label><input type="text" name="bank" value="'+(company?company.bank||'':'')+'"></div><div class="form-group"><label>银行账号</label><input type="text" name="bank_account" value="'+(company?company.bank_account||'':'')+'"></div></div><div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button><button type="submit" class="btn btn-primary">保存</button></div></form>';
  openModal();
}

async function saveCompany(event, id) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    if (id) await api('/api/companies/'+id, {method:'PUT', body:JSON.stringify(data)});
    else await api('/api/companies', {method:'POST', body:JSON.stringify(data)});
    closeModal(); loadCompanies(); loadStats();
  } catch (e) {}
}

function editCompany(id) {
  const c = companiesCache.find(c => c.id === id);
  if (c) showCompanyModal(c);
}

async function deleteCompany(id) {
  if (!confirm('确定要删除吗？')) return;
  try { await api('/api/companies/'+id, {method:'DELETE'}); loadCompanies(); loadStats(); } catch (e) {}
}

async function loadProducts() {
  try {
    const search = document.getElementById('product-search').value;
    productsCache = await api('/api/products');
    let filtered = productsCache;
    if (search) filtered = productsCache.filter(p => p.name.includes(search));
    const tbody = document.getElementById('products-table');
    if (filtered.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">暂无数据</td></tr>'; return; }
    tbody.innerHTML = filtered.map(p => '<tr><td>'+p.name+'</td><td>'+(p.specification||'-')+'</td><td>'+(p.unit||'吨')+'</td><td>'+formatMoney(p.unit_price)+'</td><td>'+(p.tax_rate||13)+'%</td><td>'+(p.remark||'-')+'</td><td class="action-btns"><button class="btn btn-secondary btn-sm" onclick="editProduct('+p.id+')">编辑</button><button class="btn btn-danger btn-sm" onclick="deleteProduct('+p.id+')">删除</button></td></tr>').join('');
  } catch (e) {}
}

function showProductModal(product) {
  product = product || null;
  const isEdit = !!product;
  document.getElementById('modal-title').textContent = isEdit ? '编辑产品' : '新增产品';
  document.getElementById('modal-body').innerHTML = '<form id="product-form" onsubmit="saveProduct(event,'+(product?product.id:'null')+')"><div class="form-row"><div class="form-group"><label>产品名称 *</label><input type="text" name="name" value="'+(product?product.name:'')+'" required></div><div class="form-group"><label>规格型号</label><input type="text" name="specification" value="'+(product?product.specification||'':'')+'"></div></div><div class="form-row"><div class="form-group"><label>单位</label><select name="unit"><option value="吨">吨</option><option value="千克">千克</option><option value="个">个</option><option value="件">件</option><option value="箱">箱</option></select></div><div class="form-group"><label>含税单价</label><input type="number" step="0.01" name="unit_price" value="'+(product?product.unit_price||0:0)+'"></div></div><div class="form-row"><div class="form-group"><label>税率(%)</label><input type="number" step="0.1" name="tax_rate" value="'+(product?product.tax_rate||13:13)+'"></div><div class="form-group"><label>备注</label><input type="text" name="remark" value="'+(product?product.remark||'':'')+'"></div></div><div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button><button type="submit" class="btn btn-primary">保存</button></div></form>';
  if (product && product.unit) document.querySelector('[name=unit]').value = product.unit;
  openModal();
}

async function saveProduct(event, id) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  data.unit_price = parseFloat(data.unit_price); data.tax_rate = parseFloat(data.tax_rate);
  try {
    if (id) await api('/api/products/'+id, {method:'PUT', body:JSON.stringify(data)});
    else await api('/api/products', {method:'POST', body:JSON.stringify(data)});
    closeModal(); loadProducts(); loadStats();
  } catch (e) {}
}

function editProduct(id) { const p = productsCache.find(p => p.id === id); if (p) showProductModal(p); }
async function deleteProduct(id) { if (!confirm('确定要删除吗？')) return; try { await api('/api/products/'+id, {method:'DELETE'}); loadProducts(); loadStats(); } catch (e) {} }

async function loadContracts() {
  try {
    const type = document.getElementById('contract-type-filter').value;
    const search = document.getElementById('contract-search').value;
    let contracts = await api('/api/contracts');
    if (type) contracts = contracts.filter(c => c.contract_type === type);
    if (search) contracts = contracts.filter(c => c.contract_no.includes(search));
    const tbody = document.getElementById('contracts-table');
    if (contracts.length === 0) { tbody.innerHTML = '<tr><td colspan="8" class="empty-state">暂无数据</td></tr>'; return; }
    tbody.innerHTML = contracts.map(c => '<tr><td>'+c.contract_no+'</td><td><span class="badge badge-'+c.contract_type+'">'+(c.contract_type==='sales'?'销售':'采购')+'</span></td><td>'+(c.buyer_name||'-')+'</td><td>'+(c.seller_name||'-')+'</td><td>'+(c.sign_date||'-')+'</td><td>'+formatMoney(c.total_amount)+'</td><td><span class="badge badge-'+c.status+'">'+statusText(c.status)+'</span></td><td class="action-btns"><button class="btn btn-secondary btn-sm" onclick="editContract('+c.id+')">编辑</button><button class="btn btn-success btn-sm" onclick="generateContract('+c.id+')">生成</button><button class="btn btn-danger btn-sm" onclick="deleteContract('+c.id+')">删除</button></td></tr>').join('');
  } catch (e) {}
}

function statusText(s) { return {draft:'草稿',active:'生效',completed:'完成',pending:'待处理'}[s]||s; }

async function showContractModal(contract) {
  contract = contract || null;
  const [companies, products, rules, ourCompanies] = await Promise.all([api('/api/companies'), api('/api/products'), api('/api/contract-rules'), api('/api/our-companies')]);
  
  // Check if we have required data
  if (companies.length === 0) {
    alert('请先在"公司管理"中添加客户或供应商');
    return;
  }
  if (ourCompanies.length === 0) {
    alert('请先在"本公司主体"中添加本公司信息');
    return;
  }
  
  const isEdit = !!contract;
  let contractData = null;
  if (isEdit) contractData = await api('/api/contracts/' + contract.id);
  document.getElementById('modal-title').textContent = isEdit ? '编辑合同' : '新增合同';
  
  const ourCompanyOpts = ourCompanies.map(c => '<option value="'+c.id+'"'+(contractData&&contractData.our_company_id===c.id?' selected':'')+'>'+c.name+'</option>').join('');
  const buyerOpts = companies.map(c => '<option value="'+c.id+'"'+(contractData&&contractData.buyer_id===c.id?' selected':'')+'>'+c.name+'</option>').join('');
  const sellerOpts = companies.map(c => '<option value="'+c.id+'"'+(contractData&&contractData.seller_id===c.id?' selected':'')+'>'+c.name+'</option>').join('');
  const items = contractData ? contractData.items : [];
  
  document.getElementById('modal-body').innerHTML = '<form id="contract-form" onsubmit="saveContract(event,'+(contract?contract.id:'null')+')"><div class="form-row"><div class="form-group"><label>合同类型 *</label><select name="contract_type" required><option value="sales"'+(contractData&&contractData.contract_type==='sales'?' selected':'')+'>销售合同</option><option value="purchase"'+(contractData&&contractData.contract_type==='purchase'?' selected':'')+'>采购合同</option></select></div><div class="form-group"><label>合同编号 *</label><input type="text" name="contract_no" value="'+(contractData?contractData.contract_no:'')+'" required></div></div><div class="form-group"><label>本公司主体 *</label><select name="our_company_id" required>'+ourCompanyOpts+'</select></div><div class="form-row"><div class="form-group"><label>买方 *</label><select name="buyer_id" required>'+buyerOpts+'</select></div><div class="form-group"><label>卖方 *</label><select name="seller_id" required>'+sellerOpts+'</select></div></div><div class="form-row"><div class="form-group"><label>签订日期</label><input type="date" name="sign_date" value="'+(contractData?contractData.sign_date||'':new Date().toISOString().split('T')[0])+'"></div><div class="form-group"><label>备注</label><input type="text" name="remark" value="'+(contractData?contractData.remark||'':'')+'"></div></div><h4 style="margin:16px 0 8px">商品明细</h4><table class="items-table"><thead><tr><th style="width:30px">#</th><th>产品</th><th>规格</th><th style="width:70px">数量</th><th style="width:55px">单位</th><th style="width:90px">单价</th><th style="width:90px">金额</th><th style="width:55px">税率%</th><th style="width:90px">税额</th><th style="width:50px">操作</th></tr></thead><tbody id="contract-items-body"></tbody></table><button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="addContractItem()">+ 添加产品</button><div class="form-row" style="margin-top:16px"><div class="form-group"><label>总金额</label><input type="number" step="0.01" name="total_amount" id="contract-total" value="'+(contractData?contractData.total_amount||0:0)+'" readonly></div><div class="form-group"><label>税额合计</label><input type="number" step="0.01" name="tax_amount" id="contract-tax-total" value="'+(contractData?contractData.tax_amount||0:0)+'" readonly></div></div><div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button><button type="submit" class="btn btn-primary">保存</button></div></form>';
  
  window._contractProducts = products; window._contractRules = rules;
  items.forEach(item => addContractItem(item));
  if (items.length === 0) addContractItem();
  openModal();
}

function addContractItem(item) {
  item = item || null;
  const tbody = document.getElementById('contract-items-body');
  const idx = tbody.children.length + 1;
  const products = window._contractProducts || [];
  const opts = products.map(p => '<option value="'+p.id+'" data-name="'+p.name+'" data-spec="'+(p.specification||'')+'" data-price="'+(p.unit_price||0)+'" data-unit="'+(p.unit||'吨')+'" data-tax="'+(p.tax_rate||13)+'"'+(item&&item.product_id===p.id?' selected':'')+'>'+p.name+'</option>').join('');
  const tr = document.createElement('tr');
  tr.innerHTML = '<td>'+idx+'</td><td><select onchange="onProductChange(this)" class="item-product"><option value="">选择产品</option>'+opts+'</select></td><td><input type="text" class="item-spec" value="'+(item?item.specification||'':'')+'"></td><td><input type="number" step="0.001" class="item-qty" value="'+(item?item.quantity||0:0)+'" oninput="calcItemAmt(this)"></td><td><input type="text" class="item-unit" value="'+(item?item.unit||'吨':'吨')+'"></td><td><input type="number" step="0.01" class="item-price" value="'+(item?item.unit_price||0:0)+'" oninput="calcItemAmt(this)"></td><td><input type="number" step="0.01" class="item-amount" value="'+(item?item.amount||0:0)+'" readonly></td><td><input type="number" step="0.1" class="item-tax-rate" value="'+(item?item.tax_rate||13:13)+'" oninput="calcItemAmt(this)"></td><td><input type="number" step="0.01" class="item-tax-amount" value="'+(item?item.tax_amount||0:0)+'" readonly></td><td><button type="button" class="btn btn-danger btn-sm" onclick="removeContractItem(this)">删</button></td>';
  tbody.appendChild(tr);
}

function onProductChange(sel) {
  const opt = sel.options[sel.selectedIndex]; const tr = sel.closest('tr');
  if (opt.value) { tr.querySelector('.item-spec').value=opt.dataset.spec||''; tr.querySelector('.item-price').value=opt.dataset.price||0; tr.querySelector('.item-unit').value=opt.dataset.unit||'吨'; tr.querySelector('.item-tax-rate').value=opt.dataset.tax||13; calcItemAmt(tr.querySelector('.item-qty')); }
}

function calcItemAmt(inp) {
  const tr = inp.closest('tr'); const q=parseFloat(tr.querySelector('.item-qty').value)||0; const p=parseFloat(tr.querySelector('.item-price').value)||0; const t=parseFloat(tr.querySelector('.item-tax-rate').value)||0;
  const amt=q*p; tr.querySelector('.item-amount').value=amt.toFixed(2); tr.querySelector('.item-tax-amount').value=(amt*t/100).toFixed(2); calcContractTotal();
}

function calcContractTotal() {
  let total=0,tax=0;
  document.querySelectorAll('#contract-items-body tr').forEach(tr => { total+=parseFloat(tr.querySelector('.item-amount').value)||0; tax+=parseFloat(tr.querySelector('.item-tax-amount').value)||0; });
  document.getElementById('contract-total').value=total.toFixed(2); document.getElementById('contract-tax-total').value=tax.toFixed(2);
}

function removeContractItem(btn) { btn.closest('tr').remove(); document.querySelectorAll('#contract-items-body tr').forEach((tr,i)=>{tr.children[0].textContent=i+1;}); calcContractTotal(); }

async function saveContract(event, id) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const items = [];
  document.querySelectorAll('#contract-items-body tr').forEach(tr => {
    const ps = tr.querySelector('.item-product'); const pn = ps.options[ps.selectedIndex]?.dataset?.name || '';
    items.push({product_id:ps.value||null, product_name:pn, specification:tr.querySelector('.item-spec').value, quantity:parseFloat(tr.querySelector('.item-qty').value)||0, unit:tr.querySelector('.item-unit').value, unit_price:parseFloat(tr.querySelector('.item-price').value)||0, amount:parseFloat(tr.querySelector('.item-amount').value)||0, tax_rate:parseFloat(tr.querySelector('.item-tax-rate').value)||0, tax_amount:parseFloat(tr.querySelector('.item-tax-amount').value)||0, remark:''});
  });
  data.items=items; data.our_company_id=parseInt(data.our_company_id); data.buyer_id=parseInt(data.buyer_id); data.seller_id=parseInt(data.seller_id); data.total_amount=parseFloat(data.total_amount); data.tax_amount=parseFloat(data.tax_amount);
  try {
    if (id) await api('/api/contracts/'+id, {method:'PUT', body:JSON.stringify(data)});
    else await api('/api/contracts', {method:'POST', body:JSON.stringify(data)});
    closeModal(); loadContracts(); loadStats();
  } catch (e) {}
}

function editContract(id) { showContractModal({id}); }
async function generateContract(id) { try { const r=await api('/api/contracts/'+id+'/generate',{method:'POST'}); if(r.success){alert('合同已生成: '+r.file); window.open(r.download_url,'_blank');} } catch(e){} }
async function deleteContract(id) { if(!confirm('确定要删除吗？')) return; try { await api('/api/contracts/'+id,{method:'DELETE'}); loadContracts(); loadStats(); } catch(e){} }

async function loadDeliveryOrders() {
  try {
    const search = document.getElementById('delivery-search').value;
    let orders = await api('/api/delivery-orders');
    if (search) orders = orders.filter(o => o.delivery_no.includes(search));
    const tbody = document.getElementById('delivery-table');
    if (orders.length === 0) { tbody.innerHTML = '<tr><td colspan="8" class="empty-state">暂无数据</td></tr>'; return; }
    tbody.innerHTML = orders.map(o => '<tr><td>'+o.delivery_no+'</td><td>'+(o.contract_no||'-')+'</td><td>'+(o.buyer_name||'-')+'</td><td>'+(o.delivery_date||'-')+'</td><td>'+(o.consignee||'-')+'</td><td>'+formatMoney(o.total_amount)+'</td><td><span class="badge badge-'+o.status+'">'+statusText(o.status)+'</span></td><td class="action-btns"><button class="btn btn-secondary btn-sm" onclick="editDeliveryOrder('+o.id+')">编辑</button><button class="btn btn-success btn-sm" onclick="generateDelivery('+o.id+')">生成</button><button class="btn btn-danger btn-sm" onclick="deleteDeliveryOrder('+o.id+')">删除</button></td></tr>').join('');
  } catch (e) {}
}

async function showDeliveryModal(order) {
  order = order || null;
  const [companies, products, contracts, ourCompanies] = await Promise.all([api('/api/companies'), api('/api/products'), api('/api/contracts'), api('/api/our-companies')]);
  
  // Check if we have required data
  const customerCompanies = companies.filter(c => c.type === 'customer');
  if (customerCompanies.length === 0) {
    alert('请先在"公司管理"中添加客户');
    return;
  }
  if (ourCompanies.length === 0) {
    alert('请先在"本公司主体"中添加本公司信息');
    return;
  }
  
  const isEdit = !!order;
  let orderData = null;
  if (isEdit) orderData = await api('/api/delivery-orders/' + order.id);
  document.getElementById('modal-title').textContent = isEdit ? '编辑送货单' : '新增送货单';
  
  const ourCompanyOpts = ourCompanies.map(c => '<option value="'+c.id+'"'+(orderData&&orderData.our_company_id===c.id?' selected':'')+'>'+c.name+'</option>').join('');
  const buyerOpts = customerCompanies.map(c => '<option value="'+c.id+'"'+(orderData&&orderData.buyer_id===c.id?' selected':'')+'>'+c.name+'</option>').join('');
  const contractOpts = contracts.map(c => '<option value="'+c.id+'"'+(orderData&&orderData.contract_id===c.id?' selected':'')+'>'+c.contract_no+'</option>').join('');
  const items = orderData ? orderData.items : [];
  
  document.getElementById('modal-body').innerHTML = '<form id="delivery-form" onsubmit="saveDeliveryOrder(event,'+(order?order.id:'null')+')"><div class="form-row"><div class="form-group"><label>送货单号 *</label><input type="text" name="delivery_no" value="'+(orderData?orderData.delivery_no:'DL-'+Date.now())+'" required></div><div class="form-group"><label>关联合同</label><select name="contract_id"><option value="">不关联</option>'+contractOpts+'</select></div></div><div class="form-group"><label>本公司主体 *</label><select name="our_company_id" required>'+ourCompanyOpts+'</select></div><div class="form-row"><div class="form-group"><label>客户 *</label><select name="buyer_id" required>'+buyerOpts+'</select></div><div class="form-group"><label>送货日期</label><input type="date" name="delivery_date" value="'+(orderData?orderData.delivery_date||'':new Date().toISOString().split('T')[0])+'"></div></div><div class="form-row"><div class="form-group"><label>收货单位/个人</label><input type="text" name="consignee" value="'+(orderData?orderData.consignee||'':'')+'"></div><div class="form-group"><label>联系人</label><input type="text" name="contact_person" value="'+(orderData?orderData.contact_person||'':'')+'"></div></div><div class="form-row"><div class="form-group"><label>联系电话</label><input type="text" name="contact_phone" value="'+(orderData?orderData.contact_phone||'':'')+'"></div><div class="form-group"><label>收货地址</label><input type="text" name="address" value="'+(orderData?orderData.address||'':'')+'"></div></div><div class="form-group"><label>备注</label><textarea name="remark">'+(orderData?orderData.remark||'':'')+'</textarea></div><h4 style="margin:16px 0 8px">送货明细</h4><table class="items-table"><thead><tr><th style="width:30px">#</th><th>产品</th><th>规格</th><th style="width:70px">数量</th><th style="width:55px">单位</th><th style="width:90px">单价</th><th style="width:90px">金额</th><th style="width:50px">操作</th></tr></thead><tbody id="delivery-items-body"></tbody></table><button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="addDeliveryItem()">+ 添加产品</button><div class="form-group" style="margin-top:16px"><label>总金额</label><input type="number" step="0.01" name="total_amount" id="delivery-total" value="'+(orderData?orderData.total_amount||0:0)+'" readonly></div><div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button><button type="submit" class="btn btn-primary">保存</button></div></form>';
  
  window._deliveryProducts = products;
  items.forEach(item => addDeliveryItem(item));
  if (items.length === 0) addDeliveryItem();
  openModal();
}

function addDeliveryItem(item) {
  item = item || null;
  const tbody = document.getElementById('delivery-items-body');
  const idx = tbody.children.length + 1;
  const products = window._deliveryProducts || [];
  const opts = products.map(p => '<option value="'+p.id+'" data-name="'+p.name+'" data-spec="'+(p.specification||'')+'" data-price="'+(p.unit_price||0)+'" data-unit="'+(p.unit||'吨')+'"'+(item&&item.product_id===p.id?' selected':'')+'>'+p.name+'</option>').join('');
  const tr = document.createElement('tr');
  tr.innerHTML = '<td>'+idx+'</td><td><select onchange="onDeliveryProductChange(this)" class="item-product"><option value="">选择产品</option>'+opts+'</select></td><td><input type="text" class="item-spec" value="'+(item?item.specification||'':'')+'"></td><td><input type="number" step="0.001" class="item-qty" value="'+(item?item.quantity||0:0)+'" oninput="calcDeliveryItemAmt(this)"></td><td><input type="text" class="item-unit" value="'+(item?item.unit||'吨':'吨')+'"></td><td><input type="number" step="0.01" class="item-price" value="'+(item?item.unit_price||0:0)+'" oninput="calcDeliveryItemAmt(this)"></td><td><input type="number" step="0.01" class="item-amount" value="'+(item?item.amount||0:0)+'" readonly></td><td><button type="button" class="btn btn-danger btn-sm" onclick="removeDeliveryItem(this)">删</button></td>';
  tbody.appendChild(tr);
}

function onDeliveryProductChange(sel) {
  const opt=sel.options[sel.selectedIndex]; const tr=sel.closest('tr');
  if(opt.value){tr.querySelector('.item-spec').value=opt.dataset.spec||'';tr.querySelector('.item-price').value=opt.dataset.price||0;tr.querySelector('.item-unit').value=opt.dataset.unit||'吨';calcDeliveryItemAmt(tr.querySelector('.item-qty'));}
}

function calcDeliveryItemAmt(inp) {
  const tr=inp.closest('tr'); const q=parseFloat(tr.querySelector('.item-qty').value)||0; const p=parseFloat(tr.querySelector('.item-price').value)||0;
  tr.querySelector('.item-amount').value=(q*p).toFixed(2); calcDeliveryTotal();
}

function calcDeliveryTotal() {
  let t=0; document.querySelectorAll('#delivery-items-body tr').forEach(tr=>{t+=parseFloat(tr.querySelector('.item-amount').value)||0;});
  document.getElementById('delivery-total').value=t.toFixed(2);
}

function removeDeliveryItem(btn) { btn.closest('tr').remove(); document.querySelectorAll('#delivery-items-body tr').forEach((tr,i)=>{tr.children[0].textContent=i+1;}); calcDeliveryTotal(); }

async function saveDeliveryOrder(event, id) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const items = [];
  document.querySelectorAll('#delivery-items-body tr').forEach(tr => {
    const ps=tr.querySelector('.item-product'); const pn=ps.options[ps.selectedIndex]?.dataset?.name||'';
    items.push({product_id:ps.value||null,product_name:pn,specification:tr.querySelector('.item-spec').value,quantity:parseFloat(tr.querySelector('.item-qty').value)||0,unit:tr.querySelector('.item-unit').value,unit_price:parseFloat(tr.querySelector('.item-price').value)||0,amount:parseFloat(tr.querySelector('.item-amount').value)||0,remark:''});
  });
  data.items=items; data.our_company_id=parseInt(data.our_company_id); data.buyer_id=parseInt(data.buyer_id); data.contract_id=data.contract_id?parseInt(data.contract_id):null; data.total_amount=parseFloat(data.total_amount);
  try {
    if(id) await api('/api/delivery-orders/'+id,{method:'PUT',body:JSON.stringify(data)});
    else await api('/api/delivery-orders',{method:'POST',body:JSON.stringify(data)});
    closeModal(); loadDeliveryOrders(); loadStats();
  } catch(e){}
}

function editDeliveryOrder(id) { showDeliveryModal({id}); }
async function generateDelivery(id) { try { const r=await api('/api/delivery-orders/'+id+'/generate',{method:'POST'}); if(r.success){alert('送货单已生成: '+r.file); window.open(r.download_url,'_blank');} } catch(e){} }
async function deleteDeliveryOrder(id) { if(!confirm('确定要删除吗？')) return; try { await api('/api/delivery-orders/'+id,{method:'DELETE'}); loadDeliveryOrders(); loadStats(); } catch(e){} }

async function loadRules() {
  try {
    rulesCache = await api('/api/contract-rules');
    const tbody = document.getElementById('rules-table');
    if (rulesCache.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">暂无规则，请添加</td></tr>'; return; }
    const pt = {day:'每天',month:'每月',year:'每年',never:'不重置'};
    tbody.innerHTML = rulesCache.map(r => '<tr><td>'+r.name+'</td><td>'+r.prefix+'</td><td>'+r.date_format+'</td><td>'+r.seq_length+'</td><td>'+(pt[r.reset_period]||r.reset_period)+'</td><td class="action-btns"><button class="btn btn-danger btn-sm" onclick="deleteRule('+r.id+')">删除</button></td></tr>').join('');
  } catch (e) {}
}

function showRuleModal() {
  document.getElementById('modal-title').textContent = '新增合同号规则';
  document.getElementById('modal-body').innerHTML = '<form id="rule-form" onsubmit="saveRule(event)"><div class="form-group"><label>规则名称 *</label><input type="text" name="name" required placeholder="例如：销售合同号"></div><div class="form-row"><div class="form-group"><label>前缀</label><input type="text" name="prefix" value="" placeholder="例如：XS-"></div><div class="form-group"><label>日期格式</label><select name="date_format"><option value="YYYYMMDD">YYYYMMDD</option><option value="YYYYMM">YYYYMM</option><option value="YYYY">YYYY</option></select></div></div><div class="form-row"><div class="form-group"><label>流水号位数</label><input type="number" name="seq_length" value="3" min="1" max="10"></div><div class="form-group"><label>重置周期</label><select name="reset_period"><option value="day">每天</option><option value="month">每月</option><option value="year">每年</option><option value="never">不重置</option></select></div></div><div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button><button type="submit" class="btn btn-primary">保存</button></div></form>';
  openModal();
}

async function saveRule(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  data.seq_length = parseInt(data.seq_length);
  try { await api('/api/contract-rules',{method:'POST',body:JSON.stringify(data)}); closeModal(); loadRules(); } catch(e){}
}

async function deleteRule(id) { if(!confirm('确定要删除吗？')) return; try { await api('/api/contract-rules/'+id,{method:'DELETE'}); loadRules(); } catch(e){} }


// ========== 本公司主体管理 ==========
let ourCompaniesCache = [];

async function loadOurCompanies() {
  try {
    ourCompaniesCache = await api('/api/our-companies');
    const tbody = document.getElementById('our-companies-table');
    if (ourCompaniesCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">暂无数据，请先添加本公司主体</td></tr>';
      return;
    }
    tbody.innerHTML = ourCompaniesCache.map(c => '<tr><td>'+c.name+'</td><td>'+(c.address||'-')+'</td><td>'+(c.legal_representative||'-')+'</td><td>'+(c.phone||'-')+'</td><td>'+(c.bank||'-')+'</td><td>'+(c.is_default?'<span class="badge badge-active">默认</span>':'-')+'</td><td class="action-btns"><button class="btn btn-secondary btn-sm" onclick="editOurCompany('+c.id+')">编辑</button><button class="btn btn-danger btn-sm" onclick="deleteOurCompany('+c.id+')">删除</button></td></tr>').join('');
  } catch (e) {}
}

function showOurCompanyModal(company) {
  company = company || null;
  const isEdit = !!company;
  document.getElementById('modal-title').textContent = isEdit ? '编辑本公司' : '新增本公司';
  document.getElementById('modal-body').innerHTML = '<form id="our-company-form" onsubmit="saveOurCompany(event,'+(company?company.id:'null')+')"><div class="form-group"><label>公司名称 *</label><input type="text" name="name" value="'+(company?company.name:'')+'" required></div><div class="form-group"><label>地址</label><input type="text" name="address" value="'+(company?company.address||'':'')+'"></div><div class="form-row"><div class="form-group"><label>法定代表人</label><input type="text" name="legal_representative" value="'+(company?company.legal_representative||'':'')+'"></div><div class="form-group"><label>委托代理人</label><input type="text" name="agent" value="'+(company?company.agent||'':'')+'"></div></div><div class="form-row"><div class="form-group"><label>电话</label><input type="text" name="phone" value="'+(company?company.phone||'':'')+'"></div><div class="form-group"><label>税号</label><input type="text" name="tax_number" value="'+(company?company.tax_number||'':'')+'"></div></div><div class="form-row"><div class="form-group"><label>开户行</label><input type="text" name="bank" value="'+(company?company.bank||'':'')+'"></div><div class="form-group"><label>银行账号</label><input type="text" name="bank_account" value="'+(company?company.bank_account||'':'')+'"></div></div><div class="form-group"><label><input type="checkbox" name="is_default" value="1" '+(company&&company.is_default?'checked':'')+'> 设为默认公司</label></div><div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button><button type="submit" class="btn btn-primary">保存</button></div></form>';
  openModal();
}

async function saveOurCompany(event, id) {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  data.is_default = form.querySelector('[name=is_default]').checked ? 1 : 0;
  try {
    if (id) await api('/api/our-companies/'+id, {method:'PUT', body:JSON.stringify(data)});
    else await api('/api/our-companies', {method:'POST', body:JSON.stringify(data)});
    closeModal();
    loadOurCompanies();
  } catch (e) {}
}

function editOurCompany(id) {
  const c = ourCompaniesCache.find(c => c.id === id);
  if (c) showOurCompanyModal(c);
}

async function deleteOurCompany(id) {
  if (!confirm('确定要删除吗？')) return;
  try {
    await api('/api/our-companies/'+id, {method:'DELETE'});
    loadOurCompanies();
  } catch (e) {}
}

function openModal() { document.getElementById('modal').classList.add('show'); }
function closeModal() { document.getElementById('modal').classList.remove('show'); }
document.getElementById('modal').addEventListener('click', (e) => { if(e.target===document.getElementById('modal')) closeModal(); });
