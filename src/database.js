// database.js
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'contracts.db');
let db = null;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  // 始终运行建表语句 (IF NOT EXISTS 确保幂等)
  initDatabase();
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function initDatabase() {
  db.run('CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT \'customer\', address TEXT DEFAULT \'\', legal_representative TEXT DEFAULT \'\', agent TEXT DEFAULT \'\', phone TEXT DEFAULT \'\', bank TEXT DEFAULT \'\', bank_account TEXT DEFAULT \'\', tax_number TEXT DEFAULT \'\', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  db.run('CREATE TABLE IF NOT EXISTS our_companies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT DEFAULT \'\', legal_representative TEXT DEFAULT \'\', agent TEXT DEFAULT \'\', phone TEXT DEFAULT \'\', bank TEXT DEFAULT \'\', bank_account TEXT DEFAULT \'\', tax_number TEXT DEFAULT \'\', is_default INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  db.run('CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, specification TEXT DEFAULT \'\', unit TEXT DEFAULT \'\u5428\', unit_price REAL DEFAULT 0, tax_rate REAL DEFAULT 13, remark TEXT DEFAULT \'\', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  db.run('CREATE TABLE IF NOT EXISTS contracts (id INTEGER PRIMARY KEY AUTOINCREMENT, contract_no TEXT UNIQUE NOT NULL, contract_type TEXT NOT NULL, buyer_id INTEGER, seller_id INTEGER, our_company_id INTEGER, sign_date DATE, total_amount REAL DEFAULT 0, tax_amount REAL DEFAULT 0, status TEXT DEFAULT \'draft\', remark TEXT DEFAULT \'\', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (buyer_id) REFERENCES companies(id), FOREIGN KEY (seller_id) REFERENCES companies(id), FOREIGN KEY (our_company_id) REFERENCES our_companies(id))');
  db.run('CREATE TABLE IF NOT EXISTS contract_items (id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id INTEGER NOT NULL, product_id INTEGER, product_name TEXT NOT NULL, specification TEXT DEFAULT \'\', quantity REAL DEFAULT 0, unit TEXT DEFAULT \'\u5428\', unit_price REAL DEFAULT 0, amount REAL DEFAULT 0, tax_rate REAL DEFAULT 13, tax_amount REAL DEFAULT 0, remark TEXT DEFAULT \'\', sort_order INTEGER DEFAULT 0, FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE, FOREIGN KEY (product_id) REFERENCES products(id))');
  db.run('CREATE TABLE IF NOT EXISTS delivery_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_no TEXT UNIQUE NOT NULL, contract_id INTEGER, buyer_id INTEGER, our_company_id INTEGER, delivery_date DATE, consignee TEXT DEFAULT \'\', contact_person TEXT DEFAULT \'\', contact_phone TEXT DEFAULT \'\', address TEXT DEFAULT \'\', total_amount REAL DEFAULT 0, status TEXT DEFAULT \'pending\', remark TEXT DEFAULT \'\', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (contract_id) REFERENCES contracts(id), FOREIGN KEY (buyer_id) REFERENCES companies(id), FOREIGN KEY (our_company_id) REFERENCES our_companies(id))');
  db.run('CREATE TABLE IF NOT EXISTS delivery_items (id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_id INTEGER NOT NULL, product_id INTEGER, product_name TEXT NOT NULL, specification TEXT DEFAULT \'\', quantity REAL DEFAULT 0, unit TEXT DEFAULT \'\u5428\', unit_price REAL DEFAULT 0, amount REAL DEFAULT 0, remark TEXT DEFAULT \'\', sort_order INTEGER DEFAULT 0, FOREIGN KEY (delivery_id) REFERENCES delivery_orders(id) ON DELETE CASCADE, FOREIGN KEY (product_id) REFERENCES products(id))');
  db.run('CREATE TABLE IF NOT EXISTS contract_no_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, prefix TEXT DEFAULT \'\', date_format TEXT DEFAULT \'YYYYMMDD\', seq_length INTEGER DEFAULT 3, reset_period TEXT DEFAULT \'day\', current_seq INTEGER DEFAULT 0, last_date TEXT DEFAULT \'\', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  db.run('CREATE TABLE IF NOT EXISTS imported_files (id INTEGER PRIMARY KEY AUTOINCREMENT, original_name TEXT NOT NULL, stored_name TEXT NOT NULL, file_path TEXT NOT NULL, file_type TEXT NOT NULL, file_size INTEGER DEFAULT 0, raw_text TEXT DEFAULT \'\', extracted_data TEXT DEFAULT \'\', status TEXT DEFAULT \'uploaded\', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  db.run('CREATE TABLE IF NOT EXISTS contract_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, file_path TEXT NOT NULL, template_type TEXT NOT NULL, source_file_id INTEGER, placeholder_map TEXT DEFAULT \'\', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (source_file_id) REFERENCES imported_files(id))');
  saveDb();
}

function run(sql, params) {
  params = params || [];
  db.run(sql, params);
  saveDb();
  return db.getRowsModified();
}

function get(sql, params) {
  params = params || [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let result = null;
  if (stmt.step()) result = stmt.getAsObject();
  stmt.free();
  return result;
}

function all(sql, params) {
  params = params || [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function getLastId(table) {
  table = table || 'companies';
  const result = get('SELECT MAX(id) as max_id FROM ' + table);
  return result ? result.max_id : 0;
}

module.exports = { getDb, saveDb, run, get, all, getLastId };
