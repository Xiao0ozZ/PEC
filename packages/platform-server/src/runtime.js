import { error as defaultError, log as defaultLog } from 'node:console';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { loadProjectMounts } from '../../project-core/src/index.js';
import { formatPlatformServerAddresses } from './addresses.js';
import { createPlatformServer } from './index.js';

export { formatPlatformServerAddresses };

const OPTION_NAMES = new Set([
  '--host',
  '--mounts',
  '--platform-root',
  '--port',
  '--projects-root',
  '--settings',
  '--static-root',
]);

export const PLATFORM_SERVER_USAGE = `用法：npm run serve:local -- [选项]

选项：
  --host <地址>            监听地址，默认 127.0.0.1；局域网分享使用 0.0.0.0
  --port <端口>            监听端口，默认 5188
  --projects-root <目录>   项目包目录，默认 ./projects
  --static-root <目录>     React 构建目录，默认 ./dist
  --mounts <文件>          本地挂载配置，默认 ./project-mounts.local.json
  --settings <文件>        平台设置文件，默认 ./platform-settings.json
  --read-only              整个服务只读
  --help                   显示帮助
`;

function runtimeError(message, code, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function optionValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw runtimeError(`选项 ${name} 缺少参数。`, 'INVALID_OPTION');
  return value;
}

export function parsePlatformServerOptions(argv = [], env = {}, repositoryRoot = process.cwd()) {
  const values = {};
  let readOnly = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--read-only') {
      readOnly = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (!OPTION_NAMES.has(argument)) throw runtimeError(`不支持的启动选项：${argument}`, 'INVALID_OPTION');
    values[argument] = optionValue(argv, index, argument);
    index += 1;
  }

  const portText = values['--port'] || env.PORT || '5188';
  const port = Number(portText);
  const host = String(values['--host'] || env.HOST || '127.0.0.1').trim();
  return {
    help,
    host,
    port,
    projectsRoot: path.resolve(repositoryRoot, values['--projects-root'] || 'projects'),
    platformRoot: path.resolve(repositoryRoot, values['--platform-root'] || '.'),
    mountsPath: path.resolve(repositoryRoot, values['--mounts'] || 'project-mounts.local.json'),
    settingsPath: path.resolve(repositoryRoot, values['--settings'] || 'platform-settings.json'),
    staticRoot: path.resolve(repositoryRoot, values['--static-root'] || 'dist'),
    writeEnabled: !readOnly,
  };
}

async function pathType(filePath, fsApi) {
  return fsApi
    .stat(filePath)
    .then((stats) => (stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other'))
    .catch((error) => (error.code === 'ENOENT' ? 'missing' : Promise.reject(error)));
}

export async function validatePlatformServerRuntime(
  options,
  { fsApi = fs, loadMounts = loadProjectMounts } = {},
) {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw runtimeError('端口必须是 1 到 65535 之间的整数。', 'INVALID_PORT');
  }
  if (!options.host || /\s/u.test(options.host)) {
    throw runtimeError('监听地址不能为空或包含空格。', 'INVALID_HOST');
  }
  if ((await pathType(options.platformRoot, fsApi)) !== 'directory') {
    throw runtimeError(`平台根目录不存在：${options.platformRoot}`, 'PLATFORM_ROOT_MISSING');
  }

  const projectsType = await pathType(options.projectsRoot, fsApi);
  if (projectsType === 'missing') {
    await fsApi.mkdir(options.projectsRoot, { recursive: true });
  } else if (projectsType !== 'directory') {
    throw runtimeError(`项目目录不是文件夹：${options.projectsRoot}`, 'PROJECTS_ROOT_INVALID');
  }

  if ((await pathType(options.staticRoot, fsApi)) !== 'directory') {
    throw runtimeError(
      `React 构建目录不存在：${options.staticRoot}。请先执行 npm run build。`,
      'STATIC_ROOT_MISSING',
    );
  }
  if ((await pathType(path.join(options.staticRoot, 'index.html'), fsApi)) !== 'file') {
    throw runtimeError(
      `React 构建入口不存在：${path.join(options.staticRoot, 'index.html')}。请先执行 npm run build。`,
      'STATIC_ENTRY_MISSING',
    );
  }

  if ((await pathType(options.mountsPath, fsApi)) === 'file') {
    try {
      await loadMounts(options.mountsPath);
    } catch (error) {
      throw runtimeError(`本地挂载配置无效：${error.message}`, 'MOUNTS_INVALID', error);
    }
  }
  return options;
}

export async function startPlatformServerRuntime(
  options,
  {
    createServer = createPlatformServer,
    fsApi = fs,
    loadMounts = loadProjectMounts,
    log = defaultLog,
    networkInterfaces = os.networkInterfaces,
  } = {},
) {
  await validatePlatformServerRuntime(options, { fsApi, loadMounts });
  const server = createServer(options);
  let address;
  try {
    address = await server.start();
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      throw runtimeError(
        `端口 ${options.port} 已被占用。请关闭占用进程，或使用 --port <其他端口>。`,
        'PORT_IN_USE',
        error,
      );
    }
    if (error.code === 'EACCES') {
      throw runtimeError(
        `无权监听 ${options.host}:${options.port}。请更换端口或检查系统权限。`,
        'LISTEN_FORBIDDEN',
        error,
      );
    }
    throw error;
  }

  const actualPort = typeof address === 'object' && address ? address.port : options.port;
  const addresses = formatPlatformServerAddresses(options.host, actualPort, {
    networkInterfaces: networkInterfaces(),
  });
  log(`平台本地服务已启动：${addresses.local}`);
  for (const url of addresses.lan) log(`局域网只读地址：${url}`);
  log(
    options.writeEnabled
      ? '当前模式：服务主机可写，局域网设备只读；项目文件仍是事实来源。'
      : '当前模式：全部客户端只读；项目文件仍是事实来源。',
  );

  let shutdownPromise = null;
  return {
    server,
    address,
    addresses,
    shutdown(signal = 'manual') {
      shutdownPromise ||= (async () => {
        log(`收到 ${signal}，正在停止平台本地服务。`);
        await server.close();
        log('平台本地服务已停止。');
      })();
      return shutdownPromise;
    },
  };
}

export function installPlatformServerSignalHandlers(
  runtime,
  { processRef = process, reportError = defaultError } = {},
) {
  let shutdownPromise = null;
  const shutdown = (signal) => {
    shutdownPromise ||= runtime
      .shutdown(signal)
      .then(() => {
        processRef.exitCode = 0;
      })
      .catch((error) => {
        reportError(`平台本地服务停止失败：${error.message}`);
        processRef.exitCode = 1;
      });
    return shutdownPromise;
  };
  const onSigint = () => void shutdown('SIGINT');
  const onSigterm = () => void shutdown('SIGTERM');
  processRef.once('SIGINT', onSigint);
  processRef.once('SIGTERM', onSigterm);
  return {
    shutdown,
    dispose() {
      processRef.removeListener('SIGINT', onSigint);
      processRef.removeListener('SIGTERM', onSigterm);
    },
  };
}
