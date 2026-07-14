// extractor.js - 实体提取引擎
// 从合同文本中自动提取公司信息、合同信息、产品明细

/**
 * 主入口：从原始文本中提取结构化实体数据
 * @param {string} rawText - 解析后的原始文本
 * @param {string} fileType - 文件类型 (pdf/docx/xlsx)
 * @returns {object} { parties, contract, items }
 */
function extractEntities(rawText, fileType) {
  if (!rawText || !rawText.trim()) {
    return { parties: [], contract: {}, items: [], raw_text: rawText };
  }

  // 规范化文本
  const text = normalizeText(rawText);

  // 阶段 1: 识别当事人
  const partyBlocks = identifyParties(text);

  // 阶段 2: 提取每个当事人的字段
  const parties = partyBlocks.map(block => extractPartyFields(block.text, block.role, block.side));

  // 阶段 3: 提取合同级字段
  const contract = extractContractFields(text);

  // 阶段 4: 提取产品明细
  const items = extractItems(text, fileType);

  // 阶段 5: 类型推断与校验
  contract.contract_type = inferContractType(text, contract);
  parties.forEach(party => {
    if (!party.side) party.side = inferPartySide(party.role, contract.contract_type);
  });

  return { parties, contract, items, raw_text: rawText };
}

// ==================== 文本规范化 ====================

function normalizeText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[：:]\s*/g, '：')   // 统一冒号
    .replace(/\s+/g, ' ')         // 合并空白
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .trim();
}

// ==================== 阶段 1: 当事人识别 ====================

function identifyParties(text) {
  const blocks = [];

  // 尝试多种当事人标识模式
  const partyPatterns = [
    { regex: /甲方[（(]?(买方|卖方|供方|需方|客户)?[）)]?\s*[：:]/g, role: '甲方', sideHint: 'buyer' },
    { regex: /乙方[（(]?(买方|卖方|供方|需方|客户)?[）)]?\s*[：:]/g, role: '乙方', sideHint: 'seller' },
    { regex: /买方[（(]?(甲方|乙方)?[）)]?\s*[：:]/g, role: '买方', sideHint: 'buyer' },
    { regex: /卖方[（(]?(甲方|乙方)?[）)]?\s*[：:]/g, role: '卖方', sideHint: 'seller' },
    { regex: /供方[（(]?(甲方|乙方)?[）)]?\s*[：:]/g, role: '供方', sideHint: 'seller' },
    { regex: /需方[（(]?(甲方|乙方)?[）)]?\s*[：:]/g, role: '需方', sideHint: 'buyer' },
  ];

  const matches = [];
  partyPatterns.forEach(pattern => {
    let match;
    pattern.regex.lastIndex = 0;
    while ((match = pattern.regex.exec(text)) !== null) {
      let side = pattern.sideHint;
      // 尝试从括号内容推断
      if (match[1]) {
        if (/买方|需方|客户/.test(match[1])) side = 'buyer';
        else if (/卖方|供方/.test(match[1])) side = 'seller';
      }
      matches.push({
        index: match.index,
        role: pattern.role,
        side: side
      });
    }
  });

  // 按出现位置排序
  matches.sort((a, b) => a.index - b.index);

  // 取前两个不同的当事人(去重——同 role 取第一个)
  const seenRoles = new Set();
  const uniqueMatches = [];
  matches.forEach(m => {
    if (!seenRoles.has(m.role) && uniqueMatches.length < 2) {
      seenRoles.add(m.role);
      uniqueMatches.push(m);
    }
  });

  // 为每个匹配提取文本块(从该 match 位置到下个 match 位置或文本结束)
  uniqueMatches.forEach((m, i) => {
    const startIdx = m.index;
    const endIdx = i + 1 < uniqueMatches.length ? uniqueMatches[i + 1].index : text.length;
    const blockText = text.substring(startIdx, endIdx);

    blocks.push({
      role: m.role,
      side: m.side,
      text: blockText
    });
  });

  // 如果没识别到当事人，尝试全文提取
  if (blocks.length === 0) {
    blocks.push({ role: '甲方', side: 'buyer', text: text });
    blocks.push({ role: '乙方', side: 'seller', text: text });
  }

  // 如果只识别到一个，补充第二个
  if (blocks.length === 1) {
    const otherRole = blocks[0].role === '甲方' ? '乙方' : '甲方';
    const otherSide = blocks[0].side === 'buyer' ? 'seller' : 'buyer';
    blocks.push({ role: otherRole, side: otherSide, text: text });
  }

  return blocks;
}

