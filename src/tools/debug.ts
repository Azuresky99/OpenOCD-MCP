// OpenOCD MCP Server — 调试工具（halt/resume/step/reset/bp）
// 版本: 1.0.0  作者: 碧云天书  日期: 2026-06-21
// 许可: MIT License
import { z } from 'zod';
import type { OpenOCDClient } from '../openocd-client.js';
import type { Tool } from './types.js';

/**
 * 创建调试相关的 MCP 工具
 * @param client - OpenOCDClient 实例
 * @returns Tool[] 包含 7 个调试工具
 */
export function createDebugTools(client: OpenOCDClient): Tool[] {
  return [
    {
      name: 'debug_halt',
      description: '暂停 CPU 运行。暂停后可读取寄存器或内存。',
      inputSchema: {},
      handler: async () => {
        const result = await client.sendCommand('halt');
        return { success: true, result };
      },
    },
    {
      name: 'debug_resume',
      description: '恢复 CPU 运行。',
      inputSchema: {},
      handler: async () => {
        const result = await client.sendCommand('resume');
        return { success: true, result };
      },
    },
    {
      name: 'debug_step',
      description: '单步执行指令。CPU 执行后处于暂停状态。',
      inputSchema: {
        count: z.number().optional().describe('执行步数，默认 1'),
      },
      handler: async (params: { count?: number }) => {
        const count = params.count ?? 1;
        const result = await client.sendCommand(`step ${count}`);
        return { success: true, result };
      },
    },
    {
      name: 'debug_reset',
      description: '复位 CPU，可选择复位后状态。',
      inputSchema: {
        type: z.enum(['run', 'halt', 'init']).describe('复位类型：run（复位后运行）、halt（复位后暂停）、init（复位后执行初始化脚本）'),
      },
      handler: async (params: { type: 'run' | 'halt' | 'init' }) => {
        const result = await client.sendCommand(`reset ${params.type}`);
        return { success: true, result };
      },
    },
    {
      name: 'debug_set_breakpoint',
      description: '在指定地址设置断点。支持硬件断点和软件断点。',
      inputSchema: {
        address: z.string().describe('断点地址，如 0x08001234'),
        hw: z.boolean().optional().describe('是否使用硬件断点，默认 false（软件断点）'),
      },
      handler: async (params: { address: string; hw?: boolean }) => {
        const cmd = params.hw ? `bp ${params.address} 2 hw` : `bp ${params.address} 2`;
        const result = await client.sendCommand(cmd);
        return { success: true, result };
      },
    },
    {
      name: 'debug_remove_breakpoint',
      description: '移除指定地址的断点。',
      inputSchema: {
        address: z.string().describe('要移除的断点地址'),
      },
      handler: async (params: { address: string }) => {
        const result = await client.sendCommand(`rbp ${params.address}`);
        return { success: true, result };
      },
    },
    {
      name: 'debug_list_breakpoints',
      description: '列出当前所有断点。',
      inputSchema: {},
      handler: async () => {
        const result = await client.sendCommand('bp');
        return { success: true, breakpoints: result };
      },
    },
  ];
}
