// template-analyzer.js - 模板自动生成
// 从导入的合同文件中提取结构，将实际数据替换为占位符，创建可复用模板

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { parseExcelText } = require('./parser');

// 标准占位符映射
const PLACEHOLDER_MAP = {
  buyer_name: '{buyer_name}',
  buyer_address: '{buyer_address}',
  buyer_legal_representative: '{buyer_legal_representative}',
  buyer_agent: '{buyer_agent}',
  buyer_phone: '{buyer_phone}',
  buyer_bank: '{buyer_bank}',
  buyer_bank_account: '{buyer_bank_account}',
  buyer_tax_number: '{buyer_tax_number}',
  seller_name: '{seller_name}',
  seller_address: '{seller_address}',
  seller_legal_representative: '{seller_legal_representative}',
  seller_agent: '{seller_agent}',
  seller_phone: '{seller_phone}',
  seller_bank: '{seller_bank}',
  seller_bank_account: '{seller_bank_account}',
  seller_tax_number: '{seller_tax_number}',
  contract_no: '{contract_no}',
  sign_date: '{sign_date}',
  total_amount: '{total_amount}',
  tax_amount: '{tax_amount}',
};

/**
 * 从 Excel 文件生成模板
 * @param {string} filePath - 源文件路径
 * @param {object} extractedData - extractEntities 返回的提取数据
 * @param {string} outputDir - 输出目录 (templates/)
 * @returns {object} { success, template_path, placeholder_map }
 */
async function analyzeExcelTemplate(filePath, extractedData, outputDir) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Excel 文件中没有工作表');
  }

  const placeholderMap = {}; // 记录每个占位符对应的位置，供后续合同生成使用

  // 收集所有需要替换的值 → 占位符映射
  const valueReplacements = buildValueReplacements(extractedData);

  // 遍历所有单元格，替换匹配的值
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, colNumber) => {
      let cellValue = cell.value;
      if (cellValue === null || cellValue === undefined) return;

      // 获取单元格的文本内容
      let textValue = '';
      if (typeof cellValue === 'string') {
        textValue = cellValue;
      } else if (typeof cellValue === 'number') {
        textValue = String(cellValue);
      } else if (typeof cellValue === 'object' && cellValue.richText) {
        textValue = cellValue.richText.map(t => t.text || '').join('');
      }

      if (!textValue || !textValue.trim()) return;

      // 精确匹配：检查是否与某个提取值完全一致
      for (const [placeholder, originalValue] of Object.entries(valueReplacements)) {
        if (!originalValue || String(originalValue).trim() === '') continue;

        const valStr = String(originalValue).trim();

        // 完全匹配
        if (textValue.trim() === valStr) {
          cell.value = PLACEHOLDER_MAP[placeholder];
          const colLetter = numToColLetter(colNumber);
          placeholderMap[placeholder] = `${colLetter}${rowNumber}`;
          break;
        }

        // 部分匹配：单元格内容包含该值
        if (valStr.length > 2 && textValue.includes(valStr)) {
          const newValue = textValue.replace(valStr, PLACEHOLDER_MAP[placeholder]);
          if (newValue !== textValue) {
            cell.value = newValue;
            const colLetter = numToColLetter(colNumber);
            placeholderMap[placeholder] = `${colLetter}${rowNumber}`;
            break;
          }
        }
      }
    });
  });

  // 处理产品明细表：查找表头行，清空数据，留一行模板
  let headerRowNum = -1;
  const productColumns = {
    product_name: -1, specification: -1, quantity: -1,
    unit: -1, unit_price: -1, amount: -1, tax_rate: -1, tax_amount: -1, remark: -1
  };

  worksheet.eachRow((row, rowNumber) => {
    const rowText = [];
    row.eachCell((cell, colNumber) => {
      if (cell.value) rowText.push(`${String(cell.value).trim()}[col${colNumber}]`);
    });
    const lineText = rowText.join(' ');

    // 检测产品明细表头
    if (/产品名称|品名|商品名称|名称/.test(lineText) &&
        /规格/.test(lineText) &&
        /数量/.test(lineText) &&
        /单价/.test(lineText)) {
      headerRowNum = rowNumber;

      // 识别每列对应哪个字段
      const headerMap = {};
      row.eachCell((cell, colNumber) => {
        const v = String(cell.value || '').trim();
        headerMap[colNumber] = v;
        if (/产品名称|品名|商品名称|名称/.test(v)) productColumns.product_name = colNumber;
        else if (/规格|型号/.test(v)) productColumns.specification = colNumber;
        else if (/数量/.test(v)) productColumns.quantity = colNumber;
        else if (/单位/.test(v)) productColumns.unit = colNumber;
        else if (/单价/.test(v)) productColumns.unit_price = colNumber;
        else if (/金额|总价/.test(v)) productColumns.amount = colNumber;
        else if (/税率/.test(v)) productColumns.tax_rate = colNumber;
        else if (/税额/.test(v)) productColumns.tax_amount = colNumber;
        else if (/备注/.test(v)) productColumns.remark = colNumber;
      });
    }
  });

  if (headerRowNum > 0) {
    // 清空表头后所有数据行
    const totalRows = worksheet.rowCount;
    const dataStartRow = headerRowNum + 1;

    // 从最后一行往前删，避免行号变化
    for (let r = totalRows; r > dataStartRow; r--) {
      worksheet.spliceRows(r, 1);
    }

    // 在表头下插入一行模板行
    const templateRow = worksheet.getRow(dataStartRow);
    // 序号列
    if (headerRowNum > 0) {
      const headerRow = worksheet.getRow(headerRowNum);
      headerRow.eachCell((cell, colNumber) => {
        const headerVal = String(cell.value || '');
        if (/序号|No|#/.test(headerVal)) {
          templateRow.getCell(colNumber).value = '{item_no}';
        }
      });
    }

    // 产品列
    Object.entries(productColumns).forEach(([field, col]) => {
      if (col > 0) {
        templateRow.getCell(col).value = `{item_${field}}`;
        placeholderMap[`item_${field}`] = `${numToColLetter(col)}${dataStartRow}`;
      }
    });

    // 记录表头行和起始行
    placeholderMap['_item_start_row'] = dataStartRow;
    placeholderMap['_header_row'] = headerRowNum;
    placeholderMap['_item_columns'] = JSON.stringify(productColumns);
  }

  // 保存模板文件
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const templateFileName = `auto_template_xlsx_${timestamp}_${Date.now() % 100000}.xlsx`;
  const templatePath = path.join(outputDir, templateFileName);
  await workbook.xlsx.writeFile(templatePath);

  return {
    success: true,
    template_path: templatePath,
    template_name: templateFileName,
    placeholder_map: placeholderMap
  };
}

