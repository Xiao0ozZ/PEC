import path from 'node:path';

import {
  createProjectRoute,
  deleteProjectRoute,
  listProjectRoutes,
  restoreProjectRoute,
  restoreProjectSections,
  updateProjectRoute,
  updateProjectRouteOrder,
  updateProjectSections,
} from '../packages/project-core/src/route-management.js';

const ROUTES_PATH = '/__project-routes';
const BODY_LIMIT = 8 * 1024 * 1024;
const ROUTE_ACTIONS = Object.freeze({
  '/__project-routes/route/create': createProjectRoute,
  '/__project-routes/route/update': updateProjectRoute,
  '/__project-routes/section/update': updateProjectSections,
  '/__project-routes/route/order': updateProjectRouteOrder,
  '/__project-routes/route/delete': deleteProjectRoute,
  '/__project-routes/route/restore': restoreProjectRoute,
  '/__project-routes/section/restore': restoreProjectSections,
});

function sendJson(response, payload, statusCode = 200) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function isLocalRequest(request) {
  const address = String(request.socket?.remoteAddress || '').replace(/^::ffff:/u, '');
  return address === '' || address === '127.0.0.1' || address === '::1' || address === 'localhost';
}

function requestError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > BODY_LIMIT) {
    request.resume();
    throw requestError('请求内容过大。', 413, 'PAYLOAD_TOO_LARGE');
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    function fail(error) {
      if (settled) return;
      settled = true;
      request.resume();
      reject(error);
    }

    request.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        fail(requestError('请求内容过大。', 413, 'PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(requestError('请求内容不是有效的 JSON。', 400, 'BAD_REQUEST'));
      }
    });
    request.on('error', fail);
  });
}

export function projectRoutesPlugin({ projectRoot, loadMounts = async () => ({ projects: {} }) } = {}) {
  const root = path.resolve(projectRoot || process.cwd());

  return {
    name: 'project-routes',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url || '/', 'http://localhost');
        const routeAction = ROUTE_ACTIONS[requestUrl.pathname];
        const isListRequest = requestUrl.pathname === ROUTES_PATH;
        if (!isListRequest && !routeAction) {
          next();
          return;
        }

        if (isListRequest && request.method !== 'GET') {
          response.setHeader('Allow', 'GET');
          sendJson(response, { message: '路由读取接口只支持 GET。' }, 405);
          return;
        }
        if (routeAction && request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          sendJson(response, { message: '路由管理接口只支持 POST。' }, 405);
          return;
        }
        if (routeAction && !isLocalRequest(request)) {
          sendJson(response, { code: 'FORBIDDEN', message: '路由管理仅允许服务主机执行。' }, 403);
          return;
        }

        try {
          const mounts = await loadMounts();
          const result = isListRequest
            ? await listProjectRoutes({
                projectRoot: root,
                projectId: requestUrl.searchParams.get('projectId'),
                mounts,
              })
            : await routeAction({ projectRoot: root, target: await readJsonBody(request), mounts });
          if (routeAction && result?.requiresReload) server.ws.send({ type: 'full-reload' });
          sendJson(response, { ok: true, ...(!isListRequest ? { result } : result) });
        } catch (error) {
          sendJson(
            response,
            {
              ok: false,
              code: error.code || 'BAD_REQUEST',
              message: error.message,
              details: error.details || null,
              rollback: error.rollback || null,
            },
            error.statusCode || 400,
          );
        }
      });
    },
  };
}
