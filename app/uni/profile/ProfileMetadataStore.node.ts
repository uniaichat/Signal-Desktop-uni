// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import type { ProfileId, ProfileMetadata } from './ProfileTypes.std.ts';

const profileMetadataSchema = z.object({
  id: z.string().min(1),
  // optional 仅用于兼容读取旧 profiles.json。没有 owner 的历史 Profile
  // 不会自动分配给任意用户，也不会出现在新用户列表中。
  customerId: z.string().min(1).optional(),
  name: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  lastActivatedAt: z.number().int().nonnegative().optional(),
});

const metadataFileSchema = z.object({
  version: z.literal(1),
  profiles: z.array(profileMetadataSchema),
});

type StoredProfileMetadata = z.infer<typeof profileMetadataSchema>;
type MetadataFile = z.infer<typeof metadataFileSchema>;

const EMPTY_FILE: MetadataFile = { version: 1, profiles: [] };

// 只负责 profiles.json，不负责启动/停止 Profile。
// 文件位置：<Signal userData>/shell/profiles.json。
export class ProfileMetadataStore {
  readonly #metadataPath: string;

  #writeChain: Promise<void> = Promise.resolve();

  public constructor(shellDataPath: string) {
    this.#metadataPath = join(shellDataPath, 'profiles.json');
  }

  public async list(): Promise<ReadonlyArray<StoredProfileMetadata>> {
    return (await this.#read()).profiles;
  }

  public async get(id: ProfileId): Promise<StoredProfileMetadata | undefined> {
    return (await this.#read()).profiles.find(item => item.id === id);
  }

  public async upsert(profile: ProfileMetadata): Promise<void> {
    // 所有写入串行化，避免用户快速创建/切换时发生“后写覆盖先写”。
    await this.#enqueueWrite(async () => {
      const data = await this.#read();
      const index = data.profiles.findIndex(item => item.id === profile.id);
      const profiles = [...data.profiles];
      if (index === -1) {
        profiles.push(profile);
      } else {
        profiles[index] = profile;
      }
      await this.#write({ version: 1, profiles });
    });
  }

  public async remove(id: ProfileId): Promise<void> {
    await this.#enqueueWrite(async () => {
      const data = await this.#read();
      await this.#write({
        version: 1,
        profiles: data.profiles.filter(item => item.id !== id),
      });
    });
  }

  public async reorderCustomer(
    customerId: string,
    orderedIds: ReadonlyArray<ProfileId>
  ): Promise<void> {
    await this.#enqueueWrite(async () => {
      const data = await this.#read();
      const customerProfiles = data.profiles.filter(
        profile => profile.customerId === customerId
      );
      const byId = new Map(
        customerProfiles.map(profile => [profile.id, profile])
      );
      if (
        orderedIds.length !== customerProfiles.length ||
        new Set(orderedIds).size !== orderedIds.length ||
        orderedIds.some(id => !byId.has(id))
      ) {
        throw new Error('Profile order does not match the current user');
      }

      const ordered = orderedIds.map(id => {
        const profile = byId.get(id);
        if (!profile) {
          throw new Error(`Unknown Profile in order: ${id}`);
        }
        return profile;
      });
      let customerIndex = 0;
      const profiles = data.profiles.map(profile => {
        if (profile.customerId !== customerId) {
          return profile;
        }
        const orderedProfile = ordered[customerIndex];
        customerIndex += 1;
        if (!orderedProfile) {
          throw new Error('Profile order is incomplete');
        }
        return orderedProfile;
      });
      await this.#write({ version: 1, profiles });
    });
  }

  async #read(): Promise<MetadataFile> {
    try {
      const contents = await readFile(this.#metadataPath, 'utf8');
      return metadataFileSchema.parse(JSON.parse(contents));
    } catch (error) {
      if (
        typeof error === 'object' &&
        error != null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return EMPTY_FILE;
      }
      throw error;
    }
  }

  async #write(data: MetadataFile): Promise<void> {
    await mkdir(dirname(this.#metadataPath), { recursive: true });
    const temporaryPath = `${this.#metadataPath}.tmp`;
    // 先写临时文件再 rename，避免应用异常退出留下半截 JSON。
    await writeFile(
      temporaryPath,
      `${JSON.stringify(data, null, 2)}\n`,
      'utf8'
    );
    await rename(temporaryPath, this.#metadataPath);
  }

  async #enqueueWrite(operation: () => Promise<void>): Promise<void> {
    // 即使上一项写入失败，也允许后续写入继续排队执行。
    const result = this.#writeChain.then(operation, operation);
    this.#writeChain = result.catch(() => undefined);
    await result;
  }
}