// ==================== 阶段 2: 当事人字段提取 ====================

function extractPartyFields(text, role, side) {
  const fields = { role, side };

  fields.name = findField(text, [
    /单位名称[：:](.+)/,
    /公司名称[：:](.+)/,
    /名\s*称[：:](.+)/,
    /企业名称[：:](.+)/,
    // 从 label 行首提取
    role === '甲方' ? /甲方[（(]?(?:买方|卖方|供方|需方)?[）)]?\s*[：:](.+)/ : null,
    role === '乙方' ? /乙方[（(]?(?:买方|卖方|供方|需方)?[）)]?\s*[：:](.+)/ : null,
    role === '买方' ? /买方[：:](.+)/ : null,
    role === '卖方' ? /卖方[：:](.+)/ : null,
  ]);

  fields.legal_representative = findField(text, [
    /法定代表人[：:](.+)/,
    /法人代表[：:](.+)/,
    /法\s*人[：:](.+)/,
    /负责人[：:](.+)/,
  ]);

  fields.agent = findField(text, [
    /委托代理人[：:](.+)/,
    /代理人[：:](.+)/,
    /联系人[：:](.+)/,
    /授权代表[：:](.+)/,
    /经办人[：:](.+)/,
  ]);

  fields.address = findField(text, [
    /通讯地址[：:](.+)/,
    /联系地址[：:](.+)/,
    /注册地址[：:](.+)/,
    /经营地址[：:](.+)/,
    /地\s*址[：:](.+)/,
    /住\s*所[：:](.+)/,
  ]);

  fields.phone = findField(text, [
    /联系电话[：:](.+)/,
    /联系方式[：:](.+)/,
    /手\s*机[：:](.+)/,
    /电\s*话[：:](.+)/,
  ]);

  fields.bank = findField(text, [
    /基本户开户行[：:](.+)/,
    /开户银行[：:](.+)/,
    /开户行[：:](.+)/,
    /银\s*行[：:](.+)/,
  ]);

  fields.bank_account = findField(text, [
    /银行账号[：:](.+)/,
    /银行账户[：:](.+)/,
    /账\s*号[：:](.+)/,
    /账\s*户[：:](.+)/,
    /卡\s*号[：:](.+)/,
  ]);

  fields.tax_number = findField(text, [
    /纳税人识别号[：:](.+)/,
    /统一社会信用代码[：:](.+)/,
    /税\s*号[：:](.+)/,
    /纳税人登记号[：:](.+)/,
  ]);

  // 清理字段值
  Object.keys(fields).forEach(key => {
    if (fields[key] && typeof fields[key] === 'string') {
      fields[key] = cleanValue(fields[key]);
    }
  });

  // 如果通过角色标签匹配到了公司名，确保它优先
  return fields;
}

// ==================== 阶段 3: 合同级字段 ====================

