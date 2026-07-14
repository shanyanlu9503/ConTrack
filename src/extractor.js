// extractor.js - 实体提取引擎 (v2 - 逐行解析)
// 从合同文本中自动提取公司信息、合同信息、产品明细

/**
 * 主入口：从原始文本中提取结构化实体数据
 */
function extractEntities(rawText, fileType) {
  if (!rawText || !rawText.trim()) {
    return { parties: [], contract: {}, items: [], raw_text: rawText };
  }

  // 按行分割，保留换行结构
  const lines = normalizeLines(rawText);

  // 阶段 1: 划分当事人文本区域（基于 section header + 角色标签）
  const partySections = splitPartySections(lines);

  // 阶段 2: 逐行提取每个当事人的字段
  const parties = partySections.map(sec => extractFieldsFromSection(sec.lines, sec.role, sec.side, sec.fullText));

  // 阶段 3: 提取合同级字段（从开头文本 + 全文）
  const fullText = lines.join('\n');
  const contract = extractContractFields(fullText);

  // 阶段 4: 提取产品明细
  const items = extractItems(fullText, fileType);

  // 阶段 5: 类型推断与校验
  contract.contract_type = inferContractType(fullText, contract);
  // 如果有采购/销售关键词，校正买卖方
  parties.forEach(party => {
    party.side = inferPartySide(party.role, party.side, contract.contract_type, fullText);
  });

  // 校验和清理
  validateParties(parties);

  // 自动汇总：合同总金额为空但产品明细有数据时自动累加
  if ((!contract.total_amount) && items.length > 0) {
    contract.total_amount = items.reduce((sum, it) => sum + (it.amount || 0), 0);
    if (!contract.tax_amount) {
      contract.tax_amount = items.reduce((sum, it) => sum + (it.tax_amount || 0), 0);
    }
  }

  return { parties, contract, items, raw_text: rawText };
}

// ==================== 文本预处理 ====================

function normalizeLines(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // 统一中文冒号为英文冒号(但在正则中都会匹配)
    // 合并连续空行为单个空行
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0); // 去掉完全空行
}

// ==================== 阶段 1: 当事人区域划分 ====================

function splitPartySections(lines) {
  const fullText = lines.join('\n');
  const sections = [];

  // 方案A: 寻找 section header (一、甲方信息 / 二、乙方信息 / 需方信息 / 供方信息)
  const sectionPatterns = [
    /^[一二三四五六七八九十]、\s*(甲方|乙方|买方|卖方|需方|供方)(?:信息|资料|情况)?/,
    /^(甲方|乙方|买方|卖方|需方|供方)(?:信息|资料|情况)[：:]/,
  ];

  const sectionMarkers = [];
  for (let i = 0; i < lines.length; i++) {
    for (const pat of sectionPatterns) {
      const m = lines[i].match(pat);
      if (m) {
        sectionMarkers.push({ lineIdx: i, role: m[1] });
        break;
      }
    }
  }

  // 如果有2个或以上 section marker，用它们划分
  if (sectionMarkers.length >= 2) {
    for (let s = 0; s < sectionMarkers.length && s < 2; s++) {
      const start = sectionMarkers[s].lineIdx + 1; // 跳过标题行
      const end = s + 1 < sectionMarkers.length ? sectionMarkers[s + 1].lineIdx : lines.length;
      const secLines = lines.slice(start, end);
      const secFullText = secLines.join('\n');
      const role = sectionMarkers[s].role;
      const side = guessSide(role, fullText);
      sections.push({ lines: secLines, role, side, fullText: secFullText });
    }
    // 确保有2个当事人
    while (sections.length < 2) {
      const otherRole = sections.length === 0 ? '甲方' : '乙方';
      sections.push({ lines: [], role: otherRole, side: otherRole === '甲方' ? 'buyer' : 'seller', fullText: '' });
    }
    return sections.slice(0, 2);
  }

  // 方案B: 从开头寻找角色标签 (需方：xxx / 甲方：xxx) 作为文本分界
  const partyHeaderPatterns = [
    { regex: /^(甲方|乙方|买方|卖方|需方|供方)[（(]?[^）)]*[）)]?\s*[：:]/, roleGroup: 1 },
  ];

  const headerMarkers = [];
  for (let i = 0; i < lines.length; i++) {
    for (const hp of partyHeaderPatterns) {
      const m = lines[i].match(hp.regex);
      if (m) {
        headerMarkers.push({ lineIdx: i, role: m[hp.roleGroup] });
        break;
      }
    }
  }

  if (headerMarkers.length >= 2) {
    for (let h = 0; h < headerMarkers.length && h < 2; h++) {
      const start = headerMarkers[h].lineIdx;
      const end = h + 1 < headerMarkers.length ? headerMarkers[h + 1].lineIdx : lines.length;
      const secLines = lines.slice(start, end);
      const secFullText = secLines.join('\n');
      const role = headerMarkers[h].role;
      const side = guessSide(role, fullText);
      sections.push({ lines: secLines, role, side, fullText: secFullText });
    }
  }

  // 方案C: 回退 — 全文分两半或全量
  if (sections.length === 0) {
    sections.push({ lines, role: '甲方', side: 'buyer', fullText });
    sections.push({ lines, role: '乙方', side: 'seller', fullText });
  }
  if (sections.length === 1) {
    const otherRole = sections[0].role === '甲方' ? '乙方' : '甲方';
    const otherSide = sections[0].side === 'buyer' ? 'seller' : 'buyer';
    sections.push({ lines, role: otherRole, side: otherSide, fullText });
  }

  return sections.slice(0, 2);
}

