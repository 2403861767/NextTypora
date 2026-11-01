# V103-01: resolveSafe 不拦 Windows 目录联接，可逃逸出工作区

Status: resolved
Type: Bug
Commit prefix: `Fix Bug-V103-01:`
Spec section: 1（见 ../spec.md）

## 现象

`FileService.resolveSafe()` 的第三层防线用 `Files.isSymbolicLink()` 逐段检查，但它对 Windows 目录联接（junction）返回 `false`，于是 junction 可以把路径指向工作区外面而不被拒绝。

## 复现

1. 建工作区 `vault/`、外部目录 `outside/`，在 `outside/` 放 `secret.md`
2. `cmd /c mklink /J vault\link outside`（**无需管理员权限**）
3. 对 `link/secret.md` 调用 `resolveSafe`

实测结果（2026-11-01 本机）：

```
isSymbolicLink(junction)       = false      ← 守卫漏过
startsWith(root)               = true
resolveSafe would REJECT       = false      ← 三层防线全部放行
toRealPath escapes root        = true
content readable               = SECRET     ← 工作区外文件被读出
```

方向是反的：junction 无需提权即可创建（实测 exit 0），而唯一拦得住的符号链接需要管理员权限（实测本机失败，报 Administrator privilege required）。

## 改动

在 `resolveSafe` 的逐段循环里，除 `isSymbolicLink` 外再加一条：该段存在且 `Files.readAttributes(seg, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS).isOther()` 为真则抛 `SecurityException`。这会把全部重解析点（junction、符号链接、挂载点）一并挡掉。

不用 `toRealPath().startsWith(root)`：它要求路径已存在，会让「新建文件」通路抛 `NoSuchFileException`。`isOther()` 对普通文件和目录均为 `false`，对 junction 实测为 `true`。

同步修正 `CLAUDE.md` 规则 1 的措辞，把「symlink escapes」扩成「符号链接与所有重解析点」。

## 验收

- 先有一条用 junction 复现逃逸的测试，且在修复前**确实失败**（红）
- 修复后该测试通过，且后端全量测试无回归
- 读与「新建文件」两条通路都被挡住

## Comments

- 红：新增的 junction 用例在未修复的 `resolveSafe` 上失败——`junction ==> Expected java.lang.SecurityException to be thrown, but nothing was thrown`（FileServiceTest:125 与 :143），`Skipped: 0`。
- 绿：在 `resolveSafe` 的逐段循环里加入 `isReparsePoint()`（`BasicFileAttributes.isOther()` + `NOFOLLOW_LINKS`），两条用例通过。
- 无回归：后端全量 **126 个测试、0 失败、0 跳过**（修复前为 125 个，因为一条静默跳过的用例被换成了两条真跑的）。
- 错误消息从 `Symbolic links are not allowed...` 扩为 `Reparse points are not allowed...`；全仓库无任何代码断言该字符串。
- `CLAUDE.md` 规则 1 已同步改写，并补上"为什么这条检查不是冗余"与"为什么不能简化成 toRealPath"两条说明，防止后人"顺手清理"。
