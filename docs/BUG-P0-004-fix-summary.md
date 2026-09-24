# BUG-P0-004 修复总结

## Bug 描述
**Electron 主进程崩溃 - 后端进程未正确清理**

当 Electron 主进程异常退出（如 `kill -9` 或 `taskkill /F`）时，后端 Java 进程可能成为孤儿进程继续运行，占用端口和内存资源。

## 根本原因

1. **现有清理机制的局限性**
   - Electron 在 `will-quit` 事件中调用 `backendProcess.kill()` 清理后端
   - 如果主进程被强制杀死（SIGKILL），这些事件不会触发
   - 后端进程没有父进程监听机制，无法感知主进程已退出

2. **影响场景**
   - 用户强制关闭应用（任务管理器 → 结束任务）
   - 系统崩溃或断电
   - 开发调试时频繁重启
   - 多次启动后端口被占用

## 修复方案

**采用后端父进程存活监控机制**（跨平台、最可靠）

### 实现细节

#### 1. Electron 侧传递主进程 PID
**文件**: `electron/main.js:249`

```javascript
const env = {
  ...process.env,
  SPRING_PROFILES_ACTIVE: 'embedded',
  SERVER_PORT: '0',
  AUTH_TOKEN: token,
  VAULT_PATH: settings.lastWorkspace || '',
  PARENT_PID: String(process.pid),  // 新增：传递主进程 PID
};
```

#### 2. 后端父进程监控服务
**文件**: `backend/src/main/java/com/nexttyproa/service/ParentProcessMonitor.java`（新增）

- 启动时读取 `PARENT_PID` 环境变量
- 启动守护线程，每 5 秒检查父进程是否存活
- 使用 `ProcessHandle.of(pid).isPresent()` 检测（Java 9+）
- 如果父进程不存在，延迟 1 秒后调用 `System.exit(0)` 退出

#### 3. 集成到应用启动流程
**文件**: `backend/src/main/java/com/nexttyproa/NextTyproaApplication.java`

```java
@EventListener(ApplicationReadyEvent.class)
public void onReady(ApplicationReadyEvent event) {
    // ... 现有逻辑 ...
    
    // 启动父进程监控
    parentProcessMonitor.startMonitoring();
}
```

## 技术亮点

1. **兼容性良好**
   - Dev 模式下无 `PARENT_PID` 环境变量时自动跳过监控
   - 不影响现有的优雅退出流程（`will-quit` 事件）
   - 作为最后防线，仅在异常情况下生效

2. **跨平台支持**
   - 使用 Java 标准 API `ProcessHandle`，Windows/Linux/macOS 通用
   - 不依赖操作系统特定功能（如 Windows JobObject）

3. **资源高效**
   - 守护线程，不影响主业务逻辑
   - 5 秒检测间隔，CPU 占用可忽略
   - 进程退出时自动清理

## 验证方法

### 手动测试
1. 打包应用：`npm run dist:dir`
2. 启动应用，查看后端日志确认监控已启动
3. 打开任务管理器，记录后端 Java 进程 PID
4. 强制结束 Electron 主进程：`taskkill /F /IM NextTyproa.exe`
5. 检查后端 Java 进程是否在 5-10 秒内自动退出

### 预期结果
- 后端日志输出：`父进程 <pid> 已不存在，后端进程即将退出`
- Java 进程在检测到父进程消失后 1 秒内退出
- 端口释放，内存清理

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `electron/main.js` | 修改 | 添加 `PARENT_PID` 环境变量传递 |
| `backend/src/main/java/com/nexttyproa/service/ParentProcessMonitor.java` | 新增 | 父进程监控服务 |
| `backend/src/main/java/com/nexttyproa/NextTyproaApplication.java` | 修改 | 启动监控服务 |
| `BUG_BACKLOG.md` | 修改 | 标记 BUG-P0-004 为已完成 |

## 测试结果

- ✅ 后端编译通过：`mvn clean compile`
- ✅ 单元测试通过：`mvn test`
- ✅ 打包成功：`npm run dist:dir`
- ✅ 开发模式兼容性：无 `PARENT_PID` 时正常跳过监控

## 遗留问题

无

## 相关 Issue

- BUG-P0-004: Electron 主进程崩溃 - 后端进程未正确清理

---

**修复日期**: 2026-09-24  
**修复人**: Claude Opus 5  
**Git Commit**: `df912fa`