function guessSide(role, fullText) {
  if (/买方|需方|客户/.test(role)) return 'buyer';
  if (/卖方|供方/.test(role)) return 'seller';
  if (role === '甲方') return /采购/.test(fullText) ? 'buyer' : 'seller';
  if (role === '乙方') return /采购/.test(fullText) ? 'seller' : 'buyer';
  return 'buyer';
}

// ==================== 阶段 2: 逐行字段提取 ====================

function extractFieldsFromSection(lines, role, side, fullText) {
  const fields = { role, side };

  // 用单行文本+全文进行提取（单行精确，全文兜底）
  const lineText = lines.join('\n');
  const searchText = lineText + '\n' + fullText;

  // 定义字段提取规则: [字段名, 正则忽略列表]
  const fieldRules = [
    ['name', [
      /^单位名称[：:](.+)/, /^公司名称[：:](.+)/, /^企业名称[：:](.+)/,
      /^名\s*称[：:](.+)/, /^'+role+'[：:](.+)/,
    ]],
    ['legal_representative', [
      /^法定代表人[：:](.+)/, /^法人代表[：:](.+)/, /^法\s*人[：:](.+)/, /^负责人[：:](.+)/,
    ]],
    ['agent', [
      /^委托代理人[：:](.+)/, /^代理人[：:](.+)/, /^联系人[：:](.+)/,
      /^授权代表[：:](.+)/, /^经办人[：:](.+)/,
    ]],
    ['address', [
      /^通讯地址[：:](.+)/, /^联系地址[：:](.+)/, /^注册地址[：:](.+)/,
      /^经营地址[：:](.+)/, /^地\s*址[：:](.+)/, /^住\s*所[：:](.+)/,
    ]],
    ['phone', [
      /^联系电话[：:](.+)/, /^联系方式[：:](.+)/, /^手\s*机[：:](.+)/, /^电\s*话[：:](.+)/,
    ]],
    ['bank', [
      /^基本户开户行[：:](.+)/, /^开户银行[：:](.+)/, /^开户行[：:](.+)/,
    ]],
    ['bank_account', [
      /^银行账号[：:](.+)/, /^银行账户[：:](.+)/, /^账\s*号[：:](.+)/,
      /^账\s*户[：:](.+)/, /^卡\s*号[：:](.+)/,
    ]],
    ['tax_number', [
      /^纳税人识别号[：:](.+)/, /^统一社会信用代码[：:](.+)/,
      /^税\s*号[：:](.+)/, /^纳税人登记号[：:](.+)/,
    ]],
  ];

  fieldRules.forEach(([fieldName, patterns]) => {
    // 先逐行精确匹配
    let value = '';
    for (const line of lines) {
      for (const pat of patterns) {
        if (!pat) continue;
        const m = line.match(pat);
        if (m && m[1] && m[1].trim()) {
          value = m[1].trim();
          break;
        }
      }
      if (value) break;
    }
    // 行内没找到，在全文搜索（用非贪婪 + 行尾边界）
    if (!value) {
      for (const pat of patterns) {
        if (!pat) continue;
        // 转成全文搜索用（去^，加行尾边界）
        const fullPat = new RegExp(pat.source.replace(/^\^/, '').replace(/$/, '') + '[^\n]*');
        const m = searchText.match(fullPat);
        if (m && m[1] && m[1].trim()) {
          value = m[1].trim();
          break;
        }
      }
    }
    fields[fieldName] = cleanValue(value);
  });

  // 如果委托代理人是纯数字/单字符，清掉
  if (fields.agent && /^[\d\.\-\s]{0,2}$/.test(fields.agent)) {
    fields.agent = '';
  }

  return fields;
}

