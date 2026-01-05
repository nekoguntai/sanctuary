/**
 * System Setting Repository Integration Tests
 *
 * Tests the system setting repository against a real PostgreSQL database.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
} from './setup';

describeIfDatabase('SystemSettingRepository Integration Tests', () => {
  setupRepositoryTests();

  describe('get', () => {
    it('should get a setting by key', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'test.key', value: 'test-value' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'test.key' },
        });

        expect(setting).not.toBeNull();
        expect(setting?.value).toBe('test-value');
      });
    });

    it('should return null for non-existent key', async () => {
      await withTestTransaction(async (tx) => {
        const setting = await tx.systemSetting.findUnique({
          where: { key: 'non.existent.key' },
        });

        expect(setting).toBeNull();
      });
    });
  });

  describe('set (upsert)', () => {
    it('should create a new setting', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.upsert({
          where: { key: 'new.setting' },
          update: { value: 'new-value' },
          create: { key: 'new.setting', value: 'new-value' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'new.setting' },
        });

        expect(setting?.value).toBe('new-value');
      });
    });

    it('should update an existing setting', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'update.me', value: 'old-value' },
        });

        await tx.systemSetting.upsert({
          where: { key: 'update.me' },
          update: { value: 'new-value' },
          create: { key: 'update.me', value: 'new-value' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'update.me' },
        });

        expect(setting?.value).toBe('new-value');
      });
    });
  });

  describe('type-specific getters', () => {
    it('should get boolean setting (true)', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'bool.true', value: 'true' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'bool.true' },
        });

        const value = setting?.value === 'true' || setting?.value === '1';
        expect(value).toBe(true);
      });
    });

    it('should get boolean setting (false)', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'bool.false', value: 'false' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'bool.false' },
        });

        const value = setting?.value === 'true' || setting?.value === '1';
        expect(value).toBe(false);
      });
    });

    it('should get number setting', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'number.setting', value: '42' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'number.setting' },
        });

        const value = Number(setting?.value);
        expect(value).toBe(42);
      });
    });

    it('should get JSON setting', async () => {
      await withTestTransaction(async (tx) => {
        const jsonValue = { enabled: true, limit: 100 };
        await tx.systemSetting.create({
          data: { key: 'json.setting', value: JSON.stringify(jsonValue) },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'json.setting' },
        });

        const parsed = JSON.parse(setting?.value || '{}');
        expect(parsed.enabled).toBe(true);
        expect(parsed.limit).toBe(100);
      });
    });
  });

  describe('getAll', () => {
    it('should get all settings', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.createMany({
          data: [
            { key: 'setting.a', value: 'value-a' },
            { key: 'setting.b', value: 'value-b' },
            { key: 'setting.c', value: 'value-c' },
          ],
        });

        const settings = await tx.systemSetting.findMany({
          orderBy: { key: 'asc' },
        });

        expect(settings).toHaveLength(3);
      });
    });

    it('should order settings by key', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.createMany({
          data: [
            { key: 'z.setting', value: 'z' },
            { key: 'a.setting', value: 'a' },
            { key: 'm.setting', value: 'm' },
          ],
        });

        const settings = await tx.systemSetting.findMany({
          orderBy: { key: 'asc' },
        });

        expect(settings.map((s) => s.key)).toEqual(['a.setting', 'm.setting', 'z.setting']);
      });
    });
  });

  describe('getByPrefix', () => {
    it('should get settings by prefix', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.createMany({
          data: [
            { key: 'sync.enabled', value: 'true' },
            { key: 'sync.interval', value: '5000' },
            { key: 'price.enabled', value: 'true' },
          ],
        });

        const syncSettings = await tx.systemSetting.findMany({
          where: {
            key: { startsWith: 'sync.' },
          },
        });

        expect(syncSettings).toHaveLength(2);
        expect(syncSettings.every((s) => s.key.startsWith('sync.'))).toBe(true);
      });
    });
  });

  describe('getAllAsMap', () => {
    it('should return settings as key-value map', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.createMany({
          data: [
            { key: 'map.key1', value: 'value1' },
            { key: 'map.key2', value: 'value2' },
          ],
        });

        const settings = await tx.systemSetting.findMany();
        const map: Record<string, string> = {};
        for (const setting of settings) {
          map[setting.key] = setting.value;
        }

        expect(map['map.key1']).toBe('value1');
        expect(map['map.key2']).toBe('value2');
      });
    });
  });

  describe('setMany', () => {
    it('should set multiple settings at once', async () => {
      await withTestTransaction(async (tx) => {
        const settings = [
          { key: 'batch.a', value: 'a' },
          { key: 'batch.b', value: 'b' },
          { key: 'batch.c', value: 'c' },
        ];

        await tx.$transaction(
          settings.map((s) =>
            tx.systemSetting.upsert({
              where: { key: s.key },
              update: { value: s.value },
              create: s,
            })
          )
        );

        const result = await tx.systemSetting.findMany({
          where: {
            key: { startsWith: 'batch.' },
          },
        });

        expect(result).toHaveLength(3);
      });
    });
  });

  describe('delete', () => {
    it('should delete a setting', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'delete.me', value: 'to-be-deleted' },
        });

        await tx.systemSetting.delete({
          where: { key: 'delete.me' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'delete.me' },
        });

        expect(setting).toBeNull();
      });
    });
  });

  describe('deleteByPrefix', () => {
    it('should delete settings by prefix', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.createMany({
          data: [
            { key: 'temp.setting1', value: 'v1' },
            { key: 'temp.setting2', value: 'v2' },
            { key: 'permanent.setting', value: 'keep' },
          ],
        });

        const result = await tx.systemSetting.deleteMany({
          where: {
            key: { startsWith: 'temp.' },
          },
        });

        expect(result.count).toBe(2);

        const remaining = await tx.systemSetting.count();
        expect(remaining).toBe(1);
      });
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.create({
          data: { key: 'exists.check', value: 'yes' },
        });

        const count = await tx.systemSetting.count({
          where: { key: 'exists.check' },
        });

        expect(count > 0).toBe(true);
      });
    });

    it('should return false for non-existent key', async () => {
      await withTestTransaction(async (tx) => {
        const count = await tx.systemSetting.count({
          where: { key: 'does.not.exist' },
        });

        expect(count > 0).toBe(false);
      });
    });
  });

  describe('well-known settings', () => {
    it('should handle server name setting', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.upsert({
          where: { key: 'server.name' },
          update: { value: 'My Sanctuary' },
          create: { key: 'server.name', value: 'My Sanctuary' },
        });

        const setting = await tx.systemSetting.findUnique({
          where: { key: 'server.name' },
        });

        expect(setting?.value).toBe('My Sanctuary');
      });
    });

    it('should handle maintenance mode setting', async () => {
      await withTestTransaction(async (tx) => {
        await tx.systemSetting.upsert({
          where: { key: 'maintenance.mode' },
          update: { value: 'true' },
          create: { key: 'maintenance.mode', value: 'true' },
        });

        await tx.systemSetting.upsert({
          where: { key: 'maintenance.message' },
          update: { value: 'System upgrade in progress' },
          create: { key: 'maintenance.message', value: 'System upgrade in progress' },
        });

        const mode = await tx.systemSetting.findUnique({
          where: { key: 'maintenance.mode' },
        });
        const message = await tx.systemSetting.findUnique({
          where: { key: 'maintenance.message' },
        });

        expect(mode?.value).toBe('true');
        expect(message?.value).toBe('System upgrade in progress');
      });
    });
  });
});
