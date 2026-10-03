// OpenOCD MCP Server — 烧录工具（write/erase/read/info）
// 版本: 1.0.0  作者: 碧云天书  日期: 2026-06-21
// 许可: MIT License
import { z } from 'zod';
import type { OpenOCDClient } from '../openocd-client.js';
import { parseFlashBanks } from '../tcl-parser.js';
import type { Tool } from './types.js';

/**
 * 创建 Flash 烧录相关 MCP 工具
 * @param client - OpenOCDClient 实例
 * @returns Tool[] 包含 4 个烧录工具
 */
export function createFlashTools(client: OpenOCDClient): Tool[] {
  return [
    {
      name: 'flash_write',
      description: '烧录固件到 STM32 Flash。支持 .bin/.hex/.elf 格式，可选烧录后验证。',
      inputSchema: {
        file: z.string().describe('固件文件路径（绝对路径或相对于当前工作目录）'),
        address: z.string().optional().describe('烧录起始地址，如 0x08000000。不指定则使用默认地址'),
        verify: z.boolean().optional().describe('是否烧录后验证，默认 true'),
      },
      handler: async (params: { file: string; address?: string; verify?: boolean }) => {
        const verify = params.verify !== false;
        const cmds: string[] = ['halt'];

        if (params.address) {
          cmds.push(`flash write_image erase ${params.file} ${params.address}`);
        } else {
          cmds.push(`flash write_image erase ${params.file}`);
        }

        if (verify) {
          if (params.address) {
            cmds.push(`verify_image ${params.file} ${params.address}`);
          } else {
            cmds.push(`verify_image ${params.file}`);
          }
        }
        cmds.push('resume');

        const results = await client.batchCommands(cmds);
        return { success: true, results };
      },
    },
    {
      name: 'flash_erase',
      description: '擦除 STM32 Flash 扇区。',
      inputSchema: {
        bank: z.number().optional().describe('Flash Bank 编号，默认 0'),
        address: z.string().optional().describe('擦除起始地址'),
        length: z.string().optional().describe('擦除长度，如 0x1000'),
      },
      handler: async (params: { bank?: number; address?: string; length?: string }) => {
        const bank = params.bank ?? 0;
        const cmds = ['halt'];

        if (params.address && params.length) {
          cmds.push(`flash erase_address ${params.address} ${params.length}`);
        } else {
          cmds.push(`flash erase_sector ${bank} 0 last`);
        }
        cmds.push('resume');

        const results = await client.batchCommands(cmds);
        return { success: true, results };
      },
    },
    {
      name: 'flash_read',
      description: '读取 STM32 Flash 内容并保存到文件。',
      inputSchema: {
        address: z.string().describe('读取起始地址，如 0x08000000'),
        length: z.string().describe('读取长度，如 0x1000'),
        outputFile: z.string().optional().describe('输出文件路径，不指定则返回 hex 数据'),
      },
      handler: async (params: { address: string; length: string; outputFile?: string }) => {
        const cmds = ['halt'];
        if (params.outputFile) {
          cmds.push(`flash read_bank 0 ${params.outputFile} ${params.address} ${params.length}`);
        } else {
          const lengthNum = parseInt(params.length, 16);
          if (isNaN(lengthNum)) {
            throw new Error(`无效的十六进制长度值: ${params.length}`);
          }
          cmds.push(`mdw ${params.address} ${Math.ceil(lengthNum / 4)}`);
        }
        cmds.push('resume');

        const results = await client.batchCommands(cmds);
        return { success: true, results };
      },
    },
    {
      name: 'flash_info',
      description: '查询 STM32 Flash 容量、扇区布局和写保护状态。',
      inputSchema: {},
      handler: async () => {
        const results = await client.batchCommands(['halt', 'flash banks', 'flash info 0', 'resume']);
        const banks = parseFlashBanks(results[1]);
        return { banks, rawInfo: results[2] };
      },
    },
  ];
}
