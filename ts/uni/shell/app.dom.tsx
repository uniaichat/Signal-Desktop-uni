// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  DragEvent,
  KeyboardEvent,
  PointerEvent,
  ReactElement,
} from 'react';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { ProfileSnapshot } from '../../../app/uni/profile/ProfileTypes.std.ts';
import type { UnichatContextSnapshot } from '../../../app/uni/UnichatContext.main.ts';
import { uniHttpApi } from '../uni.web.utls.ts';
import type { SignalShellApi } from './preload.preload.ts';
import type { ProfileNotificationState } from '../../../app/uni/profile/ProfileNotificationRouter.main.ts';

type UnichatUserState = Readonly<{
  loading: boolean;
  data?: Record<string, unknown>;
  error?: string;
}>;

const SIGNAL_PLAN_UNAVAILABLE_MESSAGE = '当前套餐无法使用 Signal，请联系客服';

declare global {
  interface Window {
    SignalShell: SignalShellApi;
  }
}

function SignalShell(): ReactElement {
  const [profiles, setProfiles] = useState<ReadonlyArray<ProfileSnapshot>>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>();
  const [busyProfileId, setBusyProfileId] = useState<string>();
  const [editingProfileId, setEditingProfileId] = useState<string>();
  const [editingName, setEditingName] = useState('');
  const [draggedProfileId, setDraggedProfileId] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [notificationState, setNotificationState] = useState<
    ReadonlyArray<ProfileNotificationState>
  >([]);
  const [unichat, setUnichat] = useState<UnichatContextSnapshot>();
  const [unichatUser, setUnichatUser] = useState<UnichatUserState>({
    loading: false,
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem('signal-shell-sidebar-width'));
    return Number.isFinite(stored) && stored >= 160 && stored <= 360
      ? stored
      : 210;
  });
  const signalAllowed = unichatUser.data?.windowNum === -1;

  const refreshProfiles = useCallback(async () => {
    // React renderer 不能直接读主进程中的 ProfileManager，所以通过
    // preload 暴露的安全 API 请求 Profile 快照，再更新左侧列表。
    setProfiles(await window.SignalShell.listProfiles());
  }, []);

  useEffect(() => {
    // 这里必须同时做“读取当前值”和“订阅未来变化”：
    //
    // 1. getUnichatContext() 是一次性 IPC 请求。它解决管理壳开始渲染前，
    //    主进程就已经解析完启动协议的情况，否则 React 会错过那次事件。
    // 2. onUnichatContextChanged() 是长期事件订阅。它解决程序已经打开后，
    //    unichat 再次通过协议唤起同一个 Signal 主进程并传入新 token/brand 的情况。
    // 3. effect 的依赖数组是 []，表示只在组件挂载时安装一次监听，避免每次
    //    React 重渲染都重复注册监听器。
    void window.SignalShell.getUnichatContext().then(setUnichat);

    // onUnichatContextChanged 返回“取消订阅”函数。React 会在组件卸载时调用
    // effect 的返回值，从而移除 ipcRenderer listener，避免内存泄漏和重复回调。
    return window.SignalShell.onUnichatContextChanged(setUnichat);
  }, []);

  useEffect(() => {
    localStorage.setItem('signal-shell-sidebar-width', String(sidebarWidth));
    window.SignalShell.setSidebarWidth(sidebarWidth);
  }, [sidebarWidth]);

  const startSidebarResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const onMove = (moveEvent: globalThis.PointerEvent) => {
        setSidebarWidth(
          Math.max(160, Math.min(360, startWidth + moveEvent.clientX - startX))
        );
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.body.classList.remove('SignalShell--resizing');
      };
      document.body.classList.add('SignalShell--resizing');
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    },
    [sidebarWidth]
  );

  useEffect(() => {
    void loadNotificationState();
    const removeStateListener =
      window.SignalShell.onNotificationStateChanged(setNotificationState);
    const removeActivationListener =
      window.SignalShell.onProfileActivated(setActiveProfileId);
    return () => {
      removeStateListener();
      removeActivationListener();
    };

    async function loadNotificationState(): Promise<void> {
      setNotificationState(await window.SignalShell.getNotificationState());
    }
  }, []);

  useEffect(() => {
    // 该 effect 依赖 unichat：首次拿到协议上下文或以后 token/brand 更新时，
    // 都会重新查询当前 unichat 用户资料。用户资料只用于管理壳展示，不保存到主进程。
    let cancelled = false;
    // token 发生变化时，先清掉上一用户的 UI 状态。只有 customerDetail 返回并且
    // 主进程完成 customerId 绑定后，才显示新用户自己的 Profile。
    setProfiles([]);
    setActiveProfileId(undefined);
    setErrorMessage(undefined);
    if (!unichat?.isAuthenticated) {
      setUnichatUser({ loading: false });
      return () => {
        cancelled = true;
      };
    }

    // getUserData() 最终调用 window.uniIpc.fetch。renderer 只提供 URL、method、body；
    // preload 转发请求，主进程校验发送者和目标域名后再注入真实 token。
    setUnichatUser({ loading: true });
    void uniHttpApi
      .getUserData()
      .then(async (result: any) => {
        // 请求返回前如果 effect 已失效（例如新的协议又到达），忽略旧结果，
        // 防止慢请求覆盖新 token 对应的用户资料。
        if (cancelled) {
          return;
        }
        if (result?.code !== 200) {
          throw new Error(
            result?.msg || `Unichat API returned ${result?.code}`
          );
        }
        const customerId = String(result.data?.customerId ?? '').trim();
        if (!customerId) {
          throw new Error('Unichat user information has no customerId');
        }

        // 当前套餐规则：只有 windowNum === -1 的用户允许使用 Signal。
        // 不满足时绝不能调用 bindCustomer；主进程会继续保持“未绑定用户”状态，
        // 因此即便从 DevTools 手工调用新增/激活/删除 IPC 也会被拒绝。
        if (result.data?.windowNum !== -1) {
          setUnichatUser({ loading: false, data: result.data ?? {} });
          setErrorMessage(SIGNAL_PLAN_UNAVAILABLE_MESSAGE);
          return;
        }

        // 不能只在 React 中按 customerId 过滤。bindCustomer 会让主进程记录
        // 当前用户，之后 list/create/activate/delete 都在主进程再次校验 owner。
        const ownedProfiles = await window.SignalShell.bindCustomer(customerId);
        if (cancelled) {
          return;
        }
        setProfiles(ownedProfiles);
        setUnichatUser({ loading: false, data: result.data ?? {} });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setUnichatUser({ loading: false, error: toErrorMessage(error) });
        }
      });

    return () => {
      // fetch 本身没有在这里中止，但通过标记保证过期响应不会再更新 React state。
      cancelled = true;
    };
  }, [unichat]);

  const activate = useCallback(async (id: string) => {
    // 激活操作由主进程串行完成：按需创建 Runtime，再把对应 View 挂到主窗口。
    // renderer 只在 IPC 成功后更新选中态，避免界面显示已激活但后端启动失败。
    try {
      setErrorMessage(undefined);
      setBusyProfileId(id);
      await window.SignalShell.activateProfile(id);
      setActiveProfileId(id);
      setProfiles(await window.SignalShell.listProfiles());
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyProfileId(undefined);
    }
  }, []);

  const createProfile = useCallback(async () => {
    try {
      setErrorMessage(undefined);
      if (!unichatUser.data?.customerId) {
        throw new Error('请等待 翻译器用户信息加载完成');
      }
      if (unichatUser.data.windowNum !== -1) {
        throw new Error(SIGNAL_PLAN_UNAVAILABLE_MESSAGE);
      }
      const created = await window.SignalShell.createProfile({
        // UUID 同时用于 Profile 目录和 Electron partition，必须不含路径字符。
        id: globalThis.crypto.randomUUID(),
        name: `Signal ${profiles.length + 1}`,
      });
      setProfiles(current => [...current, created]);
      await activate(created.metadata.id);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }, [activate, profiles.length, unichatUser.data]);

  const deleteProfile = useCallback(
    async (profile: ProfileSnapshot) => {
      try {
        setErrorMessage(undefined);
        setBusyProfileId(profile.metadata.id);

        // renderer 不直接删除文件。主进程先显示确认框，再依次释放 View、SQL、
        // Chromium session，最后删除 Profile 目录和元数据。
        const deleted = await window.SignalShell.deleteProfile(
          profile.metadata.id
        );
        if (!deleted) {
          return;
        }

        const deletedIndex = profiles.findIndex(
          item => item.metadata.id === profile.metadata.id
        );
        const remaining = profiles.filter(
          item => item.metadata.id !== profile.metadata.id
        );
        setProfiles(remaining);

        if (activeProfileId === profile.metadata.id) {
          const next = remaining[Math.min(deletedIndex, remaining.length - 1)];
          setActiveProfileId(undefined);
          if (next) {
            await activate(next.metadata.id);
          }
        }
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
        await refreshProfiles();
      } finally {
        setBusyProfileId(undefined);
      }
    },
    [activate, activeProfileId, profiles, refreshProfiles]
  );

  const renameProfile = useCallback(
    async (id: string) => {
      const name = editingName.trim();
      setEditingProfileId(undefined);
      if (!name) {
        return;
      }
      try {
        setBusyProfileId(id);
        setErrorMessage(undefined);
        const renamed = await window.SignalShell.renameProfile(id, name);
        setProfiles(current =>
          current.map(profile =>
            profile.metadata.id === id ? renamed : profile
          )
        );
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
        await refreshProfiles();
      } finally {
        setBusyProfileId(undefined);
      }
    },
    [editingName, refreshProfiles]
  );

  const reorderProfiles = useCallback(
    async (targetId: string) => {
      const sourceId = draggedProfileId;
      setDraggedProfileId(undefined);
      if (!sourceId || sourceId === targetId) {
        return;
      }
      const reordered = [...profiles];
      const sourceIndex = reordered.findIndex(
        profile => profile.metadata.id === sourceId
      );
      if (sourceIndex < 0) {
        return;
      }
      const [moved] = reordered.splice(sourceIndex, 1);
      if (!moved) {
        return;
      }
      const targetIndex = reordered.findIndex(
        profile => profile.metadata.id === targetId
      );
      if (targetIndex < 0) {
        return;
      }
      reordered.splice(targetIndex, 0, moved);
      setProfiles(reordered);
      try {
        setProfiles(
          await window.SignalShell.reorderProfiles(
            reordered.map(profile => profile.metadata.id)
          )
        );
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
        await refreshProfiles();
      }
    },
    [draggedProfileId, profiles, refreshProfiles]
  );

  const finishRenameFromKeyboard = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.currentTarget.blur();
      } else if (event.key === 'Escape') {
        const input = event.currentTarget;
        input.dataset.cancelled = 'true';
        input.blur();
        setEditingProfileId(undefined);
      }
    },
    []
  );

  const allowProfileDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const { dataTransfer } = event;
    dataTransfer.dropEffect = 'move';
  }, []);

  const openDownload = useCallback(
    async (channel: 'lanzou' | 'aws'): Promise<void> => {
      try {
        setErrorMessage(undefined);
        await window.SignalShell.openDownload(channel);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      }
    },
    []
  );

  return (
    <div className="SignalShell">
      <aside
        className="SignalShell__sidebar"
        style={{ minWidth: sidebarWidth, width: sidebarWidth }}
      >
        <header className="SignalShell__header">
          <div>
            <div className="SignalShell__brand">
              {unichat?.brand || 'Unichat'}-signal
            </div>
            <div className="SignalShell__subtitle">
              {getUnichatUserLabel(unichat, unichatUser)}
            </div>
          </div>
          <button
            aria-label="创建 Signal 账号"
            className="SignalShell__createButton"
            disabled={!signalAllowed || unichatUser.loading}
            onClick={() => void createProfile()}
            title="创建 Signal"
            type="button"
          >
            +
          </button>
        </header>

        <nav aria-label="Signal 账号" className="SignalShell__profileList">
          {profiles.map(profile => {
            const id = profile.metadata.id;
            const isActive = id === activeProfileId;
            const isBusy = id === busyProfileId;
            const unreadCount =
              notificationState.find(item => item.profileId === id)
                ?.unreadCount ?? 0;
            return (
              <div
                className={
                  isActive
                    ? 'SignalShell__profile SignalShell__profile--active'
                    : 'SignalShell__profile'
                }
                key={id}
                onDragOver={allowProfileDrop}
                onDrop={() => void reorderProfiles(id)}
              >
                <span
                  aria-label={`拖动排序 ${profile.metadata.name}`}
                  className="SignalShell__dragHandle"
                  draggable={!isBusy}
                  onDragEnd={() => setDraggedProfileId(undefined)}
                  onDragStart={event => {
                    setDraggedProfileId(id);
                    const { dataTransfer } = event;
                    dataTransfer.effectAllowed = 'move';
                    dataTransfer.setData('text/plain', id);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  ⋮⋮
                </span>
                {editingProfileId === id ? (
                  <div className="SignalShell__profileSelect">
                    <span aria-hidden="true" className="SignalShell__avatar">
                      S
                    </span>
                    <input
                      aria-label="Signal 账号名称"
                      autoFocus
                      className="SignalShell__nameInput"
                      maxLength={80}
                      onBlur={event => {
                        if (event.currentTarget.dataset.cancelled !== 'true') {
                          void renameProfile(id);
                        }
                      }}
                      onChange={event => setEditingName(event.target.value)}
                      onKeyDown={finishRenameFromKeyboard}
                      value={editingName}
                    />
                  </div>
                ) : (
                  <button
                    className="SignalShell__profileSelect"
                    disabled={isBusy}
                    onClick={() => void activate(id)}
                    type="button"
                  >
                    <span className="SignalShell__avatarContainer">
                      <span aria-hidden="true" className="SignalShell__avatar">
                        S
                      </span>
                      {unreadCount > 0 ? (
                        <span className="SignalShell__unreadBadge">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      ) : null}
                    </span>
                    <span className="SignalShell__profileText">
                      <span className="SignalShell__profileName">
                        {profile.metadata.name}
                      </span>
                      <span className="SignalShell__profileState">
                        {getStateLabel(profile.state, isBusy)}
                      </span>
                    </span>
                  </button>
                )}
                <button
                  aria-label={`重命名 ${profile.metadata.name}`}
                  className="SignalShell__editButton"
                  disabled={isBusy}
                  onClick={() => {
                    setEditingName(profile.metadata.name);
                    setEditingProfileId(id);
                  }}
                  title="修改名称"
                  type="button"
                >
                  ✎
                </button>
                <button
                  aria-label={`删除 ${profile.metadata.name}`}
                  className="SignalShell__deleteButton"
                  disabled={isBusy}
                  onClick={() => void deleteProfile(profile)}
                  title="关闭并删除账号"
                  type="button"
                >
                  ×
                </button>
              </div>
            );
          })}
        </nav>

        <section aria-label="软件下载" className="SignalShell__downloads">
          <div className="SignalShell__downloadsTitle">软件更新下载</div>
          <button
            className="SignalShell__downloadButton"
            onClick={() => void openDownload('aws')}
            type="button"
          >
            亚马逊通道下载
          </button>
          <button
            className="SignalShell__downloadButton SignalShell__downloadButton--secondary"
            onClick={() => void openDownload('lanzou')}
            type="button"
          >
            蓝奏云通道下载
          </button>
        </section>

        {errorMessage ? (
          <div className="SignalShell__error" role="alert">
            {errorMessage}
          </div>
        ) : null}
      </aside>

      <div
        aria-label="调整侧栏宽度"
        className="SignalShell__resizeHandle"
        onPointerDown={startSidebarResize}
        role="separator"
      />

      <main className="SignalShell__workspace">
        {!unichat?.isAuthenticated ? (
          <section className="SignalShell__empty" role="alert">
            <strong>打开方式错误</strong>
            <span>请重新点击翻译器主程序中的Signal图标</span>
          </section>
        ) : unichatUser.data && !signalAllowed ? (
          <section className="SignalShell__empty" role="alert">
            <strong>当前套餐无法使用 Signal，请联系客服</strong>
            <span>套餐更新后，需点击unichat软件里的Signal图标重新启动</span>
          </section>
        ) : !activeProfileId ? (
          <section className="SignalShell__empty">
            <strong>尚未打开 Signal</strong>
            <span>从左侧创建或选择一个账号开始使用</span>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function getStateLabel(state: ProfileSnapshot['state'], isBusy: boolean) {
  if (isBusy) {
    return '处理中…';
  }
  switch (state) {
    case 'running':
      return '运行中';
    case 'starting':
      return '正在启动';
    case 'failed':
      return '启动失败';
    default:
      return '未启动';
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getUnichatUserLabel(
  context: UnichatContextSnapshot | undefined,
  user: UnichatUserState
): string {
  if (!context?.isAuthenticated) {
    return '等待 unichat 登录';
  }
  if (user.loading) {
    return '正在加载用户信息…';
  }
  if (user.error) {
    return '用户信息加载失败';
  }
  const info = user.data;
  const label = info?.customerName;
  return label == null ? '账号管理' : String(label);
}

const root = document.querySelector<HTMLElement>('#shell-root');
if (!root) {
  throw new Error('Signal shell root was not found');
}
createRoot(root).render(<SignalShell />);
