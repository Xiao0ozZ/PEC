// @vitest-environment node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import { createPlatformServer } from '../../packages/platform-server/src/index.js';
import { listLanAddresses } from '../../packages/platform-server/src/addresses.js';

const services = [];
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function startService(overrides = {}) {
  const projectsRoot = path.resolve(process.cwd(), 'examples');
  const service = createPlatformServer({ projectsRoot, port: 0, ...overrides });
  services.push(service);
  const address = await service.start();
  return { service, baseUrl: `http://127.0.0.1:${address.port}`, port: address.port };
}

describe('SHARE-01 局域网只读分享', () => {
  it('默认不分享，只监听本机地址', async () => {
    const { baseUrl } = await startService({ writeEnabled: true });

    const response = await fetch(`${baseUrl}/__platform/share`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.share).toMatchObject({
      sharing: false,
      managedByStartup: false,
      host: '127.0.0.1',
      canControl: true,
    });
    expect(payload.share.urls.lan).toEqual([]);
  });

  it('健康接口同时报告分享状态', async () => {
    const { baseUrl } = await startService({ writeEnabled: true });
    const payload = await fetch(`${baseUrl}/__platform/health`).then((response) => response.json());
    expect(payload).toMatchObject({ ok: true, writeEnabled: true });
    expect(payload.share).toMatchObject({ sharing: false });
  });

  it('开启后监听局域网地址并返回可访问 URL，关闭后不再监听', async () => {
    const lan = listLanAddresses();
    if (!lan.length) {
      expect(lan).toEqual([]);
      return;
    }
    const { service, baseUrl, port } = await startService({ writeEnabled: true });

    const enabled = await fetch(`${baseUrl}/__platform/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enabled.status).toBe(200);
    const enabledPayload = await enabled.json();
    expect(enabledPayload.share.sharing).toBe(true);
    expect(enabledPayload.share.urls.lan).toEqual(lan.map((address) => `http://${address}:${port}`));

    // 同网设备可读：直接连局域网地址取项目清单。
    const remoteRead = await fetch(`http://${lan[0]}:${port}/__projects/manifest`);
    expect(remoteRead.status).toBe(200);
    expect((await remoteRead.json()).projects[0]).toMatchObject({ id: 'sample-project' });

    const disabled = await fetch(`${baseUrl}/__platform/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disabled.status).toBe(200);
    expect((await disabled.json()).share.sharing).toBe(false);

    // 关闭后局域网地址不再监听。
    await expect(fetch(`http://${lan[0]}:${port}/__projects/manifest`)).rejects.toThrow();
    expect(service.shareStatus().urls.lan).toEqual([]);
  });

  it('局域网客户端不能控制分享，也不能写入', async () => {
    const { baseUrl } = await startService({
      writeEnabled: true,
      getClientAddress: () => '192.168.1.20',
    });

    const status = await fetch(`${baseUrl}/__platform/share`).then((response) => response.json());
    expect(status.share).toMatchObject({ canControl: false, readOnly: true, writeEnabled: false });

    const toggle = await fetch(`${baseUrl}/__platform/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(toggle.status).toBe(403);
  });

  it('只读模式拒绝切换分享', async () => {
    const { baseUrl } = await startService({ writeEnabled: false });
    const toggle = await fetch(`${baseUrl}/__platform/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(toggle.status).toBe(403);
  });

  it('拒绝非布尔的 enabled 与不支持的方法', async () => {
    const { baseUrl } = await startService({ writeEnabled: true });

    const invalid = await fetch(`${baseUrl}/__platform/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe('INVALID_SHARE_STATE');

    const wrongMethod = await fetch(`${baseUrl}/__platform/share`, { method: 'DELETE' });
    expect(wrongMethod.status).toBe(405);
  });

  it('拒绝超过体积上限的请求体', async () => {
    const { baseUrl } = await startService({ writeEnabled: true });
    const oversized = await fetch(`${baseUrl}/__platform/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, padding: 'x'.repeat(8 * 1024) }),
    });
    expect(oversized.status).toBe(413);
    expect((await oversized.json()).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('以 0.0.0.0 启动时分享由启动参数决定，界面开关被拒绝', async () => {
    const projectsRoot = path.resolve(process.cwd(), 'examples');
    const service = createPlatformServer({
      projectsRoot,
      port: 0,
      host: '0.0.0.0',
      writeEnabled: true,
    });
    services.push(service);
    const address = await service.start();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const status = await fetch(`${baseUrl}/__platform/share`).then((response) => response.json());
    expect(status.share).toMatchObject({ sharing: true, managedByStartup: true, canControl: false });

    const toggle = await fetch(`${baseUrl}/__platform/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(toggle.status).toBe(409);
    expect((await toggle.json()).code).toBe('SHARE_MANAGED_BY_STARTUP');
  });

  it('关闭服务时同时释放分享监听', async () => {
    const lan = listLanAddresses();
    if (!lan.length) {
      expect(lan).toEqual([]);
      return;
    }
    const { service, baseUrl, port } = await startService({ writeEnabled: true });
    await fetch(`${baseUrl}/__platform/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(service.shareStatus().sharing).toBe(true);

    await service.close();
    services.splice(services.indexOf(service), 1);

    await expect(fetch(`http://${lan[0]}:${port}/__platform/health`)).rejects.toThrow();
  });
});

describe('局域网地址枚举', () => {
  it('忽略内部地址与 IPv6，并去重排序', () => {
    const addresses = listLanAddresses({
      networkInterfaces: {
        lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
        eth1: [{ family: 'IPv4', internal: false, address: '192.168.1.30' }],
        eth0: [
          { family: 'IPv4', internal: false, address: '192.168.1.10' },
          { family: 'IPv6', internal: false, address: 'fe80::1' },
          { family: 'IPv4', internal: false, address: '192.168.1.10' },
        ],
      },
    });
    expect(addresses).toEqual(['192.168.1.10', '192.168.1.30']);
  });

  it('没有网卡信息时返回空数组', () => {
    expect(listLanAddresses({ networkInterfaces: {} })).toEqual([]);
  });
});
