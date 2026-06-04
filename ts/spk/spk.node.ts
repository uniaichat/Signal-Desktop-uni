import { ipcMain, app } from "electron";
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import fetch, { Request } from "node-fetch";
import { join } from 'node:path';
import { createLogger } from "../logging/log.std";
import { TranslationCache } from "./spk.node.sql";
const log = createLogger('spkNode')
import FormData from 'form-data';


let openParams: any = {}
let allWindowMap = new Map();
export const getOpenParams = () => openParams
export const getAllWindowMap = () => allWindowMap

// let orgUserData = app.getPath('userData')
const _initSpkApp = () => {
    if (app && app.getPath) {

        // ----------- 解析 sgnl://openNewWindow?xxx ----------- 
        const maybeGetIncomingSignalRouteUni = (argv) => {
            const arg = argv.find(a => a.startsWith('spksgnl://'));
            if (!arg) return null;

            try {
                const url = new URL(arg);
                log.info('url----------------------->',url)
                const windowId = url.searchParams.get('windowId');
                const token = url.searchParams.get('token');
                const channel = url.searchParams.get('ch');
                log.info('channel----------------------->',channel)
                const windowName = url.searchParams.get('windowName');
                const type = url.searchParams.get('type');
                
                // const token = '6B7B898D918C3C7AEA2F993F555BBC8F';
                // const channel = 'happy';

                // const channel = 'speak';
                // const token = "12D192A34C7D1809478A99CAE232F723";
                // const windowName = '开发测试';
                // const type = 'add'
                
                
                return windowId ? { windowId, token, windowName,type,channel } : null;
            } catch {
                return null;
            }
        };

        // 解析启动参数
        openParams = maybeGetIncomingSignalRouteUni(process.argv);

        // 为每个 windowId 使用独立 userData
        if (openParams?.windowId) {
            const baseProfilesDir = join(app.getPath('appData'), app.getName(), 'profiles', openParams.windowId);
            if (!existsSync(baseProfilesDir)) mkdirSync(baseProfilesDir, { recursive: true });
            app.setPath('userData', baseProfilesDir);
        }
        
        if(openParams?.type === 'del'){            
            const delFile = join(app.getPath('userData'), 'del.flag');
            if(!existsSync(delFile)){
                writeFileSync(delFile, String(Date.now()));

            }
        }

        // ------------- second-instance：唤醒窗口 ----------------
        const gotLock = app.requestSingleInstanceLock();
        if (!gotLock) {
            app.quit();
            return;
        }

        // 主实例：捕获第二实例并置顶窗口
        app.on('second-instance', (event, argv) => {
            const params = maybeGetIncomingSignalRouteUni(argv);
            if (!params?.windowId) return;

            // 获取窗口（你项目里自己维护 windowId → BrowserWindow 的 Map）
            const existWin = allWindowMap?.get(params.windowId);
            

            if (existWin) {
                existWin.setTitle(params.windowName)
                if (existWin.isMinimized()) existWin.restore();
                existWin.show();
                existWin.focus();
                existWin.moveTop();
        }
        });

        // ---------------- lockFile（你原来的逻辑） ----------------
        const lockFile = join(app.getPath('userData'), 'instance.lock');
        let shouldExit = false;

        if (existsSync(lockFile)) {
            try {
                const timestamp = parseInt(readFileSync(lockFile, 'utf8'), 10);
                const age = Date.now() - timestamp;

                if (isNaN(timestamp) || age > 5 * 60 * 1000) {
                    unlinkSync(lockFile);
                } else {
                    // 这里不直接 exit！让 second-instance 去唤醒窗口
                    shouldExit = true;
                }
            } catch {
                try { unlinkSync(lockFile); } catch {}
            }
        }

        if (shouldExit) {
            // 第二实例触发 second-instance 后退出
            app.quit();
            return;
        }

        // 写入心跳
        writeFileSync(lockFile, String(Date.now()));
        setInterval(() => {
            try { writeFileSync(lockFile, String(Date.now())); } catch {}
        }, 60 * 1000);

        const cleanLock = () => { try { unlinkSync(lockFile); } catch {} };
        app.on('quit', cleanLock);
        process.on('exit', cleanLock);
        process.on('SIGINT', cleanLock);
        process.on('SIGTERM', cleanLock);
    }
};

let translateCacheDb: any = null
const _initTranslateCache = () => {
    const dbPath = join(app.getPath('userData'), 'translateCacheDb', 'translations.db');
  const dbKey = 'AxVsd1sF53sdBCd';
  
  translateCacheDb = TranslationCache.getInstance(dbPath, dbKey);
  translateCacheDb.cleanOlderThan(30)
};

_initSpkApp()
_initTranslateCache()
ipcMain.handle('spk-fetch', async (event, payload) => {
    let { url, headers, params, urlToken = true } = payload;
    const timestamp = Date.now()
    payload.headers = {
        'content-type': 'application/json',
        'access-auth-token': openParams.token,
        ...headers,
    }
    if (urlToken) {
        payload.params = { ...params, token: openParams.token }
    }
    if (payload.headers["content-type"]?.includes("json") && !url.includes('uploadWav')) {
        payload.body = JSON.stringify(payload.body)
    }
    if(url.includes('uploadWav')){
        const { fileName, type, buffer } = payload.body;
        const fileBuffer = Buffer.from(buffer); // ArrayBuffer -> Buffer

        const form = new FormData();

        // 这里用 Buffer，当作文件内容
        form.append('file', fileBuffer, {
            filename: fileName,
            contentType: type,
        });

        // 把 form-data 生成的 headers（包含 multipart/form-data; boundary=...）合并进去
        payload.body = form;
        payload.headers = {
            ...payload.headers,
            ...form.getHeaders(),
        };
    }
    if (Object.keys(payload.params || {}).length) {
        url += `${url.includes('?') ? '&' : '?'}${(new URLSearchParams(payload.params)).toString()}`;
    }
    log.info('spk-fetch-start', timestamp, url, payload)
    const request = new Request(url, payload);

    // 打印最终会带出去的请求头（包括自动生成的 Content-Type）
    log.info(
    'spk-fetch-request-headers',
    Array.from(request.headers.entries())
    );

    const res = await fetch(request);
    const result = await res.json();
    log.info('spk-fetch-response',res, timestamp, url, result, result?.data?.translation)
    return result;
})
ipcMain.handle('spk-get-config', async (event, payload) => {
    return getOpenParams();
})
ipcMain.handle('spk-get-translate-cache', async (event, payload) => {
    return translateCacheDb.get(payload.text, payload.to)
})
ipcMain.handle('spk-set-translate-cache', async (event, payload) => {
    return translateCacheDb.set(payload.text, payload.to, payload.translation)
})