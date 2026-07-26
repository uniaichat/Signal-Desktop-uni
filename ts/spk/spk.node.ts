import { spawn } from 'node:child_process';
import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { ipcMain, app } from 'electron';
import fetch, { Request } from 'node-fetch';
import FormData from 'form-data';

import { createLogger } from '../logging/log.std';
import { TranslationCache } from './spk.node.sql';

const log = createLogger('spkNode');

type OpenParams = {
  windowId: string;
  token: string | null;
  windowName: string | null;
  type: string | null;
  channel: string | null;
  targeturl: string | null;
};

let openParams: OpenParams | undefined;
let allWindowMap = new Map();

export const getOpenParams = () => openParams;
export const getAllWindowMap = () => allWindowMap;

let onOpenSignalRoute:
  | undefined
  | ((params: {
      windowId: string;
      windowName?: string | null;
      type?: string | null;
      targeturl?: string | null;
    }) => void);

export const setOpenSignalRouteHandler = (
  handler: (params: {
    windowId: string;
    windowName?: string | null;
    type?: string | null;
    targeturl?: string | null;
  }) => void
) => {
  onOpenSignalRoute = handler;
};

const parseSpkRoute = (input: string): OpenParams | null => {
  if (!input.startsWith('spksgnl://')) {
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
      channel: url.searchParams.get('ch'),
      windowName: url.searchParams.get('windowName'),
      type: url.searchParams.get('type'),
      targeturl: url.searchParams.get('targeturl'),
    };
    // return {
    //   windowId : '2000',
    //   token: '12D192A34C7D1809478A99CAE232F723',
    //   channel: 'speak',
    //   windowName: '测试开发',
    //   type: 'add',
    //   targeturl:''
    // };
  } catch (error) {
    log.warn('Failed to parse spksgnl route', input, error);
    return null;
  }
};

const maybeGetIncomingSignalRouteSpk = (argv: Array<string>) => {
  for (const arg of argv) {
    const params = parseSpkRoute(arg);
    if (params) {
      return params;
    }
  }

  return null;
};

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

const focusWindowByParams = (params: OpenParams) => {
  const existWin = allWindowMap?.get(params.windowId);
  if (!existWin) {
    return false;
  }

  if (params.windowName) {
    existWin.setTitle(params.windowName);
  }

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

  return dirname(dirname(dirname(process.execPath)));
};

const launchMacInstanceWithRoute = (incomingHref: string) => {
  const appBundlePath = getMacAppBundlePath();
  if (!appBundlePath) {
    log.warn(
      'Unable to relaunch another macOS instance for route',
      incomingHref
    );
    return false;
  }

  const child = spawn('open', ['-n', appBundlePath, '--args', incomingHref], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
  return true;
};

const writeDeleteFlagIfNeeded = (params?: OpenParams) => {
  if (params?.type !== 'del') {
    return;
  }

  const delFile = join(app.getPath('userData'), 'del.flag');
  if (!existsSync(delFile)) {
    writeFileSync(delFile, String(Date.now()));
  }
};

const _initSpkApp = () => {
  if (!(app && app.getPath)) {
    return;
  }

  app.on('open-url', (event, incomingHref) => {
    event.preventDefault();

    const params = parseSpkRoute(incomingHref);
    if (!params) {
      return;
    }

    log.info('Received macOS open-url', incomingHref, params);

    if (!app.isReady() && !openParams?.windowId) {
      openParams = params;
      ensureProfileUserData(params);
      writeDeleteFlagIfNeeded(params);
      return;
    }

    if (params.type === 'opensignal' && params.targeturl) {
      onOpenSignalRoute?.(params);
    }

    if (focusWindowByParams(params)) {
      return;
    }

    if (openParams?.windowId === params.windowId) {
      return;
    }

    if (process.platform === 'darwin') {
      launchMacInstanceWithRoute(incomingHref);
    }
  });

  openParams = maybeGetIncomingSignalRouteSpk(process.argv) ?? openParams;
  ensureProfileUserData(openParams);
  writeDeleteFlagIfNeeded(openParams);

  if (!openParams?.windowId) {
    return;
  }

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on('second-instance', (_event, argv) => {
    const params = maybeGetIncomingSignalRouteSpk(argv);
    if (!params?.windowId) {
      return;
    }

    log.info('second-instance', params);

    if (params.type === 'opensignal' && params.targeturl) {
      onOpenSignalRoute?.(params);
    }

    focusWindowByParams(params);
  });

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

let translateCacheDb: any = null;

const _initTranslateCache = () => {
  const dbPath = join(
    app.getPath('userData'),
    'translateCacheDb',
    'translations.db'
  );
  const dbKey = 'AxVsd1sF53sdBCd';

  translateCacheDb = TranslationCache.getInstance(dbPath, dbKey);
  translateCacheDb.cleanOlderThan(30);
};

_initSpkApp();
_initTranslateCache();

ipcMain.handle('spk-fetch', async (_event, payload) => {
  let { url, headers, params, urlToken = true } = payload;
  const timestamp = Date.now();

  payload.headers = {
    'content-type': 'application/json',
    'access-auth-token': openParams?.token,
    ...headers,
  };

  if (urlToken) {
    payload.params = { ...params, token: openParams?.token };
  }

  if (
    payload.headers['content-type']?.includes('json') &&
    !url.includes('uploadWav')
  ) {
    payload.body = JSON.stringify(payload.body);
  }

  if (url.includes('uploadWav')) {
    const { fileName, type, buffer } = payload.body;
    const fileBuffer = ArrayBuffer.isView(buffer)
      ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : Buffer.from(buffer);

    if (fileBuffer.length === 0) {
      throw new Error('Cannot translate an empty audio attachment');
    }

    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: fileName,
      contentType: type,
    });

    payload.body = form;
    payload.headers = {
      ...payload.headers,
      ...form.getHeaders(),
    };
  }

  if (Object.keys(payload.params || {}).length) {
    url += `${url.includes('?') ? '&' : '?'}${new URLSearchParams(
      payload.params
    ).toString()}`;
  }

  log.info('spk-fetch-start', timestamp, url, payload);

  const request = new Request(url, payload);

  log.info('spk-fetch-request-headers', Array.from(request.headers.entries()));

  const res = await fetch(request);
  const result = await res.json();

  log.info(
    'spk-fetch-response',
    res,
    timestamp,
    url,
    result,
    result?.data?.translation
  );

  return result;
});

ipcMain.handle('spk-get-config', async () => {
  return getOpenParams();
});

ipcMain.handle('spk-get-translate-cache', async (_event, payload) => {
  return translateCacheDb.get(payload.text, payload.to);
});

ipcMain.handle('spk-set-translate-cache', async (_event, payload) => {
  return translateCacheDb.set(payload.text, payload.to, payload.translation);
});