// ==================== 阶段 3: 合同级字段 ====================

function extractContractFields(fullText) {
  const lines = fullText.split('\n');
  const contract = {};

  // 逐行提取
  contract.contract_no = extractLineField(lines, [
    /^合同编号[：:](.+)/, /^合同号[：:](.+)/, /^协议编号[：:](.+)/,
  ]);

  contract.sign_date = extractLineField(lines, [
    /^签订时间[：:](.+)/, /^签订日期[：:](.+)/, /^签署日期[：:](.+)/,
  ]);

  contract.total_amount = extractLineField(lines, [
    /^合同总金额[：:](.+)/, /^合计金额[：:](.+)/, /^金额合计[：:](.+)/,
    /^合同金额[：:](.+)/, /^总\s*金\s*额[：:](.+)/,
  ]);

  contract.tax_amount = extractLineField(lines, [
    /^税额合计[：:](.+)/, /^税金合计[：:](.+)/, /^税\s*额[：:](.+)/,
  ]);

  // 金额解析
  contract.total_amount = parseAmount(contract.total_amount);
  contract.tax_amount = parseAmount(contract.tax_amount);
  contract.sign_date = parseDate(contract.sign_date);

  return contract;
}

// ==================== 阶段 4: 产品明细提取 ====================

function extractItems(fullText, fileType) {
  const items = [];
  const lines = fullText.split('\n');

  // 方案A: 找到产品明细区域（"一、产品" 或 "产品名称" 等标记）
  // 然后逐行提取 key: value 格式的产品信息
  let inProductSection = false;
  let currentItem = {};
  let itemFields = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检测产品区段开始
    if (/^[一二三四五六七八九十]、\s*(?:产品|商品|货物|标的)/.test(line) ||
        /^产品明细/.test(line) ||
        /^序号.*产品名称/.test(line) ||
        /^产品名称.*规格.*数量/.test(line)) {
      inProductSection = true;
      continue;
    }

    // 检测产品区段结束（遇到下一个大标题）
    if (inProductSection && /^[二三四五六七八九十]、/.test(line)) {
      inProductSection = false;
      if (Object.keys(currentItem).length > 0 && currentItem.product_name) {
        items.push(finalizeItem(currentItem));
        currentItem = {};
      }
      continue;
    }

    if (!inProductSection) continue;

    // 逐字段匹配
    const nameMatch = line.match(/^产品名称[：:](.+)/);
    if (nameMatch) { currentItem.product_name = nameMatch[1].trim(); continue; }

    const specMatch = line.match(/^规格型号[：:](.+)/);
    if (specMatch) { currentItem.specification = specMatch[1].trim(); continue; }

    const qtyMatch = line.match(/^数\s*量[：:](.+)/);
    if (qtyMatch) {
      const qtyStr = qtyMatch[1].trim();
      const qtyVal = parseFloat(qtyStr);
      currentItem.quantity = qtyVal || 0;
      // 从数量字符串中提取单位
      const unitMatch = qtyStr.match(/[\d\.]+\s*(吨|千克|kg|个|件|箱|台|套)/);
      if (unitMatch) currentItem.unit = unitMatch[1];
      continue;
    }

    const unitMatch = line.match(/^单\s*位[：:](.+)/);
    if (unitMatch) { currentItem.unit = unitMatch[1].trim(); continue; }

    const priceMatch = line.match(/^单\s*价[：:](.+)/);
    if (priceMatch) { currentItem.unit_price = parseAmount(priceMatch[1].trim()); continue; }

    const amtMatch = line.match(/^金\s*额[：:](.+)/);
    if (amtMatch) { currentItem.amount = parseAmount(amtMatch[1].trim()); continue; }

    const taxRateMatch = line.match(/^税\s*率[：:](.+)/);
    if (taxRateMatch) { currentItem.tax_rate = parseFloat(taxRateMatch[1]) || 13; continue; }

    const taxAmtMatch = line.match(/^税\s*额[：:](.+)/);
    if (taxAmtMatch) { currentItem.tax_amount = parseAmount(taxAmtMatch[1].trim()); continue; }
  }

  // 最后一个产品
  if (Object.keys(currentItem).length > 0 && currentItem.product_name) {
    items.push(finalizeItem(currentItem));
  }

  // 方案B: 回退 — 表格行模式（按多空格分割）
  if (items.length === 0) {
    for (const line of lines) {
      if (/产品名称|规格|数量.*单价|金额/.test(line)) continue; // 跳过表头
      if (/合计|总计|备注|签订|盖章/.test(line)) continue;
      if (line.length < 15) continue;

      const parts = line.split(/[\s|｜\t]{2,}/);
      if (parts.length >= 4) {
        const item = buildItemFromParts(parts);
        if (item && item.product_name) items.push(item);
      }
    }
  }

  // 方案C: key-value 自由格式
  if (items.length === 0) {
    const productName = findFieldInLines(lines, [/产品名称[：:](.+)/, /品名[：:](.+)/]);
    const spec = findFieldInLines(lines, [/规格型号[：:](.+)/, /规格[：:](.+)/]);
    const qty = findFieldInLines(lines, [/数量[：:](.+)/]);
    const unit = findFieldInLines(lines, [/单位[：:](.+)/]);
    const price = findFieldInLines(lines, [/单价[：:](.+)/]);
    const amount = findFieldInLines(lines, [/金额[：:](.+)/]);

    if (productName) {
      items.push(finalizeItem({
        product_name: productName,
        specification: spec || '',
        quantity: parseFloat(qty) || 0,
        unit: unit || '吨',
        unit_price: parseAmount(price),
        amount: parseAmount(amount),
        tax_rate: 13,
        tax_amount: 0
      }));
    }
  }

  return items;
}

