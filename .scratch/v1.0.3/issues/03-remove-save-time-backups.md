# V103-03: 移除保存时备份

Status: ready-for-agent
Type: Change
Commit prefix: `Change V103-03:`
Spec section: 2（见 ../spec.md）

## 决定

见 `docs/adr/0001-no-save-time-backups.md`。`.nexttyproa-backups/` 是只写不读的目录，没有恢复入口；真正的数据防线是冲突副本与系统回收站。

## 改动

- 删 `backupFile`、`pruneBackups`、`parseBackupTimestamp`、`BACKUP_DIR_NAME`、`MAX_BACKUPS_PER_FILE`、`BACKUP_TIMESTAMP`
- `writeFileAtomic` 收敛掉 `backupExisting` 参数
- 删 `FileServiceTest.keepsOnlyNewestBackups`
- `electron/main.test.js` 与 `App.test.tsx` 中涉及备份的用例**只换夹具**（改用 `.assets` 等通用隐藏目录），保留覆盖——它们测的是隐藏目录的通用处理
- `CLAUDE.md` 规则 4 改为只讲编码保留与原子写，并显式写明「保存时不做备份，见 ADR-0001」

## 验收

全量测试绿；保存已存在的笔记后，同目录不再出现 `.nexttyproa-backups/`；冲突副本与回收站两条通路行为不变。

## Comments
