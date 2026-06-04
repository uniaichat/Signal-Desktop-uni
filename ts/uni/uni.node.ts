import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { app, ipcMain } from 'electron';
import fetch from 'node-fetch';

import { createLogger } from '../logging/log.std';
import { TranslationCache } from './uni.node.sql';

const log = createLogger('uniNode');

type OpenParams = {
  windowId: string;
  token: string | null;
  windowName: string | null;
  type: string | null;
  channel: string | null;
};

let openParams: OpenParams | undefined;
let allWindowMap = new Map();

export const getOpenParams = () => openParams;
export const getAllWindowMap = () => allWindowMap;

// `unisgnl://...` 是我们自定义的多开启动协议。
// 这里单独解析，不走 Signal 内置路由，是因为它携带了 `windowId`
// 这类必须在应用启动前就拿到的 profile 选择信息。
const parseUniRoute = (input: string): OpenParams | null => {
  if (!input.startsWith('unisgnl://')) {
    return null;
  }

  try {
    const url = new URL(input);
    const windowId = url.searchParams.get('windowId');

    if (!windowId) {
      return null;
    }

    return {
      windowId,
      token: url.searchParams.get('token'),
      windowName: url.searchParams.get('windowName'),
      type: url.searchParams.get('type'),
      channel: url.searchParams.get('ch'),
    };
    // return {        
    //     windowId : '11102',
    //     channel : 'uni',
    //     token : 'eyJhbGciOiJIUzUxMiJ9.eyJsb2dpbl91c2VyX2tleSI6IjJmNzcyMWZiLTBjZWEtNDVlYS05YzVlLWZlMzE5MTk0NmViMyJ9.YodCkxzmRqxZ9qy76InhK6RHi5Ko4DYBd7zYIoTi4qOJFF_ibpQ7mRkT1TibIaheLdAiiDdE1xCBFxAi1kmlwg',
    //     windowName : '开发测试',
    //     type : 'add',
    // }
  } catch (error) {
    log.warn('Failed to parse unisgnl route', input, error);
    return null;
  }
};

const maybeGetIncomingSignalRouteUni = (argv: Array<string>) => {
  for (const arg of argv) {
    const params = parseUniRoute(arg);
    if (params) {
      return params;
    }
  }

  return null;
};

// 每个 `windowId` 都对应独立的 Electron `userData` 目录，
// 这样不同实例才能真正隔离数据库和本地状态。
const ensureProfileUserData = (params?: OpenParams) => {
  if (!params?.windowId) {
    return;
  }

  const baseProfilesDir = join(
    app.getPath('appData'),
    app.getName(),
    'profiles',
    params.windowId
  );
  if (!existsSync(baseProfilesDir)) {
    mkdirSync(baseProfilesDir, { recursive: true });
  }
  app.setPath('userData', baseProfilesDir);
};

// 如果目标 profile 已经在运行，就直接激活已有窗口，
// 避免同一个 `windowId` 被重复拉起。
const focusWindowByParams = (params: OpenParams) => {
  const existWin = allWindowMap?.get(params.windowId);
  if (!existWin) {
    return false;
  }

  existWin.setTitle(params.windowName ?? existWin.getTitle());
  if (existWin.isMinimized()) {
    existWin.restore();
  }
  existWin.show();
  existWin.focus();
  existWin.moveTop();
  return true;
};

const getMacAppBundlePath = () => {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return null;
  }

  // /Applications/App.app/Contents/MacOS/App -> /Applications/App.app
  return dirname(dirname(dirname(process.execPath)));
};

// 在 macOS 打包应用里，自定义协议通常会通过 `open-url`
// 发送给已运行实例，而不是像 Windows 一样直接带 argv 启动新进程。
// 因此这里用 `open -n` 重新拉起 `.app`，并把原始协议参数继续透传下去。
const launchMacInstanceWithRoute = (incomingHref: string) => {
  const appBundlePath = getMacAppBundlePath();
  if (!appBundlePath) {
    log.warn('Unable to relaunch another macOS instance for route', incomingHref);
    return false;
  }

  const child = spawn(
    'open',
    ['-n', appBundlePath, '--args', incomingHref],
    {
      detached: true,
      stdio: 'ignore',
    }
  );
  child.unref();
  return true;
};

const markDeleteFlagIfNeeded = (params?: OpenParams) => {
  if (params?.type !== 'del') {
    return;
  }

  const delFile = join(app.getPath('userData'), 'del.flag');
  if (!existsSync(delFile)) {
    writeFileSync(delFile, String(Date.now()));
  }
};