function extractContractFields(text) {
  const contract = {};

  contract.contract_no = findField(text, [
    /合同编号[：:](.+)/,
    /合同号[：:](.+)/,
    /协议编号[：:](.+)/,
    /编\s*号[：:](.+)/,
  ]);

  contract.sign_date = findField(text, [
    /签订日期[：:](.+)/,
    /签署日期[：:](.+)/,
    /签订时间[：:](.+)/,
    /日\s*期[：:](.+)/,
  ]);

  contract.total_amount = findField(text, [
    /合同总金额[：:](.+)/,
    /合计金额[：:](.+)/,
    /金额合计[：:](.+)/,
    /合同金额[：:](.+)/,
    /总\s*金\s*额[：:](.+)/,
    /总\s*价[：:](.+)/,
  ]);

  // 尝试提取税额
  contract.tax_amount = findField(text, [
    /税额合计[：:](.+)/,
    /税金合计[：:](.+)/,
    /税\s*额[：:](.+)/,
  ]);

  // 清理
  Object.keys(contract).forEach(key => {
    if (contract[key] && typeof contract[key] === 'string') {
      contract[key] = cleanValue(contract[key]);
    }
  });

  // 解析金额
  if (contract.total_amount) {
    contract.total_amount = parseAmount(contract.total_amount);
  } else {
    contract.total_amount = 0;
  }
  if (contract.tax_amount) {
    contract.tax_amount = parseAmount(contract.tax_amount);
  } else {
    contract.tax_amount = 0;
  }

  // 解析日期
  if (contract.sign_date) {
    contract.sign_date = parseDate(contract.sign_date);
  }

  return contract;
}

// ==================== 阶段 4: 产品明细提取 ====================

function extractItems(text, fileType) {
  const items = [];

  // 对于带位置标注的 Excel 文本，有更好的结构化信息
  // 这里主要处理纯文本场景

  // 方案 A: 表格行匹配 —— 寻找表头后的数据行
  // 表头关键词和顺序
  const headerPatterns = [
    /序号.*产品名称.*规格.*数量.*单位.*单价.*金额/,
    /产品名称.*规格型号.*数量.*单价.*金额/,
    /名称.*规格.*数量.*单位.*单价/,
    /品名.*规格.*数量.*单价.*金额/,
    /商品名称.*型号.*数量.*单价/,
  ];

  let tableStartIdx = -1;
  for (const hp of headerPatterns) {
    const match = text.match(hp);
    if (match) {
      tableStartIdx = match.index + match[0].length;
      break;
    }
  }

  if (tableStartIdx >= 0) {
    // 提取表头后的数据行（最多 50 行）
    const tableText = text.substring(tableStartIdx).trim();
    const lines = tableText.split('\n').filter(l => l.trim());

    for (const line of lines) {
      // 跳过明显不是数据行的内容
      if (/合计|总计|备注|说明|签订|签字|盖章/.test(line)) continue;
      if (line.length < 10) continue;

      // 尝试按空白、竖线、制表符分割
      const parts = line.split(/[\s|｜\t]{2,}/);
      if (parts.length >= 3) {
        const item = buildItemFromParts(parts);
        if (item && item.product_name) {
          items.push(item);
        }
      }
    }
  }

  // 方案 B: 编号列表匹配（如 "1. 氢氧化钠 99% 10吨 3500元/吨"）
  if (items.length === 0) {
    const listPattern = /(\d+)[\.\)、]\s*(.+)/g;
    let match;
    while ((match = listPattern.exec(text)) !== null) {
      const content = match[2].trim();
      // 尝试从内容中解析产品信息
      const item = parseItemLine(content);
      if (item && item.product_name) {
        items.push(item);
      }
    }
  }

  return items;
}

function buildItemFromParts(parts) {
  // 跳过序号列
  const dataParts = /^\d+$/.test(parts[0].trim()) ? parts.slice(1) : parts;

  if (dataParts.length < 2) return null;

  const item = {
    product_name: cleanValue(dataParts[0] || ''),
    specification: cleanValue(dataParts[1] || ''),
    quantity: parseFloat(dataParts[2]) || 0,
    unit: cleanValue(dataParts[3]) || '吨',
    unit_price: parseFloat(dataParts[4]) || 0,
    amount: parseFloat(dataParts[5]) || 0,
    tax_rate: 13,
    tax_amount: 0
  };

  // 如果有更多列，可能是税率和税额
  if (dataParts.length >= 7) {
    item.tax_rate = parseFloat(dataParts[6]) || 13;
  }
  if (dataParts.length >= 8) {
    item.tax_amount = parseFloat(dataParts[7]) || 0;
  }

  // 自动计算
  if (item.amount === 0 && item.quantity > 0 && item.unit_price > 0) {
    item.amount = Math.round(item.quantity * item.unit_price * 100) / 100;
  }
  if (item.tax_amount === 0 && item.amount > 0) {
    item.tax_amount = Math.round(item.amount * (item.tax_rate / 100) * 100) / 100;
  }

  return item;
}

