// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import os from 'node:os';

import {
  app,
  dialog,
  ipcMain,
  nativeTheme,
  type BrowserWindow,
} from 'electron';
import { basename, dirname, extname, join } from 'node:path';

import { load as loadLocale } from '../../locale.node.ts';
import config from '../../config.main.ts';
import { getDNSFallback } from '../../dns-fallback.main.ts';
import type { ProfileManager } from './ProfileManager.node.ts';
import { createLogger } from '../../../ts/logging/log.std.ts';
import { HourCyclePreference } from '../../../ts/types/I18N.std.ts';
import type { RendererConfigType } from '../../../ts/types/RendererConfig.std.ts';
import { getEnvironment } from '../../../ts/environment.std.ts';
import OS from '../../../ts/util/os/osMain.node.ts';
import { packageJson } from '../../../ts/util/packageJson.main.ts';
import { cleanupOrphanedAttachments } from '../../attachment_channel.main.ts';
import { deleteStaleDownloads } from '../../attachments.node.ts';

const log = createLogger('ProfileRendererIpc');

// Signal 原 renderer 假设只有一个全局 BrowserWindow，因此 IPC 参数通常不带 profileId。
// 管理壳模式必须对每个 event 使用 manager.getRuntimeForSender(event.sender.id)，
// 绝不能在这里缓存“当前 Profile”，否则后台账号同时发 IPC 时会串库。
export async function installProfileRendererIpc({
  manager,
  proxyUrl,
  rootDir,
  shellWindow,
}: {
  manager: ProfileManager;
  proxyUrl?: string;
  rootDir: string;
  shellWindow: BrowserWindow;
}): Promise<void> {
  const preferredSystemLocales = app.getPreferredSystemLanguages();
  const locale = loadLocale({
    rootDir,
    hourCyclePreference: HourCyclePreference.UnknownPreference,
    isPackaged: app.isPackaged,
    localeDirectionTestingOverride: null,
    localeOverride: null,
    logger: log,
    preferredSystemLocales:
      preferredSystemLocales.length > 0 ? preferredSystemLocales : ['en'],
  });
  const dnsFallback = await getDNSFallback();

  ipcMain.on('get-config', event => {
    // get-config 是 Signal preload 的同步 IPC，必须通过 event.returnValue 同步返回。
    const runtime = manager.getRuntimeForSender(event.sender.id);
    if (!runtime) {
      return;
    }
    const required = (key: string): string => String(config.get(key));
    const rendererConfig: RendererConfigType = {
      appInstance: undefined,
      name: packageJson.productName,
      windowName: runtime.metadata.name,
      availableLocales: locale.availableLocales,
      resolvedTranslationsLocale: locale.name,
      resolvedTranslationsLocaleDirection: locale.direction,
      hourCyclePreference: locale.hourCyclePreference,
      preferredSystemLocales,
      localeOverride: null,
      version: app.getVersion(),
      buildCreation: Number(config.get('buildCreation')),
      buildExpiration: Number(config.get('buildExpiration')),
      challengeUrl: required('challengeUrl'),
      serverUrl: required('serverUrl'),
      storageUrl: required('storageUrl'),
      updatesUrl: required('updatesUrl'),
      resourcesUrl: required('resourcesUrl'),
      cdnUrl0: required('cdn.0'),
      cdnUrl2: required('cdn.2'),
      cdnUrl3: required('cdn.3'),
      certificateAuthority: required('certificateAuthority'),
      environment: getEnvironment(),
      isMockTestEnvironment: false,
      ciMode: false,
      ciForceUnprocessed: false,
      devTools: !app.isPackaged,
      dnsFallback,
      disableIPv6: false,
      disableScreenSecurity: false,
      nodeVersion: process.versions.node,
      hostname: os.hostname(),
      osRelease: os.release(),
      osVersion: os.version(),
      proxyUrl,
      contentProxyUrl: required('contentProxyUrl'),
      sfuUrl: required('sfuUrl'),
      reducedMotionSetting: false,
      registrationChallengeUrl: required('registrationChallengeUrl'),
      serverPublicParams: required('serverPublicParams'),
      serverTrustRoots: config.get<Array<string>>('serverTrustRoots'),
      genericServerPublicParams: required('genericServerPublicParams'),
      backupServerPublicParams: required('backupServerPublicParams'),
      stripePublishableKey: required('stripePublishableKey'),
      theme: 'system',
      appStartInitialSpellcheckSetting: false,
      crashDumpsPath: app.getPath('crashDumps'),
      homePath: app.getPath('home'),
      installPath: rootDir,
      userDataPath: runtime.profilePath,
      directoryConfig: {
        directoryUrl: required('directoryUrl'),
        directoryMRENCLAVE: required('directoryMRENCLAVE'),
      },
      isMainWindowFullScreen: false,
      isMainWindowMaximized: false,
      argv: undefined,
    };
    event.returnValue = rendererConfig;
  });

  ipcMain.on('locale-data', event => {
    event.returnValue = locale.messages;
  });
  ipcMain.on('locale-display-names', event => {
    event.returnValue = locale.localeDisplayNames;
  });
  ipcMain.on('country-display-names', event => {
    event.returnValue = locale.countryDisplayNames;
  });
  ipcMain.on('OS.getClassName', event => {
    event.returnValue = OS.getClassName();
  });
  ipcMain.on('get-user-data-path', event => {
    // 附件、日志等路径必须返回 Profile 目录，不能返回全局 Signal userData。
    event.returnValue = manager.getRuntimeForSender(
      event.sender.id
    )?.profilePath;
  });
  ipcMain.on('native-theme:init', event => {
    event.returnValue = {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    };
  });
  ipcMain.handle('getMainWindowStats', () => ({
    isMaximized: false,
    isFullScreen: false,
  }));
  ipcMain.handle('getMenuOptions', () => ({
    // 这是让 Signal 主界面启动所需的最小菜单环境；后续可按原 main.main.ts 扩展。
    development: !app.isPackaged,
    devTools: !app.isPackaged,
    includeSetup: false,
    isNightly: false,
    isProduction: app.isPackaged,
    platform: process.platform,
  }));
  ipcMain.handle('crash-reports:get-count', () => 0);
  ipcMain.handle('crash-reports:write-to-log', () => undefined);
  ipcMain.handle('crash-reports:erase', () => undefined);
  ipcMain.handle('show-save-dialog', async (event, { defaultPath }) => {
    // Only a registered Signal Profile renderer may open this dialog. The
    // management shell and unknown webContents cannot use it as a generic file
    // system bridge.
    if (!manager.getRuntimeForSender(event.sender.id)) {
      throw new Error(`No Profile runtime for sender ${event.sender.id}`);
    }
    if (typeof defaultPath !== 'string' || defaultPath.length === 0) {
      throw new TypeError('show-save-dialog requires a defaultPath');
    }

    const osDefaultPath = OS.isLinuxUsingKDE()
      ? `~/${defaultPath}`
      : defaultPath;
    const { canceled, filePath } = await dialog.showSaveDialog(shellWindow, {
      defaultPath: osDefaultPath,
      showsTagField: false,
    });
    if (canceled || filePath == null) {
      return { canceled: true };
    }

    // Electron may omit the original extension when the user edits the file
    // name on Windows. Preserve Signal's stock save-dialog behavior.
    if (extname(filePath) !== '') {
      return { canceled: false, filePath };
    }
    const defaultExt = extname(defaultPath);
    return {
      canceled: false,
      filePath: join(
        dirname(filePath),
        `${basename(filePath, defaultExt)}${defaultExt}`
      ),
    };
  });
  ipcMain.handle('settings:get:themeSetting', event => {
    // 界面偏好从各自 ephemeralConfig 读取，避免切换账号时主题/缩放串扰。
    return (
      manager
        .getRuntimeForSender(event.sender.id)
        ?.ephemeralConfig?.get('theme-setting') ?? 'system'
    );
  });
  ipcMain.handle('settings:set:themeSetting', (event, value) => {
    const runtime = manager.getRuntimeForSender(event.sender.id);
    if (!runtime?.ephemeralConfig) {
      throw new Error(`No config runtime for sender ${event.sender.id}`);
    }
    runtime.ephemeralConfig.set('theme-setting', value);
    event.sender.send('settings:update:themeSetting', value);
  });
  ipcMain.handle(
    'cleanup-orphaned-attachments',
    async (event, options: { _block?: boolean } = {}) => {
      const runtime = manager.getRuntimeForSender(event.sender.id);
      if (!runtime?.sql) {
        throw new Error(`No Profile SQL runtime for sender ${event.sender.id}`);
      }
      await cleanupOrphanedAttachments({
        sql: runtime.sql,
        userDataPath: runtime.profilePath,
        _block: options._block,
      });
    }
  );
  ipcMain.handle('cleanup-downloads', async event => {
    const runtime = manager.getRuntimeForSender(event.sender.id);
    if (!runtime) {
      throw new Error(`No Profile runtime for sender ${event.sender.id}`);
    }
    await deleteStaleDownloads(runtime.profilePath);
  });
  ipcMain.handle('getZoomFactor', event => {
    const runtime = manager.getRuntimeForSender(event.sender.id);
    const storedZoomFactor = runtime?.ephemeralConfig?.get('zoom-factor');

    return typeof storedZoomFactor === 'number' ? storedZoomFactor : 1;
  });
  ipcMain.on('setZoomFactor', (event, zoomFactor: unknown) => {
    const runtime = manager.getRuntimeForSender(event.sender.id);
    if (!runtime || typeof zoomFactor !== 'number') {
      return;
    }
    runtime.ephemeralConfig?.set('zoom-factor', zoomFactor);
    event.sender.setZoomFactor(zoomFactor);
  });
}
