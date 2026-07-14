// parser.js - 文件解析服务
// 支持 PDF (.pdf) / Word (.docx) / Excel (.xlsx) 文本提取

const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');
const { PDFParse } = require('pdf-parse');

/**
 * 解析 PDF 文件，提取纯文本
 * 使用 pdf-parse v2 的 table-aware 模式
 */
async function parsePdf(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const pdf = new PDFParse({ data: dataBuffer });

  // 先尝试带 cellSeparator 表格模式
  let result = await pdf.getText({
    cellSeparator: ' ||| ',
    cellThreshold: 12,     // 列间距阈值(px)，超过此值视为不同列
    lineThreshold: 5,      // 行间距阈值(px)
    lineEnforce: true,     // 强制换行
  });

  const text = result.text || '';

  // 如果提取结果太少（可能是扫描版），用默认模式再试
  if (text.length < 50) {
    const pdf2 = new PDFParse({ data: dataBuffer });
    const r2 = await pdf2.getText();
    return r2.text || '';
  }

  return text;
}

/**
 * 解析 Word (.docx) 文件，提取纯文本
 */
async function parseDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || '';
}

/**
 * 解析 Excel (.xlsx) 文件，返回结构化文本和 cellMap
 */
async function parseExcelText(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const lines = [];
  const cellMap = new Map();

  workbook.eachSheet((worksheet, sheetIndex) => {
    if (sheetIndex > 0) lines.push('');

    const mergeMap = new Map();
    if (worksheet.model && worksheet.model.merges) {
      worksheet.model.merges.forEach((mergeRange) => {
        let top, left, bottom, right;
        if (typeof mergeRange === 'string') {
          const match = mergeRange.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
          if (match) {
            left = colLetterToNum(match[1]);
            top = parseInt(match[2]);
            right = colLetterToNum(match[3]);
            bottom = parseInt(match[4]);
          }
        } else if (mergeRange.top !== undefined) {
          top = mergeRange.top + 1;
          left = mergeRange.left + 1;
          bottom = mergeRange.bottom + 1;
          right = mergeRange.right + 1;
        }
        if (top !== undefined && left !== undefined) {
          for (let r = top; r <= bottom; r++) {
            for (let c = left; c <= right; c++) {
              if (r === top && c === left) continue;
              mergeMap.set(`${r},${c}`, { row: top, col: left });
            }
          }
        }
      });
    }

    worksheet.eachRow((row, rowNumber) => {
      const rowCells = [];
      row.eachCell((cell, colNumber) => {
        const key = `${rowNumber},${colNumber}`;
        if (mergeMap.has(key)) {
          const master = mergeMap.get(key);
          const masterKey = `${master.row},${master.col}`;
          if (cellMap.has(masterKey)) {
            cellMap.set(key, cellMap.get(masterKey));
          }
          return;
        }

        let value = cell.value;
        if (value === null || value === undefined) value = '';
        else if (typeof value === 'object' && value.richText) {
          value = value.richText.map(t => t.text || '').join('');
        } else if (typeof value === 'object' && value.result !== undefined) {
          // Formula cell: extract result first, then check for date
          value = value.result;
          if (value instanceof Date) {
            value = formatDate(value);
          } else if (typeof value === 'number' && value > 40000 && value < 60000 && (cell.numFmt && (cell.numFmt.includes('yy') || cell.numFmt.includes('dd')))) {
            value = formatSerialDate(value);
          }
        } else if (value instanceof Date) {
          value = formatDate(value);
        } else if (typeof value === 'number' && value > 40000 && value < 60000 && (cell.type === 4 || cell.numFmt === 'yyyy-mm-dd' || (cell.numFmt && cell.numFmt.includes('yy')))) {
          value = formatSerialDate(value);
        }

        const cellInfo = {
          value: String(value),
          type: cell.type || (typeof cell.value === 'number' ? 'number' : 'text')
        };

        cellMap.set(key, cellInfo);

        if (String(value).trim()) {
          const colLetter = numToColLetter(colNumber);
          rowCells.push(`[${colLetter}${rowNumber}] ${value}`);
        }
      });
      if (rowCells.length > 0) {
        lines.push(rowCells.join(' | '));
      }
    });
  });

  return {
    text: lines.join('\n'),
    cellMap: cellMap
  };
}

/**
 * 根据文件类型分发解析
 */
async function parseFile(filePath, fileType) {
  switch (fileType) {
    case 'pdf':
      return await parsePdf(filePath);
    case 'docx':
      return await parseDocx(filePath);
    case 'xlsx':
      return (await parseExcelText(filePath)).text;
    default:
      throw new Error('不支持的文件类型: ' + fileType);
  }
}

// ---- 日期格式化 ----

function formatDate(d) {
  if (!d || isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function formatSerialDate(serial) {
  // Excel 日期序列号转 JS Date (1900 日期系统)
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return formatDate(d);
}

// ---- 工具函数 ----

function colLetterToNum(letter) {
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 64);
  }
  return result;
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

module.exports = { parseFile, parsePdf, parseDocx, parseExcelText };
