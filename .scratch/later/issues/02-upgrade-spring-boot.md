# 升级 Spring Boot

Status: needs-triage
Type: Change
来源：1.0.5 grilling（2026-11-08）Q8，见 [`../../v1.0.5/spec.md`](../../v1.0.5/spec.md)「本版不做」

## 背景

`backend/pom.xml` 的 parent 是 `spring-boot-starter-parent` 3.2.5。3.2 这条线已经过了免费支持期，不再有安全修复。1.0.5 只做性能，所以没有夹带升级。1.0.5 的类缓存方案也是在 3.2.5 上实测通过的，不依赖升级。

## 升级时要注意

- **类缓存。** 1.0.5（V105-05）在构建时用训练运行生成应用类缓存，每次 `prepare:resources` 都重新生成，所以升级以后缓存会自动更新，不用手动处理。但要确认 `test:packaged` 的类缓存命中用例依然通过。
- **3.3 起有官方的 CDS 支持：** `java -Djarmode=tools -jar app.jar extract` 能直接产出普通 classpath 布局，`-Dspring.context.exit=onRefresh` 能让训练运行在 context 刷新后自动退出。V105-05 里自己写的布局生成和退出方式，升级后可以考虑换成官方做法。
- 目标版本选 3.x 的最后一条线还是 4.x：4.x 对应 Spring Framework 7 和 Jakarta EE 11，改动面更大。triage 时决定。
- 升级前后各跑一次 `npm run perf:measure`，比较启动时间和内存占用。
- `npm run test:coverage` 的 80% 门槛要保持。

## Comments
