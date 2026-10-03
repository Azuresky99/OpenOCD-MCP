import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenOCDClient, OpenOCDConfig } from '../openocd-client.js';

describe('OpenOCDClient', () => {
  let client: OpenOCDClient;

  beforeEach(() => {
    client = new OpenOCDClient();
  });

  afterEach(async () => {
    if (client.isRunning) {
      await client.stop();
    }
  });

  it('初始状态为 idle', () => {
    expect(client.getState()).toBe('idle');
    expect(client.isRunning).toBe(false);
  });

  it('sendCommand 在未启动时抛出错误', async () => {
    await expect(client.sendCommand('test')).rejects.toThrow('未运行');
  });

  it('stop 在未启动时不报错', async () => {
    await expect(client.stop()).resolves.not.toThrow();
  });
});