function parseItemLine(content) {
  // 尝试从自由文本中解析产品行
  // 模式: "氢氧化钠 工业级99% 10吨 3500元/吨 35000元"
  const amountMatch = content.match(/(\d+\.?\d*)\s*(?:元|¥|￥)/);
  const priceMatch = content.match(/(\d+\.?\d*)\s*(?:元\/吨|元\/kg|元\/千克|元\/个)/);
  const qtyMatch = content.match(/(\d+\.?\d*)\s*(?:吨|千克|kg|个|件|箱)/g);

  if (!amountMatch && !priceMatch) return null;

  return {
    product_name: cleanValue(content.split(/\d/)[0] || ''),
    specification: '',
    quantity: qtyMatch ? parseFloat(qtyMatch[0]) : 0,
    unit: qtyMatch && qtyMatch[0] ? (qtyMatch[0].match(/[吨千克kg个件箱]+/) || ['吨'])[0] : '吨',
    unit_price: priceMatch ? parseFloat(priceMatch[1]) : 0,
    amount: amountMatch ? parseFloat(amountMatch[1]) : 0,
    tax_rate: 13,
    tax_amount: 0
  };
}

// ==================== 阶段 5: 类型推断与校验 ====================

function inferContractType(text, contract) {
  if (/采购/.test(text) || /购买/.test(text)) return 'purchase';
  if (/销售/.test(text) || /出售/.test(text)) return 'sales';
  // 默认销售合同
  return 'sales';
}

function inferPartySide(role, contractType) {
  // 中文合同中通常:
  // 销售合同: 甲方=卖方, 乙方=买方
  // 采购合同: 甲方=买方, 乙方=卖方
  if (role === '甲方') return contractType === 'purchase' ? 'buyer' : 'seller';
  if (role === '乙方') return contractType === 'purchase' ? 'seller' : 'buyer';
  if (/买方|需方|客户/.test(role)) return 'buyer';
  if (/卖方|供方/.test(role)) return 'seller';
  return role === '甲方' ? 'buyer' : 'seller';
}

// ==================== 工具函数 ====================

/**
 * 按优先级尝试多组正则匹配，返回第一个捕获组
 */
function findField(text, patterns) {
  for (const pattern of patterns) {
    if (!pattern) continue;
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && match[1] && match[1].trim()) {
      return match[1].trim();
    }
  }
  return '';
}

/**
 * 清理字段值：去尾标点、去多余空白
 */
function cleanValue(val) {
  if (!val || typeof val !== 'string') return '';
  return val
    .replace(/[，,。；;、\s]+$/g, '')
    .replace(/^[：:\s]+/g, '')
    .trim();
}

/**
 * 解析金额字符串为数字
 * 处理: "15,000.00元", "￥15000", "1.5万元", "15000"
 */
function parseAmount(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;

  const str = String(val).replace(/[￥¥,，\s]/g, '');
  let multiplier = 1;

  if (/万元|万/.test(str)) multiplier = 10000;
  if (/亿元|亿/.test(str)) multiplier = 100000000;

  const num = parseFloat(str.replace(/[^0-9.]/g, ''));
  return (num || 0) * multiplier;
}

/**
 * 解析日期字符串为标准格式 YYYY-MM-DD
 */
function parseDate(val) {
  if (!val) return '';
  // 常见格式: 2026年07月14日, 2026/07/14, 2026-07-14
  const match = val.match(/(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})[日]?/);
  if (match) {
    const year = match[1];
    const month = match[2].padStart(2, '0');
    const day = match[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return val.trim();
}

module.exports = { extractEntities };
