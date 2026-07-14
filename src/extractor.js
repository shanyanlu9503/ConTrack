// extractor.js - 实体提取引擎 (v2 - 逐行解析)
// 从合同文本中自动提取公司信息、合同信息、产品明细

/**
 * 主入口：从原始文本中提取结构化实体数据
 */
function extractEntities(rawText, fileType) {
  if (!rawText || !rawText.trim()) {
    return { parties: [], contract: {}, items: [], raw_text: rawText };
  }

  let fullText = rawText;
  let parties = null;

  // 预处理1: Excel格式 - 智能检测表格 vs 自由格式
  if (/\[[A-Z]+\d+\]/.test(rawText)) {
    const lines = rawText.split('\n').filter(l => l.includes('|'));
    const cellCounts = lines.map(l => l.split('|').length);
    // 统计4列行的占比来判断是否为双栏表格
    const fourColCount = cellCounts.filter(c => c === 4).length;
    const isTableLayout = cellCounts.length >= 3 && (fourColCount / cellCounts.length) >= 0.4;
    if (isTableLayout) {
      fullText = fullText
        .replace(/\[[A-Z]+\d+\][ \t]*/g, '')
        .replace(/[ \t]*\|[ \t]*/g, ' ||| ');
    } else {
      fullText = fullText
        .replace(/\[[A-Z]+\d+\][ \t]*/g, '')
        .replace(/[ \t]*\|[ \t]*/g, ' ');
    }
  }

  // 预处理2: 表格分隔符格式 (PDF/Excel)
  if (fullText.includes(' ||| ')) {
    const preprocessed = preprocessTableText(fullText);
    fullText = preprocessed.fullText;
    parties = preprocessed.parties;
  }

  // 预处理3: Word/mammoth 双栏交错格式
  if (!parties && detectInterleavedFormat(fullText)) {
    const preprocessed = preprocessInterleavedText(fullText);
    fullText = preprocessed.fullText;
    parties = preprocessed.parties;
  }

  // 按行分割
  const lines = normalizeLines(fullText);

  // 阶段 1: 划分当事人文本区域
  const partySections = splitPartySections(lines);

  // 阶段 2: 逐行提取每个当事人的字段
  const extractedParties = partySections.map(sec =>
    extractFieldsFromSection(sec.lines, sec.role, sec.side, sec.fullText)
  );

  // 如果表格预处理已识别当事人，合并信息（表格数据更精确）
  if (parties) {
    for (let i = 0; i < Math.min(parties.length, extractedParties.length); i++) {
      // 表格数据优先，空缺字段用逐行提取补充
      extractedParties[i] = mergePartyData(parties[i], extractedParties[i]);
    }
  }

  // 阶段 3: 提取合同级字段
  const contract = extractContractFields(fullText);

  // 阶段 4: 提取产品明细
  const items = extractItems(fullText, fileType);

  // 阶段 5: 类型推断与校验
  contract.contract_type = inferContractType(fullText, contract);
  extractedParties.forEach(party => {
    party.side = inferPartySide(party.role, party.side, contract.contract_type, fullText);
  });

  // 校验和清理
  validateParties(extractedParties);

  // 自动汇总
  if ((!contract.total_amount) && items.length > 0) {
    contract.total_amount = items.reduce((sum, it) => sum + (it.amount || 0), 0);
    if (!contract.tax_amount) {
      contract.tax_amount = items.reduce((sum, it) => sum + (it.tax_amount || 0), 0);
    }
  }

  return { parties: extractedParties, contract, items, raw_text: rawText };
}

// ==================== 双列表格预处理 ====================

/**
 * 将 pdf-parse v2 的 cellSeparator 表格输出转为标准文本格式
 * 表格格式: 每行列1=甲方标签 | 列2=甲方值 | 列3=乙方标签 | 列4=乙方值
 */
