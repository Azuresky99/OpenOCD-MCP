import { describe, it, expect } from 'vitest';
import { parseRegisters, parseMemory, parseFlashBanks } from '../tcl-parser.js';

describe('parseRegisters', () => {
  it('解析标准寄存器行', () => {
    const input = '(0) r0 (/32): 0x00000000\n(1) r1 (/32): 0xDEADBEEF';
    const result = parseRegisters(input);
    expect(result).toEqual([
      { name: 'r0', number: 0, value: '0x00000000' },
      { name: 'r1', number: 1, value: '0xDEADBEEF' },
    ]);
  });

  it('处理空输入', () => {
    expect(parseRegisters('')).toEqual([]);
  });

  it('解析真实 reg 命令的输出格式', () => {
    const input = `(0) r0 (/32): 0x20001000
(13) sp (/32): 0x20002000
(14) lr (/32): 0x08001234
(15) pc (/32): 0x08005678`;
    const result = parseRegisters(input);
    expect(result).toHaveLength(4);
    expect(result[3]).toEqual({ name: 'pc', number: 15, value: '0x08005678' });
  });
});

describe('parseMemory', () => {
  it('解析 mdw 输出格式', () => {
    const input = '0x08000000: 20001000\n0x08000004: 08001234';
    const result = parseMemory(input);
    expect(result).toEqual([
      { address: '0x08000000', value: '20001000' },
      { address: '0x08000004', value: '08001234' },
    ]);
  });
});

describe('parseFlashBanks', () => {
  it('解析 Flash Bank 信息输出', () => {
    const input = '#0 : stm32f1x.flash at 0x08000000, size 0x00010000, buswidth 0, chipwidth 0';
    const result = parseFlashBanks(input);
    expect(result).toEqual([
      {
        bank: 0,
        driver: 'stm32f1x.flash',
        address: '0x08000000',
        size: '0x00010000',
      },
    ]);
  });
});