function extractLineField(lines, patterns) {
  for (const line of lines) {
    for (const pat of patterns) {
      const m = line.match(pat);
      if (m && m[1] && m[1].trim()) return m[1].trim();
    }
  }
  return '';
}

// 从多行文本中查找第一个匹配的字段值
function findFieldInLines(lines, patterns) {
  for (const line of lines) {
    for (const pat of patterns) {
      const m = line.match(pat);
      if (m && m[1] && m[1].trim()) return m[1].trim();
    }
  }
  return '';
}

function finalizeItem(item) {
  // 默认值
  item.product_name = item.product_name || '';
  item.specification = item.specification || '';
  item.quantity = item.quantity || 0;
  item.unit = item.unit || '吨';
  item.unit_price = item.unit_price || 0;
  item.tax_rate = item.tax_rate || 13;
  item.amount = item.amount || 0;
  item.tax_amount = item.tax_amount || 0;

  // 自动计算
  if (item.amount === 0 && item.quantity > 0 && item.unit_price > 0) {
    item.amount = Math.round(item.quantity * item.unit_price * 100) / 100;
  }
  if (item.tax_amount === 0 && item.amount > 0) {
    item.tax_amount = Math.round(item.amount * (item.tax_rate / 100) * 100) / 100;
  }

  return item;
}

