# V103-02: 唯一覆盖头号安全规则的测试可以静默消失

Status: resolved
Type: Bug
Commit prefix: `Fix Bug-V103-02:`
Spec section: 11（见 ../spec.md）

## 现象

`FileServiceTest.resolveSafeRejectsSymlinkPathSegment`（`:74-85`）在 `Files.createSymbolicLink` 抛异常时执行 `assumeTrue(false)`，静默跳过、不留任何信号。

而本机实测符号链接创建就是失败的（需要管理员权限）——**这条唯一覆盖 `CLAUDE.md` 头号安全规则的测试从未真正跑过，一次都没有**。这正是 V103-01 那个漏洞能藏住的原因。

## 改动

- 新增 junction 版用例：用 `cmd /c mklink /J` 创建（实测无需提权），断言 `resolveSafe` 拒绝
- 保留符号链接用例，降级为「能建就测」
- **当两种链接都建不出来时，测试失败而非静默通过**

## 验收

一条可以静默消失的安全测试比没有测试更坏，因为它让人以为有覆盖。验收标准就是：在本机（无提权、无开发者模式）跑后端测试时，这条规则**确实被验证了**。

## Comments

- `resolveSafeRejectsSymlinkPathSegment` 连同它的 `assumeTrue(false)` 一并删除，换成两条：
  - `resolveSafeRejectsReparsePointPathSegment`：两种链接都试，**都建不出来时 `assertNotNull` 失败**而非静默跳过。
  - `resolveSafeRejectsDirectoryJunctionPathSegment`（`@EnabledOnOs(WINDOWS)`）：显式只走 junction，避免在开发者模式机器上永远只验证 symlink 分支。
- 本机实测：符号链接创建失败（需管理员权限），用例自动回退到 junction 并真实执行——这正是修复前漏洞能藏住的那条路径。
- 后端全量 `Skipped: 0`。
