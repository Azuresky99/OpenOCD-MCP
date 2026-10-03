// OpenOCD MCP Server — 监控工具（registers/memory/chip_info）
// 版本: 1.0.0  作者: 碧云天书  日期: 2026-06-21
// 许可: MIT License
import { z } from 'zod';
import type { OpenOCDClient } from '../openocd-client.js';
import { parseRegisters, parseMemory, parseFlashBanks } from '../tcl-parser.js';
import type { Tool } from './types.js';

/**
 * 创建监控和寄存器读取 MCP 工具
 * @param client - OpenOCDClient 实例
 * @returns Tool[] 包含 4 个监控工具
 */
export function createMonitorTools(client: OpenOCDClient): Tool[] {
  return [
    {
      name: 'monitor_registers',
      description: '读取全部 CPU 核心寄存器（R0-R15、CPSR 等）。CPU 必须处于暂停状态。',
      inputSchema: {
        cpu: z.number().optional().describe('CPU 核心编号，默认 0'),
      },
      handler: async (params: { cpu?: number }) => {
        const cpu = params.cpu ?? 0;
        await client.sendCommand(`targets ${cpu}`);
        const raw = await client.sendCommand('reg');
        const registers = parseRegisters(raw);
        return { registers };
      },
    },
    {
      name: 'monitor_register',
      description: '读取单个 CPU 寄存器的值。',
      inputSchema: {
        name: z.string().describe('寄存器名称，如 pc、sp、lr、r0 等'),
      },
      handler: async (params: { name: string }) => {
        const raw = await client.sendCommand(`reg ${params.name}`);
        const match = raw.match(/0x[0-9a-fA-F]+/);
        return { name: params.name, value: match ? match[0] : raw };
      },
    },
    {
      name: 'monitor_memory',
      description: '读取指定地址的内存数据。CPU 必须处于暂停状态。',
      inputSchema: {
        address: z.string().describe('起始地址，如 0x20000000'),
        length: z.string().describe('读取字数（word 为单位，1 word = 4 字节），如 16'),
        format: z.enum(['hex', 'word']).optional().describe('输出格式：hex（半字 hex 值）、word（按字显示），默认 hex'),
      },
      handler: async (params: { address: string; length: string; format?: 'hex' | 'word' }) => {
        const cmd = params.format === 'word' ? `mdw ${params.address} ${params.length}` : `mdh ${params.address} ${params.length}`;
        const raw = await client.sendCommand(cmd);
        const memory = parseMemory(raw);
        return { address: params.address, memory };
      },
    },
    {
      name: 'monitor_chip_info',
      description: '读取连接的 STM32 芯片信息：芯片 ID、Flash 大小、封装等。',
      inputSchema: {},
      handler: async () => {
        const results = await client.batchCommands([
          'halt',
          'flash banks',
          'targets',
          'resume',
        ]);
        const banks = parseFlashBanks(results[1]);
        return {
          targets: results[2],
          flashBanks: banks,
        };
      },
    },
  ];
}
