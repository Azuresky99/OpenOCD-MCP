// OpenOCD MCP Server — 透传工具（openocd_command）
// 版本: 1.0.0  作者: 碧云天书  日期: 2026-06-21
// 许可: MIT License
import { z } from 'zod';
import type { OpenOCDClient } from '../openocd-client.js';
import type { Tool } from './types.js';

/**
 * 创建原始命令透传工具
 */
export function createRawTool(client: OpenOCDClient): Tool[] {
  return [
    {
      name: 'openocd_command',
      description: '直接发送 Tcl 命令到 OpenOCD，返回原始输出。当其他高层工具无法满足需求时使用。常用命令示例：halt、resume、reg、mdw 0x08000000 16、flash banks、flash write_image erase file.bin、reset halt。',
      inputSchema: {
        command: z.string().describe('要执行的 Tcl 命令'),
        timeout: z.number().optional().describe('超时毫秒数，默认 10000'),
      },
      handler: async (params: { command: string; timeout?: number }) => {
        const result = await client.sendCommand(params.command, params.timeout);
        return { result };
      },
    },
  ];
}