function preprocessTableText(rawText) {
  const labelMap = {
    '单位名称': '单位名称', '公司名称': '单位名称',
    '甲': '单位名称', '乙': '单位名称',  // 表头行的公司名
    '住所': '地址', '地址': '地址',
    '法定代表人': '法定代表人', '法人': '法定代表人',
    '委托代理人': '委托代理人', '代理人': '委托代理人', '联系人': '委托代理人',
    '电话': '电话', '联系电话': '电话',
    '开户行': '开户行', '开户银行': '开户行',
    '账号': '账号', '银行账号': '账号',
    '税号': '税号', '纳税人识别号': '税号',
  };

  // 产品相关标签（不应归于当事人信息）
  const productLabels = new Set(['产品名称', '规格', '规格型号', '数量', '单位', '单价', '金额', '税率', '税额']);

  const lines = rawText.split('\n').filter(l => l.trim());
  const partyALines = [];
  const partyBLines = [];
  const otherLines = [];

  let partyARole = '甲方';
  let partyBRole = '乙方';

  for (const line of lines) {
    if (!line.includes(' ||| ')) {
      otherLines.push(line);
      continue;
    }

    const cells = line.split(' ||| ').map(c => c.trim());

    // 4列=双栏表格
    if (cells.length >= 4) {
      const aLabel = cells[0] || '';
      const aValue = cells[1] || '';
      const bLabel = cells[2] || '';
      const bValue = cells[3] || '';

      // 检测当事人角色
      if (aLabel === '甲' || aLabel === '卖方' || aLabel === '供方') {
        partyARole = aLabel === '供方' ? '供方' : (aLabel === '卖方' ? '卖方' : '甲方');
      }
      if (bLabel === '乙' || bLabel === '买方' || bLabel === '需方') {
        partyBRole = bLabel === '需方' ? '需方' : (bLabel === '买方' ? '买方' : '乙方');
      }

      // 产品行放 otherLines
      if (productLabels.has(aLabel) || productLabels.has(bLabel)) {
        if (aValue) otherLines.push(`${aLabel}：${aValue}`);
        if (bValue) otherLines.push(`${bLabel}：${bValue}`);
        continue;
      }

      // 映射标签
      const mappedALabel = labelMap[aLabel] || aLabel;
      const mappedBLabel = labelMap[bLabel] || bLabel;

      if (aLabel && aLabel !== '方' && aValue) {
        partyALines.push(`${mappedALabel}：${aValue}`);
      }
      if (bLabel && bLabel !== '方' && bValue) {
        partyBLines.push(`${mappedBLabel}：${bValue}`);
      }
    } else if (cells.length >= 2) {
      // 2-3列：key-value 格式，放入 otherLines 由逐行提取处理
      for (const cell of cells) {
        if (cell && cell.trim()) otherLines.push(cell.trim());
      }
    }
  }

  // 构建标准格式文本
  const fullText = [
    `${partyARole}：`,
    ...partyALines,
    '',
    `${partyBRole}：`,
    ...partyBLines,
    '',
    ...otherLines,
  ].join('\n');

  // 预提取当事人基本信息
  const parties = [
    extractFieldsFromSection(partyALines, partyARole, guessSide(partyARole, fullText), ''),
    extractFieldsFromSection(partyBLines, partyBRole, guessSide(partyBRole, fullText), ''),
  ];

  return { fullText, parties };
}

/**
 * 合并两个 party 数据，tableParty 优先
 */
function mergePartyData(tableParty, lineParty) {
  const merged = { ...lineParty, ...tableParty };
  // 保留非空的 tableParty 值，否则用 lineParty
  Object.keys(merged).forEach(key => {
    if (tableParty[key] && tableParty[key].trim()) {
      merged[key] = tableParty[key];
    } else if (lineParty[key] && lineParty[key].trim()) {
      merged[key] = lineParty[key];
    }
  });
  return merged;
}

// ==================== Word 双栏交错格式预处理 ====================

// 已知的当事人字段标签（会出现在表格两列中的）
const PARTY_FIELD_LABELS = new Set([
  '甲', '乙', '甲方', '乙方', '买方', '卖方', '需方', '供方',
  '单位名称', '住所', '地址', '法定代表人', '法人',
  '委托代理人', '代理人', '联系人', '电话', '联系电话',
  '开户行', '开户银行', '账号', '银行账号', '税号', '纳税人识别号',
]);

/**
 * 检测 Word/mammoth 双栏交错格式：
 * 标签和值交替出现在各独立行中，同一标签在短窗口内出现两次
 */
function detectInterleavedFormat(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const labelCount = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (PARTY_FIELD_LABELS.has(trimmed)) {
      labelCount.set(trimmed, (labelCount.get(trimmed) || 0) + 1);
    }
  }
  // 至少有2个标签出现了2次 = 双栏结构
  let dupCount = 0;
  for (const count of labelCount.values()) {
    if (count >= 2) dupCount++;
  }
  return dupCount >= 2;
}

/**
 * 将 Word/mammoth 交替格式转为标准两段文本
 * 输入: 标签1\n值1\n标签2\n值2\n... (左右列交替)
 * 输出: 甲方：\n标签1：值1\n...\n\n乙方：\n标签1：值2\n...
 */
function preprocessInterleavedText(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const partyALines = [];
  const partyBLines = [];
  const otherLines = [];

  let partyARole = '甲方';
  let partyBRole = '乙方';

  // 收集所有的标签-值对
  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (PARTY_FIELD_LABELS.has(line) && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      // 如果下一行也是已知标签，跳过（可能是连续标签）
      if (PARTY_FIELD_LABELS.has(nextLine)) continue;
      pairs.push({ label: line, value: nextLine });
      i++; // 跳过值行
    } else {
      otherLines.push(line);
    }
  }

  // 将标签-值对按交替位置奇偶分配给两个当事人
  // 双栏表格中标签交替出现：偶索引→甲方(左列)，奇索引→乙方(右列)
  for (let idx = 0; idx < pairs.length; idx++) {
    const pair = pairs[idx];
    const normLabel = normalizeLabel(pair.label);
    const isPartyA = (idx % 2 === 0);

    // 检测当事人角色
    if (pair.label === '甲' || pair.label === '甲方' || pair.label === '卖方' || pair.label === '供方') {
      if (isPartyA) partyARole = pair.label; else partyBRole = pair.label;
    }
    if (pair.label === '乙' || pair.label === '乙方' || pair.label === '买方' || pair.label === '需方') {
      if (isPartyA) partyARole = pair.label; else partyBRole = pair.label;
    }

    if (isPartyA) {
      partyALines.push(`${normLabel}：${pair.value}`);
    } else {
      partyBLines.push(`${normLabel}：${pair.value}`);
    }
  }

  const fullText = [
    `${partyARole}：`,
    ...partyALines,
    '',
    `${partyBRole}：`,
    ...partyBLines,
    '',
    ...otherLines,
  ].join('\n');

  const parties = [
    extractFieldsFromSection(partyALines, partyARole, guessSide(partyARole, fullText), ''),
    extractFieldsFromSection(partyBLines, partyBRole, guessSide(partyBRole, fullText), ''),
  ];

  return { fullText, parties };
}

