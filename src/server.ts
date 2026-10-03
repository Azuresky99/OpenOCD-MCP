// OpenOCD MCP Server — MCP 入口
// 版本: 1.0.0  作者: 碧云天书  日期: 2026-06-21
// 许可: MIT License
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OpenOCDClient } from './openocd-client.js';
import { createFlashTools } from './tools/flash.js';
import { createDebugTools } from './tools/debug.js';
import { createMonitorTools } from './tools/monitor.js';
import { createConfigTools } from './tools/config.js';
import { createRawTool } from './tools/raw.js';

async function main() {
  // 全局异常捕获，防止未处理的 Promise 拒绝导致进程崩溃
  process.on('unhandledRejection', (reason) => {
    console.error('未处理的 Promise 拒绝:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('未捕获的异常:', err);
  });

  const client = new OpenOCDClient();

  const server = new McpServer({
    name: 'openocd-mcp',
    version: '1.0.0',
  });

  // 按顺序注册所有工具：config → flash → debug → monitor → raw
  // config 在前确保 start/stop 先就绪
  const allTools = [
    ...createConfigTools(client, {}),
    ...createFlashTools(client),
    ...createDebugTools(client),
    ...createMonitorTools(client),
    ...createRawTool(client),
  ];

  for (const tool of allTools) {
    // 将工具 handler 适配为 MCP SDK 的回调格式
    // tool.handler 签名: (params: any) => Promise<Record<string, unknown>>
    // MCP callback 期望返回 { content: [...] } 格式
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema,
      async (args: unknown) => {
        try {
          const result = await tool.handler(args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: `错误: ${err.message || err}` }],
            isError: true,
          };
        }
      },
    );
  }

  // 使用 stdio 传输
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('OpenOCD MCP 服务器已启动');
  console.error(`OpenOCD 路径: ${process.env.OPENOCD_BIN || 'openocd'}`);
  console.error(`默认接口: ${process.env.OPENOCD_INTERFACE || 'stlink'}`);
  console.error(`默认目标: ${process.env.OPENOCD_TARGET || 'stm32f1x'}`);

  // 优雅关闭处理
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error('正在关闭...');
    if (client.isRunning) {
      await client.stop();
    }
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('服务器启动失败:', err);
  process.exit(1);
});
