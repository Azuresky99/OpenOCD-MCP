// OpenOCD MCP Server — 共享 Tool 接口定义
// 版本: 1.0.0  作者: 碧云天书  日期: 2026-06-21
// 许可: MIT License
import { z } from 'zod';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (params: any) => Promise<Record<string, unknown>>;
}
