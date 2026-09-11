import os from 'node:os';

export const LOOPBACK_HOST = '127.0.0.1';
export const ANY_HOST = '0.0.0.0';

export function isSharedHost(host) {
  return host === ANY_HOST || host === '::';
}

export function listLanAddresses({ networkInterfaces = os.networkInterfaces() } = {}) {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces || {})) {
    for (const item of entries || []) {
      if (item?.family !== 'IPv4' || item.internal || !item.address) continue;
      addresses.push(item.address);
    }
  }
  return [...new Set(addresses)].sort();
}

export function formatPlatformServerAddresses(host, port, { networkInterfaces } = {}) {
  if (isSharedHost(host)) {
    return {
      local: `http://${LOOPBACK_HOST}:${port}`,
      lan: listLanAddresses({ networkInterfaces }).map((address) => `http://${address}:${port}`),
    };
  }
  const displayHost = host === '::1' ? '[::1]' : host;
  return { local: `http://${displayHost}:${port}`, lan: [] };
}
