// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { ipcMain } from 'electron';
import FormData from 'form-data';
import fetch from 'node-fetch';

import type { ProfileManager } from './profile/ProfileManager.node.ts';
import type { SharedTranslationCache } from './SharedTranslationCache.main.ts';
import type { UnichatContext } from './UnichatContext.main.ts';
import { createProxyAgent } from '../../ts/util/createProxyAgent.node.ts';

type UniFetchPayload = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  body?: unknown;
};

type TranslationPayload = {
  text: string;
  to: string;
  from?: string;
  channel?: string;
  translation?: string;
};

export async function installUniIpc({
  context,
  manager,
  proxyUrl,
  translationCache,
  isShellSender,
}: {
  context: UnichatContext;
  manager: ProfileManager;
  proxyUrl?: string;
  translationCache: SharedTranslationCache;
  isShellSender(senderId: number): boolean;
}): Promise<void> {
  const proxyAgent = proxyUrl ? await createProxyAgent(proxyUrl) : undefined;
  ipcMain.handle('uni-get-config', event => {
    // 该配置只允许内嵌 Signal renderer 获取。管理壳有自己单独的 API，
    // 未登记到 ProfileManager 的 renderer 不能冒充某个 Signal Profile。
    const runtime = manager.getRuntimeForSender(event.sender.id);
    if (!runtime) {
      return undefined;
    }
    const snapshot = context.snapshot;
    // Token 只留在主进程，绝不通过 IPC 返回给 Signal renderer。
    return {
      windowId: runtime.metadata.id,
      windowName: runtime.metadata.name,
      type: 'add',
      brand: snapshot.brand,
      isAuthenticated: snapshot.isAuthenticated,
    };
  });

  ipcMain.handle('uni-fetch', async (event, payload: UniFetchPayload) => {
    // 管理壳需要查询 userInfo，Signal Profile 需要翻译接口，因此两类 renderer
    // 都允许调用；除此以外的 webContents 一律拒绝。
    if (
      !manager.getRuntimeForSender(event.sender.id) &&
      !isShellSender(event.sender.id)
    ) {
      throw new Error('Signal ProfileRuntime is not available');
    }
    const token = context.token;
    if (!token) {
      throw new Error('Unichat is not authenticated');
    }

    // URL 由 renderer 的 uni.web.utls.ts 组装，但 token 不能随任意 URL 发出。
    // 主进程再次限制协议和域名，防止 renderer 被注入后把凭据传到第三方服务器。
    const url = new URL(payload.url);
    if (url.protocol !== 'https:' || url.hostname !== 'api.uniaichat.com') {
      throw new Error('Untrusted Unichat API URL');
    }
    for (const [key, value] of Object.entries(payload.params ?? {})) {
      url.searchParams.set(key, value);
    }

    let body: FormData | string | undefined;
    // renderer 传来的 headers 中即使包含 token，也会被这里的主进程 token 覆盖。
    let headers: Record<string, string> = {
      'content-type': 'application/json',
      ...payload.headers,
      token,
    };
    if (url.pathname.includes('translationSpeechZzz')) {
      const audio = payload.body as {
        fileName: string;
        type: string;
        buffer: Uint8Array<ArrayBuffer>;
        languageCode: string;
        channel: string;
      };
      const fileBuffer = Buffer.from(
        audio.buffer.buffer,
        audio.buffer.byteOffset,
        audio.buffer.byteLength
      );
      if (fileBuffer.length === 0) {
        throw new Error('Cannot translate an empty audio attachment');
      }
      const form = new FormData();
      form.append('file', fileBuffer, {
        filename: audio.fileName,
        contentType: audio.type,
      });
      form.append('languageCode', audio.languageCode);
      form.append('channel', audio.channel);
      body = form;
      headers = { ...payload.headers, ...form.getHeaders(), token };
    } else if (payload.body != null) {
      body =
        typeof payload.body === 'string'
          ? payload.body
          : JSON.stringify(payload.body);
    }

    const response = await fetch(url, {
      method: payload.method ?? (body == null ? 'GET' : 'POST'),
      headers,
      body,
      agent: proxyAgent,
    });
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  });

  ipcMain.handle(
    'uni-get-translate-cache',
    (event, payload: TranslationPayload) => {
      if (!manager.getRuntimeForSender(event.sender.id)) {
        return null;
      }
      return translationCache.get({
        owner: context.cacheOwner,
        text: payload.text,
        to: payload.to,
        from: payload.from,
        channel: payload.channel,
      });
    }
  );

  ipcMain.handle(
    'uni-set-translate-cache',
    (event, payload: TranslationPayload) => {
      if (
        !manager.getRuntimeForSender(event.sender.id) ||
        payload.translation == null
      ) {
        return false;
      }
      translationCache.set(
        {
          owner: context.cacheOwner,
          text: payload.text,
          to: payload.to,
          from: payload.from,
          channel: payload.channel,
        },
        payload.translation
      );
      return true;
    }
  );
}
