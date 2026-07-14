// parser.js - 文件解析服务
// 支持 PDF (.pdf) / Word (.docx) / Excel (.xlsx) 文本提取

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');

/**
 * 解析 PDF 文件，提取纯文本
 */
async function parsePdf(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text || '';
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
 * @returns {{ text: string, cellMap: Map<string, {value: any, type: string}> }}
 */
async function parseExcelText(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const lines = [];
  const cellMap = new Map(); // key: "row,col" → {value, type}

  workbook.eachSheet((worksheet, sheetIndex) => {
    if (sheetIndex > 0) lines.push(''); // sheet 间分隔

    // 处理合并单元格：建立合并区域到主单元格的映射
    const mergeMap = new Map(); // key: "row,col" → {row, col} of master cell
    if (worksheet.model && worksheet.model.merges) {
      worksheet.model.merges.forEach((mergeRange) => {
        // mergeRange 可能是字符串 "A1:C3" 或包含 top/left/bottom/right 的对象
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
              if (r === top && c === left) continue; // 主单元格
              mergeMap.set(`${r},${c}`, { row: top, col: left });
            }
          }
        }
      });
    }

    worksheet.eachRow((row, rowNumber) => {
      const rowCells = [];
      row.eachCell((cell, colNumber) => {
        // 跳过合并单元格中的从属单元格
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
          value = value.result; // formula result
        }

        const cellInfo = {
          value: String(value),
          type: cell.type || (typeof cell.value === 'number' ? 'number' : 'text')
        };

        cellMap.set(key, cellInfo);

        if (String(value).trim()) {
          const colLetter = numToColLetter(colNumber);
          const addr = `${colLetter}${rowNumber}`;
          rowCells.push(`[${addr}] ${value}`);
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
 * @param {string} filePath
 * @param {string} fileType - 'pdf' | 'docx' | 'xlsx'
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