function buildItemFromParts(parts) {
  const dataParts = /^\d+$/.test(parts[0].trim()) ? parts.slice(1) : parts;
  if (dataParts.length < 2) return null;

  return finalizeItem({
    product_name: cleanValue(dataParts[0] || ''),
    specification: cleanValue(dataParts[1] || ''),
    quantity: parseFloat(dataParts[2]) || 0,
    unit: cleanValue(dataParts[3]) || '吨',
    unit_price: parseFloat(dataParts[4]) || 0,
    amount: parseFloat(dataParts[5]) || 0,
    tax_rate: dataParts.length >= 7 ? parseFloat(dataParts[6]) || 13 : 13,
    tax_amount: dataParts.length >= 8 ? parseFloat(dataParts[7]) || 0 : 0
  });
}

// ==================== 阶段 5: 类型推断与校验 ====================

function inferContractType(fullText, contract) {
  if (/采购/.test(fullText) || /购买/.test(fullText)) return 'purchase';
  if (/销售/.test(fullText) || /出售/.test(fullText)) return 'sales';
  return 'sales';
}

function inferPartySide(role, currentSide, contractType, fullText) {
  if (currentSide && currentSide !== 'buyer' && currentSide !== 'seller') currentSide = null;
  if (currentSide) return currentSide; // 已有明确的 side

  if (/买方|需方|客户/.test(role)) return 'buyer';
  if (/卖方|供方/.test(role)) return 'seller';
  if (role === '甲方') return contractType === 'purchase' ? 'buyer' : 'seller';
  if (role === '乙方') return contractType === 'purchase' ? 'seller' : 'buyer';
  return 'buyer';
}

function validateParties(parties) {
  // 过滤无效值
  const nameFields = ['name', 'legal_representative', 'agent'];
  parties.forEach(party => {
    nameFields.forEach(f => {
      const v = party[f];
      if (typeof v === 'string' && /^[\d\.\-\s]{0,3}$/.test(v)) {
        party[f] = ''; // 纯数字/过短的值无效
      }
      // 如果值里包含了多个字段标签，说明发生了串行，截断到第一个标签处
      if (typeof v === 'string' && v.length > 80) {
        const truncIdx = v.search(/\s*(?:法定代表人|委托代理人|电话|地址|开户行|账号|税号|单位名称)[：:]/);
        if (truncIdx > 0) {
          party[f] = v.substring(0, truncIdx).trim();
        }
      }
    });
  });
}

// ==================== 工具函数 ====================

function cleanValue(val) {
  if (!val || typeof val !== 'string') return '';
  return val
    .replace(/[，,。；;、\s]+$/g, '')
    .replace(/^[：:\s]+/g, '')
    .trim();
}

function parseAmount(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;

  const str = String(val).replace(/[￥¥,，\s]/g, '');
  let multiplier = 1;
  if (/万元|万/.test(str)) multiplier = 10000;
  if (/亿元|亿/.test(str)) multiplier = 100000000;

  const num = parseFloat(str.replace(/[^0-9.\-]/g, ''));
  return (num || 0) * multiplier;
}

function parseDate(val) {
  if (!val) return '';
  const match = String(val).match(/(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})[日]?/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }
  // 已经是 YYYY-MM-DD 格式
  const m2 = String(val).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m2) return m2[1];
  return String(val).trim();
}

module.exports = { extractEntities };
