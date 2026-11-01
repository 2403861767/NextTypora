# V103-05: 解除 jar 文件名与版本号的耦合

Status: resolved
Type: Change
Commit prefix: `Change V103-05:`
Spec section: 4（见 ../spec.md）

## 背景

`backend-1.0.0.jar` 被硬编码在 `scripts/copy-backend-jar.js:4` 和 `scripts/verify-dist-resources.js:7`。于是「把版本号改对」这个动作本身会让构建断掉（`copy-backend-jar.js` 直接 `process.exit(1)`）——这大概是版本号一直没被改的原因之一。

## 改动

- `backend/pom.xml` 加 `<finalName>backend</finalName>`，产出永远是 `backend.jar`
- 两个脚本里的 `backend-1.0.0.jar` 改成 `backend.jar`

这一步消灭整类问题，而不是绕过它。必须排在 V103-06 之前。

## 验收

`npm run build` 后 `resources/backend.jar` 存在；`pom.xml` 的 version 改成任意值都不影响构建。

## Comments

## 完成情况（2026-11-01）

`backend/pom.xml` 的 `<build>` 加了 `<finalName>backend</finalName>`，产物固定为 `backend.jar`；`scripts/copy-backend-jar.js:4` 与 `scripts/verify-dist-resources.js:7` 里写死的 `backend-1.0.0.jar` 改成 `backend.jar`。全仓库已无 `backend-1.0.0` 残留。

### 验证方式：把 pom 版本临时改成 9.9.9

这是本票的要点——"改版本号会不会弄断构建"只能靠真的改一次来证明：

```
pom version -> 9.9.9
mvn -DskipTests package  → backend/target/backend.jar   （不是 backend-9.9.9.jar）
node scripts/copy-backend-jar.js
  → Copied ...ackend	argetackend.jar -> ...esourcesackend.jar
```

改动前这一步会输出 "Backend jar not found" 并 `process.exit(1)`。验完已把 pom 版本改回 `1.0.0`——按 Q19，它从此是构建元数据，不跟随发布版本。
