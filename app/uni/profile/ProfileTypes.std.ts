// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

export type ProfileId = string;

// profiles.json 中可持久化的数据。这里不要放 WebContentsView、SQL 等运行时对象。
export type ProfileMetadata = Readonly<{
  id: ProfileId;
  // unichat 用户隔离键。Profile 只能被同一 customerId 列出、激活和删除。
  customerId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastActivatedAt?: number;
}>;

export type ProfileRuntimeState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'suspended'
  | 'stopping'
  | 'failed';

// 管理壳 renderer 只需要元数据和状态，因此通过 Snapshot 与主进程解耦。
export type ProfileSnapshot = Readonly<{
  metadata: ProfileMetadata;
  state: ProfileRuntimeState;
}>;