/**
 * 从 Word 文件生成模板（简化版——直接替换文本）
 * Word 模板生成局限性大，只做简单的文本替换
 */
async function analyzeWordTemplate(filePath, extractedData, outputDir) {
  // Word 模板的自动生成非常复杂且不可靠
  // 这里只生成一个简单的文本型模板描述文件
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const templateFileName = `auto_template_docx_${timestamp}_${Date.now() % 100000}.docx`;

  // 复制原文件作为模板基础（用户需要手动编辑）
  const outputPath = path.join(outputDir, templateFileName);
  fs.copyFileSync(filePath, outputPath);

  // 生成占位符映射（供用户参考）
  const placeholderMap = {};
  const valueReplacements = buildValueReplacements(extractedData);
  Object.keys(valueReplacements).forEach(key => {
    placeholderMap[key] = PLACEHOLDER_MAP[key] || `{${key}}`;
  });

  return {
    success: true,
    template_path: outputPath,
    template_name: templateFileName,
    placeholder_map: placeholderMap,
    warning: 'Word 模板已复制，但需要手动编辑：将实际值替换为占位符 ' +
      '例如: 公司名称 → {buyer_name}。请用 Word 打开后手动替换。'
  };
}

// ==================== 工具函数 ====================

/**
 * 从提取数据构建值→占位符映射
 */
function buildValueReplacements(extractedData) {
  const replacements = {};

  if (extractedData.parties && extractedData.parties.length >= 2) {
    const buyer = extractedData.parties.find(p => p.side === 'buyer') || extractedData.parties[0];
    const seller = extractedData.parties.find(p => p.side === 'seller') || extractedData.parties[1];

    if (buyer) {
      replacements.buyer_name = buyer.name;
      replacements.buyer_address = buyer.address;
      replacements.buyer_legal_representative = buyer.legal_representative;
      replacements.buyer_agent = buyer.agent;
      replacements.buyer_phone = buyer.phone;
      replacements.buyer_bank = buyer.bank;
      replacements.buyer_bank_account = buyer.bank_account;
      replacements.buyer_tax_number = buyer.tax_number;
    }
    if (seller) {
      replacements.seller_name = seller.name;
      replacements.seller_address = seller.address;
      replacements.seller_legal_representative = seller.legal_representative;
      replacements.seller_agent = seller.agent;
      replacements.seller_phone = seller.phone;
      replacements.seller_bank = seller.bank;
      replacements.seller_bank_account = seller.bank_account;
      replacements.seller_tax_number = seller.tax_number;
    }
  }

  if (extractedData.contract) {
    const c = extractedData.contract;
    if (c.contract_no) replacements.contract_no = c.contract_no;
    if (c.sign_date) replacements.sign_date = c.sign_date;
    if (c.total_amount) replacements.total_amount = c.total_amount;
    if (c.tax_amount) replacements.tax_amount = c.tax_amount;
  }

  return replacements;
}

function numToColLetter(num) {
  let result = '';
  while (num > 0) {
    num--;
    result = String.fromCharCode(65 + (num % 26)) + result;
    num = Math.floor(num / 26);
  }
  return result;
}

module.exports = { analyzeExcelTemplate, analyzeWordTemplate, PLACEHOLDER_MAP };
