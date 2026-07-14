// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb, run, get, all, saveDb, getLastId } = require('./database');
const { parseFile } = require('./parser');
const { extractEntities } = require('./extractor');
const { analyzeExcelTemplate, analyzeWordTemplate } = require('./template-analyzer');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const outputsDir = path.join(__dirname, '..', 'outputs');
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const safeName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + safeName;
      cb(null, uniqueName);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.pdf', '.xlsx', '.xls', '.docx', '.doc'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式，仅支持 PDF、Excel、Word'));
    }
  }
});

app.get('/api/companies', async (req, res) => {
  try {
    await getDb();
    const { type } = req.query;
    let sql = 'SELECT * FROM companies';
    const params = [];
    if (type) { sql += ' WHERE type = ?'; params.push(type); }
    sql += ' ORDER BY updated_at DESC';
    res.json(all(sql, params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/companies', async (req, res) => {
  try {
    await getDb();
    const d = req.body;
    run('INSERT INTO companies (name,type,address,legal_representative,agent,phone,bank,bank_account,tax_number) VALUES (?,?,?,?,?,?,?,?,?)',
      [d.name, d.type||'customer', d.address||'', d.legal_representative||'', d.agent||'', d.phone||'', d.bank||'', d.bank_account||'', d.tax_number||'']);
    const id = getLastId('companies'); res.json(get('SELECT * FROM companies WHERE id = ?', [id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/companies/:id', async (req, res) => {
  try {
    await getDb();
    const d = req.body;
    run('UPDATE companies SET name=?,type=?,address=?,legal_representative=?,agent=?,phone=?,bank=?,bank_account=?,tax_number=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [d.name,d.type,d.address,d.legal_representative,d.agent,d.phone,d.bank,d.bank_account,d.tax_number,req.params.id]);
    res.json(get('SELECT * FROM companies WHERE id = ?', [req.params.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/companies/:id', async (req, res) => {
  try { await getDb(); run('DELETE FROM companies WHERE id = ?', [req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== 本公司主体管理 ==========
app.get('/api/our-companies', async (req, res) => {
  try {
    await getDb();
    res.json(all('SELECT * FROM our_companies ORDER BY is_default DESC, updated_at DESC'));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/our-companies', async (req, res) => {
  try {
    await getDb();
    const d = req.body;
    run('INSERT INTO our_companies (name,address,legal_representative,agent,phone,bank,bank_account,tax_number,is_default) VALUES (?,?,?,?,?,?,?,?,?)',
      [d.name, d.address||'', d.legal_representative||'', d.agent||'', d.phone||'', d.bank||'', d.bank_account||'', d.tax_number||'', d.is_default||0]);
    const id = getLastId('our_companies');
    res.json(get('SELECT * FROM our_companies WHERE id = ?', [id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/our-companies/:id', async (req, res) => {
  try {
    await getDb();
    const d = req.body;
    run('UPDATE our_companies SET name=?,address=?,legal_representative=?,agent=?,phone=?,bank=?,bank_account=?,tax_number=?,is_default=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [d.name,d.address,d.legal_representative,d.agent,d.phone,d.bank,d.bank_account,d.tax_number,d.is_default||0,req.params.id]);
    res.json(get('SELECT * FROM our_companies WHERE id = ?', [req.params.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/our-companies/:id', async (req, res) => {
  try { await getDb(); run('DELETE FROM our_companies WHERE id = ?', [req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/products', async (req, res) => {
  try { await getDb(); res.json(all('SELECT * FROM products ORDER BY updated_at DESC')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/products', async (req, res) => {
  try {
    await getDb();
    const d = req.body;
    run('INSERT INTO products (name,specification,unit,unit_price,tax_rate,remark) VALUES (?,?,?,?,?,?)',
      [d.name, d.specification||'', d.unit||'吨', d.unit_price||0, d.tax_rate||13, d.remark||'']);
    const id = getLastId('products'); res.json(get('SELECT * FROM products WHERE id = ?', [id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    await getDb();
    const d = req.body;
    run('UPDATE products SET name=?,specification=?,unit=?,unit_price=?,tax_rate=?,remark=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [d.name,d.specification,d.unit,d.unit_price,d.tax_rate,d.remark,req.params.id]);
    res.json(get('SELECT * FROM products WHERE id = ?', [req.params.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
  try { await getDb(); run('DELETE FROM products WHERE id = ?', [req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contract-rules', async (req, res) => {
  try { await getDb(); res.json(all('SELECT * FROM contract_no_rules ORDER BY created_at DESC')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contract-rules', async (req, res) => {
  try {
    await getDb();
    const d = req.body;
    run('INSERT INTO contract_no_rules (name,prefix,date_format,seq_length,reset_period) VALUES (?,?,?,?,?)',
      [d.name, d.prefix||'', d.date_format||'YYYYMMDD', d.seq_length||3, d.reset_period||'day']);
    const id = getLastId('contract_no_rules'); res.json(get('SELECT * FROM contract_no_rules WHERE id = ?', [id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/contract-rules/:id', async (req, res) => {
  try { await getDb(); run('DELETE FROM contract_no_rules WHERE id = ?', [req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contracts', async (req, res) => {
  try {
    await getDb();
    res.json(all('SELECT c.*, b.name as buyer_name, s.name as seller_name FROM contracts c LEFT JOIN companies b ON c.buyer_id=b.id LEFT JOIN companies s ON c.seller_id=s.id ORDER BY c.created_at DESC'));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contracts/:id', async (req, res) => {
  try {
    await getDb();
    const contract = get('SELECT c.*,b.name as buyer_name,b.address as buyer_address,b.legal_representative as buyer_legal,b.agent as buyer_agent,b.phone as buyer_phone,b.bank as buyer_bank,b.bank_account as buyer_account,b.tax_number as buyer_tax,s.name as seller_name,s.address as seller_address,s.legal_representative as seller_legal,s.agent as seller_agent,s.phone as seller_phone,s.bank as seller_bank,s.bank_account as seller_account,s.tax_number as seller_tax FROM contracts c LEFT JOIN companies b ON c.buyer_id=b.id LEFT JOIN companies s ON c.seller_id=s.id WHERE c.id=?', [req.params.id]);
    if (!contract) return res.status(404).json({ error: 'not found' });
    contract.items = all('SELECT * FROM contract_items WHERE contract_id=? ORDER BY sort_order', [req.params.id]);
    res.json(contract);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contracts', async (req, res) => {
  try {
    await getDb();
    const d = req.body;
    run('INSERT INTO contracts (contract_no,contract_type,buyer_id,seller_id,our_company_id,sign_date,total_amount,tax_amount,remark) VALUES (?,?,?,?,?,?,?,?,?)',
      [d.contract_no,d.contract_type,d.buyer_id,d.seller_id,d.our_company_id||null,d.sign_date,d.total_amount||0,d.tax_amount||0,d.remark||'']);
    const contractId = getLastId('contracts'); const contract = get('SELECT * FROM contracts WHERE id = ?', [contractId]);
    if (d.items && d.items.length > 0) {
      d.items.forEach((item, index) => {
        run('INSERT INTO contract_items (contract_id,product_id,product_name,specification,quantity,unit,unit_price,amount,tax_rate,tax_amount,remark,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          [contract.id,item.product_id,item.product_name,item.specification||'',item.quantity||0,item.unit||'吨',item.unit_price||0,item.amount||0,item.tax_rate||13,item.tax_amount||0,item.remark||'',index]);
      });
    }
    res.json(contract);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/contracts/:id', async (req, res) => {
  try {
    await getDb();
    const d = req.body;
    run('UPDATE contracts SET contract_no=?,contract_type=?,buyer_id=?,seller_id=?,our_company_id=?,sign_date=?,total_amount=?,tax_amount=?,remark=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [d.contract_no,d.contract_type,d.buyer_id,d.seller_id,d.our_company_id||null,d.sign_date,d.total_amount,d.tax_amount,d.remark,req.params.id]);
    run('DELETE FROM contract_items WHERE contract_id=?', [req.params.id]);
    if (d.items && d.items.length > 0) {
      d.items.forEach((item, index) => {
        run('INSERT INTO contract_items (contract_id,product_id,product_name,specification,quantity,unit,unit_price,amount,tax_rate,tax_amount,remark,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          [req.params.id,item.product_id,item.product_name,item.specification||'',item.quantity||0,item.unit||'吨',item.unit_price||0,item.amount||0,item.tax_rate||13,item.tax_amount||0,item.remark||'',index]);
      });
    }
    res.json(get('SELECT * FROM contracts WHERE id=?', [req.params.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/contracts/:id', async (req, res) => {
  try {
    await getDb();
    run('DELETE FROM contract_items WHERE contract_id=?', [req.params.id]);
    run('DELETE FROM contracts WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contracts/:id/generate', async (req, res) => {
  try {
    await getDb();
    const contract = get('SELECT c.*,b.name as buyer_name,b.address as buyer_address,b.legal_representative as buyer_legal,b.agent as buyer_agent,b.phone as buyer_phone,b.bank as buyer_bank,b.bank_account as buyer_account,b.tax_number as buyer_tax,s.name as seller_name,s.address as seller_address,s.legal_representative as seller_legal,s.agent as seller_agent,s.phone as seller_phone,s.bank as seller_bank,s.bank_account as seller_account,s.tax_number as seller_tax FROM contracts c LEFT JOIN companies b ON c.buyer_id=b.id LEFT JOIN companies s ON c.seller_id=s.id WHERE c.id=?', [req.params.id]);
    if (!contract) return res.status(404).json({ error: 'not found' });
    const items = all('SELECT * FROM contract_items WHERE contract_id=? ORDER BY sort_order', [req.params.id]);
    const ExcelJS = require('exceljs');
    const templateName = contract.contract_type === 'sales' ? '武汉恒久-销售合同模板.xlsx' : '武汉恒久-采购合同模板.xlsx';
    const templatePath = path.join(__dirname, '..', 'templates', templateName);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: 'template not found' });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const worksheet = workbook.worksheets[0];
    const dataMap = {
      contract_no: contract.contract_no, sign_date: contract.sign_date,
      buyer_name: contract.buyer_name, buyer_address: contract.buyer_address,
      buyer_legal: contract.buyer_legal_representative, buyer_agent: contract.buyer_agent,
      buyer_phone: contract.buyer_phone, buyer_bank: contract.buyer_bank,
      buyer_account: contract.buyer_bank_account, buyer_tax: contract.buyer_tax_number,
      seller_name: contract.seller_name, seller_address: contract.seller_address,
      seller_legal: contract.seller_legal_representative, seller_agent: contract.seller_agent,
      seller_phone: contract.seller_phone, seller_bank: contract.seller_bank,
      seller_account: contract.seller_bank_account, seller_tax: contract.seller_tax_number,
      total_amount: contract.total_amount, tax_amount: contract.tax_amount
    };
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value && typeof cell.value === 'string') {
          Object.keys(dataMap).forEach(key => {
            const ph = '{' + key + '}';
            if (cell.value.includes(ph)) cell.value = cell.value.replace(ph, dataMap[key] || '');
          });
        }
      });
    });
    const startRow = 10;
    items.forEach((item, index) => {
      const row = worksheet.getRow(startRow + index);
      row.getCell(1).value = index + 1;
      row.getCell(2).value = item.product_name;
      row.getCell(3).value = item.specification;
      row.getCell(4).value = item.quantity;
      row.getCell(5).value = item.unit;
      row.getCell(6).value = item.unit_price;
      row.getCell(7).value = item.amount;
      row.getCell(8).value = item.tax_rate + '%';
      row.getCell(9).value = item.tax_amount;
      row.getCell(10).value = item.remark;
    });
    const fileName = contract.contract_no + '_' + templateName;
    const outputPath = path.join(outputsDir, fileName);
    await workbook.xlsx.writeFile(outputPath);
    res.json({ success: true, file: fileName, download_url: '/outputs/' + encodeURIComponent(fileName) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/delivery-orders', async (req, res) => {
  try {
    await getDb();
    res.json(all('SELECT d.*,c.name as buyer_name,con.contract_no FROM delivery_orders d LEFT JOIN companies c ON d.buyer_id=c.id LEFT JOIN contracts con ON d.contract_id=con.id ORDER BY d.created_at DESC'));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/delivery-orders/:id', async (req, res) => {
  try {
    await getDb();
    const order = get('SELECT d.*,c.name as buyer_name,c.address as buyer_address,c.phone as buyer_phone,con.contract_no FROM delivery_orders d LEFT JOIN companies c ON d.buyer_id=c.id LEFT JOIN contracts con ON d.contract_id=con.id WHERE d.id=?', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'not found' });
    order.items = all('SELECT * FROM delivery_items WHERE delivery_id=? ORDER BY sort_order', [req.params.id]);
    res.json(order);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/delivery-orders', async (req, res) => {
  try {
    await getDb();
    const d = req.body;
    run('INSERT INTO delivery_orders (delivery_no,contract_id,buyer_id,our_company_id,delivery_date,consignee,contact_person,contact_phone,address,total_amount,remark) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [d.delivery_no,d.contract_id||null,d.buyer_id,d.our_company_id||null,d.delivery_date,d.consignee||'',d.contact_person||'',d.contact_phone||'',d.address||'',d.total_amount||0,d.remark||'']);
    const orderId = getLastId('delivery_orders'); const order = get('SELECT * FROM delivery_orders WHERE id = ?', [orderId]);
    if (d.items && d.items.length > 0) {
      d.items.forEach((item, index) => {
        run('INSERT INTO delivery_items (delivery_id,product_id,product_name,specification,quantity,unit,unit_price,amount,remark,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [order.id,item.product_id,item.product_name,item.specification||'',item.quantity||0,item.unit||'吨',item.unit_price||0,item.amount||0,item.remark||'',index]);
      });
    }
    res.json(order);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/delivery-orders/:id', async (req, res) => {
  try {
    await getDb();
    const d = req.body;
    run('UPDATE delivery_orders SET delivery_no=?,contract_id=?,buyer_id=?,our_company_id=?,delivery_date=?,consignee=?,contact_person=?,contact_phone=?,address=?,total_amount=?,remark=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [d.delivery_no,d.contract_id||null,d.buyer_id,d.our_company_id||null,d.delivery_date,d.consignee,d.contact_person,d.contact_phone,d.address,d.total_amount,d.remark,req.params.id]);
    run('DELETE FROM delivery_items WHERE delivery_id=?', [req.params.id]);
    if (d.items && d.items.length > 0) {
      d.items.forEach((item, index) => {
        run('INSERT INTO delivery_items (delivery_id,product_id,product_name,specification,quantity,unit,unit_price,amount,remark,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [req.params.id,item.product_id,item.product_name,item.specification||'',item.quantity||0,item.unit||'吨',item.unit_price||0,item.amount||0,item.remark||'',index]);
      });
    }
    res.json(get('SELECT * FROM delivery_orders WHERE id=?', [req.params.id]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/delivery-orders/:id', async (req, res) => {
  try {
    await getDb();
    run('DELETE FROM delivery_items WHERE delivery_id=?', [req.params.id]);
    run('DELETE FROM delivery_orders WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/delivery-orders/:id/generate', async (req, res) => {
  try {
    await getDb();
    const order = get('SELECT d.*,c.name as buyer_name FROM delivery_orders d LEFT JOIN companies c ON d.buyer_id=c.id WHERE d.id=?', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'not found' });
    const items = all('SELECT * FROM delivery_items WHERE delivery_id=? ORDER BY sort_order', [req.params.id]);
    const PizZip = require('pizzip');
    const Docxtemplater = require('docxtemplater');
    const templatePath = path.join(__dirname, '..', 'templates', '送货单模板.docx');
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: 'template not found' });
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    const context = {
      delivery_no: order.delivery_no,
      delivery_date: order.delivery_date || new Date().toISOString().split('T')[0],
      buyer_name: order.buyer_name,
      consignee: order.consignee,
      contact_person: order.contact_person,
      contact_phone: order.contact_phone,
      address: order.address,
      remark: order.remark,
      items: items.map((item, index) => ({
        no: index + 1, product_name: item.product_name,
        specification: item.specification, quantity: item.quantity,
        unit: item.unit, unit_price: item.unit_price,
        amount: item.amount, remark: item.remark
      })),
      total_quantity: items.reduce((s, i) => s + (i.quantity || 0), 0),
      total_amount: order.total_amount
    };
    doc.render(context);
    const buf = doc.getZip().generate({ type: 'nodebuffer' });
    const fileName = '送货单_' + order.delivery_no + '.docx';
    const outputPath = path.join(outputsDir, fileName);
    fs.writeFileSync(outputPath, buf);
    res.json({ success: true, file: fileName, download_url: '/outputs/' + encodeURIComponent(fileName) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== 合同导入功能 ==========

// 上传并解析文件
app.post('/api/import/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请选择文件' });
    const file = req.file;
    const ext = path.extname(file.originalname).toLowerCase();
    const fileType = ext === '.pdf' ? 'pdf' : ext === '.docx' || ext === '.doc' ? 'docx' : 'xlsx';

    // 解析文件提取文本
    let rawText = '';
    try {
      rawText = await parseFile(file.path, fileType);
    } catch (parseErr) {
      // 解析失败也记录，状态为 uploaded
      rawText = '';
    }

    // 存入数据库
    await getDb();
    run('INSERT INTO imported_files (original_name, stored_name, file_path, file_type, file_size, raw_text, status) VALUES (?,?,?,?,?,?,?)',
      [file.originalname, file.filename, file.path, fileType, file.size, rawText, rawText ? 'parsed' : 'uploaded']);
    const id = getLastId('imported_files');
    const record = get('SELECT * FROM imported_files WHERE id = ?', [id]);

    res.json({
      id: record.id,
      original_name: record.original_name,
      file_type: record.file_type,
      file_size: record.file_size,
      raw_text: record.raw_text,
      status: record.status
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 提取实体数据
app.post('/api/import/extract', async (req, res) => {
  try {
    await getDb();
    const { file_id } = req.body;
    if (!file_id) return res.status(400).json({ error: '缺少 file_id' });

    const record = get('SELECT * FROM imported_files WHERE id = ?', [file_id]);
    if (!record) return res.status(404).json({ error: '文件记录不存在' });
    if (!record.raw_text) return res.status(400).json({ error: '该文件未能提取文本内容，可能是扫描版PDF或空文件' });

    const extracted = extractEntities(record.raw_text, record.file_type);

    // 自动补全：按名称匹配数据库已有公司，填充缺失字段
    if (extracted.parties) {
      for (const party of extracted.parties) {
        if (!party.name || !party.name.trim()) continue;
        // 按名称查找
        const existing = get('SELECT * FROM companies WHERE name = ?', [party.name.trim()]);
        if (existing) {
          // 仅当提取值为空时才用数据库值填充
          if (!party.address) party.address = existing.address || '';
          if (!party.legal_representative) party.legal_representative = existing.legal_representative || '';
          if (!party.agent) party.agent = existing.agent || '';
          if (!party.phone) party.phone = existing.phone || '';
          if (!party.bank) party.bank = existing.bank || '';
          if (!party.bank_account) party.bank_account = existing.bank_account || '';
          if (!party.tax_number) party.tax_number = existing.tax_number || '';
        }
      }
    }

    // 存储提取结果
    const extractedJson = JSON.stringify(extracted);
    run('UPDATE imported_files SET extracted_data = ?, status = ? WHERE id = ?',
      [extractedJson, 'extracted', file_id]);

    res.json(extracted);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 保存导入的合同
app.post('/api/import/save', async (req, res) => {
  try {
    await getDb();
    const { file_id, parties, contract, items, our_company_id } = req.body;

    if (!parties || parties.length < 2) return res.status(400).json({ error: '至少需要两个当事人（买方和卖方）' });
    if (!contract || !contract.contract_no) return res.status(400).json({ error: '缺少合同编号' });

    // 处理每个当事人：检查是否已存在，否则创建
    const companyIds = [];
    for (const party of parties) {
      let companyId = null;

      // 按税号查找
      if (party.tax_number && party.tax_number.trim()) {
        const existing = get('SELECT id FROM companies WHERE tax_number = ?', [party.tax_number.trim()]);
        if (existing) companyId = existing.id;
      }

      // 按名称查找
      if (!companyId && party.name && party.name.trim()) {
        const existing = get('SELECT id FROM companies WHERE name = ?', [party.name.trim()]);
        if (existing) companyId = existing.id;
      }

      // 不存在则创建
      if (!companyId) {
        const type = party.side === 'buyer' ? 'customer' : 'supplier';
        run('INSERT INTO companies (name,type,address,legal_representative,agent,phone,bank,bank_account,tax_number) VALUES (?,?,?,?,?,?,?,?,?)',
          [party.name || '未知公司', type, party.address || '', party.legal_representative || '',
           party.agent || '', party.phone || '', party.bank || '', party.bank_account || '', party.tax_number || '']);
        companyId = getLastId('companies');
      }

      companyIds.push({ id: companyId, side: party.side });
    }

    // 确定买卖方 ID
    const buyerParty = companyIds.find(c => {
      const p = parties.find(pp => pp.side === c.side);
      return p && p.side === 'buyer';
    }) || companyIds[0];
    const sellerParty = companyIds.find(c => {
      const p = parties.find(pp => pp.side === c.side);
      return p && p.side === 'seller';
    }) || companyIds[1] || companyIds[0];

    // 创建合同
    run('INSERT INTO contracts (contract_no,contract_type,buyer_id,seller_id,our_company_id,sign_date,total_amount,tax_amount,remark) VALUES (?,?,?,?,?,?,?,?,?)',
      [contract.contract_no, contract.contract_type || 'sales', buyerParty.id, sellerParty.id,
       our_company_id || null, contract.sign_date || null, contract.total_amount || 0,
       contract.tax_amount || 0, contract.remark || '']);

    const contractId = getLastId('contracts');

    // 创建合同明细
    if (items && items.length > 0) {
      items.forEach((item, index) => {
        // 查找或创建产品
        let productId = null;
        if (item.product_name && item.product_name.trim()) {
          const existingProduct = get('SELECT id FROM products WHERE name = ?', [item.product_name.trim()]);
          if (existingProduct) {
            productId = existingProduct.id;
          } else {
            run('INSERT INTO products (name,specification,unit,unit_price,tax_rate) VALUES (?,?,?,?,?)',
              [item.product_name.trim(), item.specification || '', item.unit || '吨', item.unit_price || 0, item.tax_rate || 13]);
            productId = getLastId('products');
          }
        }

        run('INSERT INTO contract_items (contract_id,product_id,product_name,specification,quantity,unit,unit_price,amount,tax_rate,tax_amount,remark,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          [contractId, productId, item.product_name || '', item.specification || '', item.quantity || 0,
           item.unit || '吨', item.unit_price || 0, item.amount || 0, item.tax_rate || 13, item.tax_amount || 0,
           item.remark || '', index]);
      });
    }

    // 更新导入记录状态
    if (file_id) {
      run('UPDATE imported_files SET status = ? WHERE id = ?', ['imported', file_id]);
    }

    res.json({
      success: true,
      contract_id: contractId,
      buyer_id: buyerParty.id,
      seller_id: sellerParty.id
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 从导入文件创建模板
app.post('/api/import/create-template', async (req, res) => {
  try {
    await getDb();
    const { file_id, template_name, template_type } = req.body;
    if (!file_id) return res.status(400).json({ error: '缺少 file_id' });

    const record = get('SELECT * FROM imported_files WHERE id = ?', [file_id]);
    if (!record) return res.status(404).json({ error: '文件记录不存在' });

    // 解析提取数据
    let extractedData = {};
    if (record.extracted_data) {
      try { extractedData = JSON.parse(record.extracted_data); } catch (e) {}
    }
    if (!extractedData.parties || extractedData.parties.length === 0) {
      // 重新提取
      extractedData = extractEntities(record.raw_text || '', record.file_type);
    }

    // PDF 不支持模板生成
    if (record.file_type === 'pdf') {
      return res.status(400).json({ error: 'PDF 文件不支持自动生成模板，请手动创建模板。PDF 只能提取数据。' });
    }

    const templatesDir = path.join(__dirname, '..', 'templates');
    if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir, { recursive: true });

    let result;
    if (record.file_type === 'xlsx') {
      result = await analyzeExcelTemplate(record.file_path, extractedData, templatesDir);
    } else if (record.file_type === 'docx') {
      result = await analyzeWordTemplate(record.file_path, extractedData, templatesDir);
    }

    // 存储到 contract_templates 表
    run('INSERT INTO contract_templates (name, file_path, template_type, source_file_id, placeholder_map) VALUES (?,?,?,?,?)',
      [template_name || result.template_name, result.template_path, template_type || 'sales', file_id,
       JSON.stringify(result.placeholder_map || {})]);

    const templateId = getLastId('contract_templates');

    res.json({
      success: true,
      template_id: templateId,
      template_name: template_name || result.template_name,
      template_path: result.template_path,
      placeholder_map: result.placeholder_map,
      warning: result.warning || null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 导入历史列表
app.get('/api/import/history', async (req, res) => {
  try {
    await getDb();
    const records = all('SELECT id, original_name, file_type, file_size, status, created_at FROM imported_files ORDER BY created_at DESC');
    res.json(records);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 删除导入记录
app.delete('/api/import/history/:id', async (req, res) => {
  try {
    await getDb();
    const record = get('SELECT * FROM imported_files WHERE id = ?', [req.params.id]);
    if (!record) return res.status(404).json({ error: '记录不存在' });

    // 删除物理文件
    if (record.file_path && fs.existsSync(record.file_path)) {
      fs.unlinkSync(record.file_path);
    }

    run('DELETE FROM imported_files WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use('/outputs', express.static(outputsDir));

app.get('/api/stats', async (req, res) => {
  try {
    await getDb();
    res.json({
      companies: get('SELECT COUNT(*) as count FROM companies').count,
      products: get('SELECT COUNT(*) as count FROM products').count,
      contracts: get('SELECT COUNT(*) as count FROM contracts').count,
      delivery_orders: get('SELECT COUNT(*) as count FROM delivery_orders').count,
      total_contract_amount: get('SELECT COALESCE(SUM(total_amount),0) as total FROM contracts').total,
      total_delivery_amount: get('SELECT COALESCE(SUM(total_amount),0) as total FROM delivery_orders').total
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, '0.0.0.0', () => { console.log('合同管理工具已启动: http://localhost:' + PORT); });