function normalizeLabel(label) {
  const map = {
    '甲': '单位名称', '乙': '单位名称',
    '甲方': '单位名称', '乙方': '单位名称',
    '买方': '单位名称', '卖方': '单位名称',
    '需方': '单位名称', '供方': '单位名称',
    '住所': '地址', '法人': '法定代表人',
    '代理人': '委托代理人', '联系人': '委托代理人',
    '单位名称': '单位名称', '公司名称': '单位名称',
    '法定代表人': '法定代表人', '委托代理人': '委托代理人',
    '电话': '电话', '联系电话': '电话',
    '开户行': '开户行', '开户银行': '开户行',
    '账号': '账号', '银行账号': '账号',
    '税号': '税号', '纳税人识别号': '税号',
  };
  return map[label] || label;
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
      new RegExp('^'+role+'[：:]\\s*(\\S+[\\s\\S]*?)(?=\\s{2,}|$)'),
      new RegExp('^'+role+'[：:](.+)'),
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

  // 方案A: 检测表头行 + 列映射（优先级最高）
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/产品名称|品名/.test(line) && (/规格/.test(line) || /数量/.test(line) || /单价/.test(line))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx >= 0) {
    const dataLines = [];
    for (let i = headerIdx + 1; i < lines.length && i < headerIdx + 50; i++) {
      if (/^[二三四五六七八九十]、/.test(lines[i])) break;
      if (/合计人民币|总计|小计|备注|签订|盖章/.test(lines[i])) break;
      dataLines.push(lines[i]);
    }
    const tableItems = extractItemsFromTableWithHeader(lines[headerIdx], dataLines);
    if (tableItems && tableItems.length > 0) return tableItems;
  }

  // 方案B: 找到产品明细区域逐行提取 key: value 格式
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

/**
 * 从表头行检测列映射，然后用映射提取数据行
 */
function extractItemsFromTableWithHeader(headerLine, dataLines) {
  const items = [];
  // 解析表头确定列映射
  const headerParts = headerLine.split(/[\s]{2,}/).filter(h => h.trim());
  const colMap = []; // colMap[index] = field name

  for (const h of headerParts) {
    const hLower = h.toLowerCase().replace(/\s/g, '');
    if (/序号|#|no/i.test(hLower)) colMap.push('_skip');
    else if (/产品名称|品名|商品名称|名称/.test(h)) colMap.push('product_name');
    else if (/规格|型号|规格型号/.test(h)) colMap.push('specification');
    else if (/含税单价|单价|价格/.test(h)) colMap.push('unit_price');
    else if (/数量/.test(h)) colMap.push('quantity');
    else if (/单位/.test(h)) colMap.push('unit');
    else if (/总额|金额|总价|合计金额/.test(h)) colMap.push('amount');
    else if (/税率/.test(h)) colMap.push('tax_rate');
    else if (/税额/.test(h)) colMap.push('tax_amount');
    else if (/备注/.test(h)) colMap.push('remark');
    else colMap.push('_unknown');
  }

  // 如果没检测到合理映射，回退到默认顺序
  if (!colMap.includes('product_name')) {
    return null;
  }

  // 处理数据行
  for (const line of dataLines) {
    if (/合计|总计|备注|签订|盖章/.test(line)) continue;
    if (line.trim().length < 5) continue;

    const dataParts = line.split(/[\s]{2,}/).filter(p => p.trim());
    if (dataParts.length < 2) continue;

    const item = { tax_rate: 13, tax_amount: 0 };

    // colMap 和 dataParts 按位置一一对应（表头已包含序号列）
    for (let i = 0; i < colMap.length && i < dataParts.length; i++) {
      const field = colMap[i];
      if (field === '_skip' || field === '_unknown') continue;
      const val = dataParts[i]?.trim();
      if (!val || val === '') continue;

      if (field === 'product_name' || field === 'specification' || field === 'unit') {
        item[field] = cleanValue(val);
      } else {
        const numVal = parseFloat(val.replace(/[,，\s]/g, ''));
        if (!isNaN(numVal)) item[field] = numVal;
      }
    }

    if (item.product_name || item.amount > 0 || (item.quantity > 0 && item.unit_price > 0)) {
      items.push(finalizeItem(item));
    }
  }

  return items;
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
