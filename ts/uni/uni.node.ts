import { ipcMain, app } from "electron";
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import fetch from "node-fetch";
import { join } from 'node:path';
import fs from 'fs';
import { createLogger } from "../logging/log.std";
import { TranslationCache } from "./uni.node.sql";
import SQL from '@signalapp/sqlcipher';
const log = createLogger('uniNode')

let openParams: any = {}
let allWindowMap = new Map();
export const getOpenParams = () => openParams
export const getAllWindowMap = () => allWindowMap
// let orgUserData = app.getPath('userData')
const _initUniApp = () => {
                log.info('app----------------------->',app.getPath)
    if (app && app.getPath) {

        // ----------- 解析 sgnl://openNewWindow?xxx ----------- 
        const maybeGetIncomingSignalRouteUni = (argv) => {
            const arg = argv.find(a => a.startsWith('unisgnl://'));
            if (!arg) return null;

            try {
                const url = new URL(arg);
                log.info('url----------------------->',url)
                // const windowId = url.searchParams.get('windowId');
                // const token = url.searchParams.get('token');
                // const channel = url.searchParams.get('ch');
                // log.info('channel----------------------->',channel)
                // const windowName = url.searchParams.get('windowName'); 
                // const type = url.searchParams.get('type');  
                
                // const token = '6B7B898D918C3C7AEA2F993F555BBC8F';
                // const channel = 'happy';
                
                const windowId = '11102';
                const channel = 'uni';
                const token = 'eyJhbGciOiJIUzUxMiJ9.eyJsb2dpbl91c2VyX2tleSI6IjJmNzcyMWZiLTBjZWEtNDVlYS05YzVlLWZlMzE5MTk0NmViMyJ9.YodCkxzmRqxZ9qy76InhK6RHi5Ko4DYBd7zYIoTi4qOJFF_ibpQ7mRkT1TibIaheLdAiiDdE1xCBFxAi1kmlwg';
                const windowName = '开发测试';
                const type = 'add'
                
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

_initUniApp()
_initTranslateCache()
ipcMain.handle('uni-fetch', async (event, payload) => {
    let { url, headers } = payload;
    const timestamp = Date.now()
    payload.headers = {
        'content-type': 'application/json',
        'token': openParams.token,
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
ipcMain.handle('uni-get-config', async (event, payload) => {
    return getOpenParams();
})
ipcMain.handle('uni-get-translate-cache', async (event, payload) => {
    return translateCacheDb.get(payload.text, payload.to)
})
ipcMain.handle('uni-set-translate-cache', async (event, payload) => {
    return translateCacheDb.set(payload.text, payload.to, payload.translation)
})