const _initUniApp = () => {
  if (!(app && app.getPath)) {
    return;
  }

  app.on('open-url', (event, incomingHref) => {
    event.preventDefault();

    const params = parseUniRoute(incomingHref);
    if (!params) {
      return;
    }

    log.info('Received macOS open-url', incomingHref, params);

    // macOS 打包场景下，冷启动时协议参数可能从这里进来，而不是 argv。
    // 所以要尽早拿到 profile 信息，确保后续能切到正确的 userData。
    if (!app.isReady() && !openParams?.windowId) {
      openParams = params;
      ensureProfileUserData(params);
      markDeleteFlagIfNeeded(params);
      return;
    }

    if (focusWindowByParams(params)) {
      return;
    }

    // 如果当前实例本身就是目标 profile，就不需要额外处理。
    // 否则在 macOS 下需要显式再拉起一个新实例。
    if (openParams?.windowId === params.windowId) {
      return;
    }

    if (process.platform === 'darwin') {
      launchMacInstanceWithRoute(incomingHref);
    }
  });

  openParams = maybeGetIncomingSignalRouteUni(process.argv) ?? openParams;
  ensureProfileUserData(openParams);
  markDeleteFlagIfNeeded(openParams);

  // 不带自定义协议参数时，保持原来的启动逻辑，不参与 profile 多开控制。
  if (!openParams?.windowId) {
    return;
  }

  // 这里的单实例锁是“按 profile 生效”的，因为上面可能已经切换过 userData。
  // 这样既能保证同一个 `windowId` 只有一个实例，又允许不同 `windowId`
  // 并行运行。
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on('second-instance', (_event, argv) => {
    const params = maybeGetIncomingSignalRouteUni(argv);
    if (!params) {
      return;
    }

    focusWindowByParams(params);
  });

  // 这里额外加了一层心跳锁文件，也放在当前 profile 目录里，
  // 作为自定义多开流程的补充保护，避免同一 profile 被意外重复启动。
  const lockFile = join(app.getPath('userData'), 'instance.lock');
  let shouldExit = false;

  if (existsSync(lockFile)) {
    try {
      const timestamp = parseInt(readFileSync(lockFile, 'utf8'), 10);
      const age = Date.now() - timestamp;

      if (isNaN(timestamp) || age > 5 * 60 * 1000) {
        unlinkSync(lockFile);
      } else {
        shouldExit = true;
      }
    } catch {
      try {
        unlinkSync(lockFile);
      } catch {}
    }
  }

  if (shouldExit) {
    app.quit();
    return;
  }

  writeFileSync(lockFile, String(Date.now()));
  setInterval(() => {
    try {
      writeFileSync(lockFile, String(Date.now()));
    } catch {}
  }, 60 * 1000);

  const cleanLock = () => {
    try {
      unlinkSync(lockFile);
    } catch {}
  };
  app.on('quit', cleanLock);
  process.on('exit', cleanLock);
  process.on('SIGINT', cleanLock);
  process.on('SIGTERM', cleanLock);
};

let translateCacheDb: any = null
const _initTranslateCache = () => {
    const dbPath = join(app.getPath('userData'), 'translateCacheDb', 'translations.db');
  const dbKey = 'AxVsd1sF53sdBCd';
  
  translateCacheDb = TranslationCache.getInstance(dbPath, dbKey);
  translateCacheDb.cleanOlderThan(30)
};

_initUniApp();
_initTranslateCache();
ipcMain.handle('uni-fetch', async (_event, payload) => {
    let { url, headers } = payload;
    const timestamp = Date.now()
    payload.headers = {
        'content-type': 'application/json',
        'token': openParams?.token ?? '',
        ...headers,
    }
    if (payload.headers["content-type"]?.includes("json")) {
        payload.body = JSON.stringify(payload.body)
    }
    if (Object.keys(payload.params || {}).length) {
        url += `${url.includes('?') ? '&' : '?'}${(new URLSearchParams(payload.params)).toString()}`;
    }
    log.info('uni-fetch-start', timestamp, url, payload)
    const res = await fetch(url, payload);
    const result = await res.json()
    log.info('uni-fetch-response', timestamp, url, result)
    return result;
})
ipcMain.handle('uni-get-config', async (_event, _payload) => {
    return getOpenParams();
})
ipcMain.handle('uni-get-translate-cache', async (_event, payload) => {
    return translateCacheDb.get(payload.text, payload.to)
})
ipcMain.handle('uni-set-translate-cache', async (_event, payload) => {
    return translateCacheDb.set(payload.text, payload.to, payload.translation)
})
