// OpenOCD MCP Server — 配置工具（start/stop/status）
// 版本: 1.0.0  作者: 碧云天书  日期: 2026-06-21
// 许可: MIT License
import { z } from 'zod';
import type { OpenOCDClient, OpenOCDConfig } from '../openocd-client.js';
import type { Tool } from './types.js';

/**
 * 创建配置相关的 MCP 工具（启动/停止/状态）
 */
export function createConfigTools(client: OpenOCDClient, defaultConfig: Partial<OpenOCDConfig>): Tool[] {
  let currentConfig: OpenOCDConfig | null = null;

  return [
    {
      name: 'openocd_start',
      description: '启动 OpenOCD 并连接到目标 STM32 芯片，烧录或调试前请先调用此工具。',
      inputSchema: {
        interface: z.string().optional().describe('调试器类型，如 stlink、jlink、cmsis-dap，默认使用环境变量 OPENOCD_INTERFACE 或 stlink'),
        target: z.string().optional().describe('目标芯片类型，如 stm32f1x、stm32f4x，默认使用环境变量 OPENOCD_TARGET 或 stm32f1x'),
        speed: z.number().optional().describe('调试时钟速度（kHz），默认自动适配'),
      },
      handler: async (params: { interface?: string; target?: string; speed?: number }) => {
        const cfg: OpenOCDConfig = {
          openocdBin: process.env.OPENOCD_BIN || defaultConfig.openocdBin || 'openocd',
          scriptsDir: process.env.OPENOCD_SCRIPTS || defaultConfig.scriptsDir || 'C:/Program Files/OpenOCD/openocd/scripts',
          interfaceType: params.interface || process.env.OPENOCD_INTERFACE || defaultConfig.interfaceType || 'stlink',
          target: params.target || process.env.OPENOCD_TARGET || defaultConfig.target || 'stm32f1x',
          speed: params.speed,
        };

        await client.start(cfg);
        currentConfig = cfg;

        const targets = await client.sendCommand('targets');
        return { success: true, config: cfg, targets };
      },
    },
    {
      name: 'openocd_stop',
      description: '安全关闭 OpenOCD 连接。完成后可再次使用重新调用 openocd_start。',
      inputSchema: {},
      handler: async () => {
        await client.stop();
        currentConfig = null;
        return { success: true };
      },
    },
    {
      name: 'openocd_status',
      description: '查询 OpenOCD 当前连接状态和目标芯片信息。',
      inputSchema: {},
      handler: async () => {
        if (!client.isRunning) {
          return { connected: false, state: client.getState() };
        }
        const targets = await client.sendCommand('targets');
        return {
          connected: true,
          state: client.getState(),
          config: currentConfig,
          targets,
        };
      },
    },
  ];
}
