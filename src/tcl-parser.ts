// OpenOCD MCP Server — Tcl 响应解析器
// 版本: 1.0.0  作者: 碧云天书  日期: 2026-06-21
// 许可: MIT License
export interface RegisterInfo {
  name: string;
  number: number;
  value: string;
}

export interface MemoryRow {
  address: string;
  value: string;
}

export interface FlashBankInfo {
  bank: number;
  driver: string;
  address: string;
  size: string;
}

/**
 * 解析 reg 命令的输出格式: (N) name (/32): 0xVALUE
 */
export function parseRegisters(raw: string): RegisterInfo[] {
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  const result: RegisterInfo[] = [];
  const regex = /^\((\d+)\)\s+(\w+)\s+\(\/\d+\):\s+(0x[0-9a-fA-F]+)/;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      result.push({
        number: parseInt(match[1], 10),
        name: match[2],
        value: match[3],
      });
    }
  }
  return result;
}

/**
 * 解析内存读取输出格式: ADDRESS: VALUE
 */
export function parseMemory(raw: string): MemoryRow[] {
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  const result: MemoryRow[] = [];
  const regex = /^(0x[0-9a-fA-F]+):\s+((?:0x)?[0-9a-fA-F]+)/;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      result.push({
        address: match[1],
        value: match[2],
      });
    }
  }
  return result;
}

/**
 * 解析 flash banks 输出为结构化 FlashBankInfo
 */
export function parseFlashBanks(raw: string): FlashBankInfo[] {
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  const result: FlashBankInfo[] = [];
  const regex = /^#(\d+)\s*:\s*(\S+)\s+at\s+(0x[0-9a-fA-F]+),\s*size\s+(0x[0-9a-fA-F]+)/;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      result.push({
        bank: parseInt(match[1], 10),
        driver: match[2],
        address: match[3],
        size: match[4],
      });
    }
  }
  return result;
}
