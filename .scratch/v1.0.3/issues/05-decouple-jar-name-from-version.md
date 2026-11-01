# V103-05: 解除 jar 文件名与版本号的耦合

Status: ready-for-agent
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
