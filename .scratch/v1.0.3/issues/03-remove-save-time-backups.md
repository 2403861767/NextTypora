# V103-03: 移除保存时备份

Status: resolved
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

## 完成情况（2026-11-01）

后端实现共删掉 64 行备份机械：`backupFile`、`pruneBackups`、`parseBackupTimestamp`，以及 `BACKUP_DIR_NAME`、`MAX_BACKUPS_PER_FILE`、`BACKUP_TIMESTAMP` 三个常量；`writeFileAtomic` 的 `backupExisting` 参数已收敛掉；连带清掉 6 个失效 import（`Instant`、`ArrayList`、`Comparator`、`List`、`Map`、`Matcher`）。`NoteService` 仍保留 `existed`，因为强制保存的审计日志要用。

### 加了反向守卫（原票没要求）

ADR-0001 说"别把它加回来"，但光靠注释挡不住。所以把原先断言"备份目录被创建"的用例**反转**成 `assertNoBackupDirectory()`：

- `FileServiceTest`：GBK 保存、UTF-16 往返两处
- `NoteServiceTest`：强制覆盖外部修改、无 baseHash 新建文件两处

谁把保存时备份加回来，这四处就会红。比注释可靠。

### 与原票的偏差：夹具保留不换

原票要求把 `electron/main.test.js` 与 `App.test.tsx` 里的备份夹具换成 `.assets` 等通用隐藏目录。**我没换，只改了措辞。**

理由：这些目录在老用户的工作区里**现在仍然存在**（V103-04 的清理动作还没做，而且也不会自动删），所以用 `.nexttyproa-backups` 当"隐藏目录"的夹具依然真实，换成 `.assets` 反而丢掉了"老工作区里有这玩意儿"这个现实。覆盖率一样，改动更小。

改掉的是**暗示功能还在**的措辞：

- `main.test.js` 测试名 `so its backups stay recoverable` → `hidden subdirectories included`
- `App.test.tsx` 测试名 `backups included` → `hidden entries included`，常量 `BACKUP` → `LEGACY_HIDDEN`
- 两处注释都注明这是 1.0.3 之前的遗留目录并指向 ADR-0001

### 顺带修掉一处虚假宣传

`README.md:29` 写着"保存时尽量沿用原编码**并生成备份**"。这正是本版要消灭的那类"说话不算数"，所以一并改了：编码那条补上 UTF-16 和原子写，另起一条「数据防线」说明冲突副本与回收站，并明确保存时不生成备份。

### 验证

四个套件全绿：后端 **125/125**（0 跳过；比上一次少 1 条是因为删掉了 `keepsOnlyNewestBackups`）、前端 **190/190**、Electron **26/26**、打包 **12/12**。

`CLAUDE.md` 关键安全规则第 4 条已改写（该文件在 .gitignore 里，不进版本库）：删掉"覆盖前创建 .bak"，补上原子写、UTF-16，并写明"保存不做备份是刻意决定，见 ADR-0001，反向守卫在 assertNoBackupDirectory"。
