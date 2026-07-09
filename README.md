# NextTyproa

NextTyproa 是一款受 Typora 启发的本地优先 Markdown 桌面笔记应用，专注于流畅写作、文件夹即工作区、所见即所得编辑和低干扰的阅读体验。

项目由 **凉风辞叶** 开发维护。

## 特性

* **本地优先**：直接读写本地 `.md` / `.markdown` 文件，工作区就是普通文件夹。

* **Typora 风格写作体验**：支持 WYSIWYG 编辑、Markdown 源码模式、多标签、文件树、文件列表和可折叠大纲。

* **安全自动保存**：自动保存前检测外部修改，出现冲突时可选择重新载入、另存副本或强制覆盖。

* **文件管理**：支持新建文件夹、新建 Markdown、重命名、删除、拖拽移动、复制路径和在资源管理器中显示。

* **快速打开与全文搜索**：支持 `Ctrl+P` / `Cmd+P` 快速打开文件，支持按标题、正文、路径、Frontmatter 和标签搜索。

* **查找替换**：支持当前文档查找与替换。

* **HTML / PDF 导出**：基于 flexmark-java 导出 Markdown，支持表格、任务列表、脚注、删除线、自动链接、代码块、图片、Frontmatter 和 Mermaid 源块。

* **图片工作流**：支持本地图片资产保存，也支持通过 PicGo Server 上传图床。

* **主题系统**：内置浅色、深色、Sepia、GitHub、Academic 等主题，桌面版支持导入自定义 CSS 主题。

* **沉浸写作模式**：支持 Focus Mode、Typewriter Mode 和 Distraction Free Mode。

* **编码保护**：支持 UTF-8、UTF-8 BOM、GBK、Big5、Shift-JIS 检测，保存时尽量沿用原编码并生成备份。

* **桌面集成**：Electron 桌面壳支持 Markdown 文件关联、窗口菜单、偏好设置和本地后端代理。

## 技术栈

| 模块  | 技术                                                      |
| --- | ------------------------------------------------------- |
| 桌面端 | Electron                                                |
| 前端  | React 18、Vite、TypeScript、Ant Design、Milkdown、CodeMirror |
| 后端  | Spring Boot 3、Java 17、flexmark-java                     |
| 构建  | npm、Maven、electron-builder                              |

## 项目结构

```text
nextTyproa/
  backend/      Spring Boot 后端，本地文件读写、搜索索引与导出服务
  frontend/     React + Vite 前端应用
  electron/     Electron 主进程与 preload
  build/        桌面端图标与安装脚本
  resources/    打包资源目录
  scripts/      构建、校验和打包脚本
  docs/         项目文档与设计参考
```

## 环境要求

* Node.js 18+

* Java 17+

* Maven 3.9+

* Windows 10/11（当前打包脚本主要面向 Windows）

* 可选：PicGo，用于图床上传模式，需本地下载并配置好PicGoAPP

## 下载安装

普通用户可以直接在 GitHub Releases 页面下载 Windows 版安装包：

* `NextTyproa-1.0.0-win-x64.exe`：Windows 安装包，推荐日常使用。

* `NextTyproa-win-x64.zip`：免安装压缩包，解压后运行 `NextTyproa.exe`。

安装包内置前端资源、后端服务和运行所需的 JRE，不需要额外安装 Node.js、Java 或 Maven。首次运行未签名安装包时，Windows SmartScreen 可能会显示安全确认提示。

### 端口说明

* 开发模式下，前端默认运行在 `http://127.0.0.1:5173`，后端默认运行在 `http://127.0.0.1:8080`。

* 直接运行打包后的 exe 时，前端不会启动 `5173` 端口，而是加载本地打包文件。

* 直接运行打包后的 exe 时，后端会在本机启动一个随机空闲端口，并使用临时令牌保护接口；该端口由 Electron 自动管理，关闭应用后后端进程也会退出。

## 快速开始

安装根目录依赖：

```bash
npm install
```

安装前端依赖：

```bash
cd frontend
npm install
cd ..
```

启动开发环境：

```bash
npm run dev
```

该命令会同时启动：

* Spring Boot 后端：`http://127.0.0.1:8080`

* Vite 前端：`http://127.0.0.1:5173`

* Electron 桌面应用

也可以分别启动：

```bash
npm run dev:backend
npm run dev:frontend
npm run dev:electron
```

## 常用脚本

| 命令                      | 说明                    |
| ----------------------- | --------------------- |
| `npm run dev`           | 同时启动后端、前端和 Electron   |
| `npm run build`         | 构建后端与前端               |
| `npm run dist:verify`   | 运行后端测试、构建项目并校验打包资源    |
| `npm run dist`          | 构建 Windows ZIP 发行包    |
| `npm run dist:dir`      | 构建 Windows 解包目录       |
| `npm run dist:setup`    | 构建 Windows NSIS 安装包   |
| `npm run dist:portable` | 构建 Windows portable 包 |

前端测试：

```bash
cd frontend
npm test
```

后端测试：

```bash
cd backend
mvn test
```

## 打包

建议先运行完整校验：

```bash
npm run dist:verify
```

生成 Windows ZIP 发行包：

```bash
npm run dist
```

生成 Windows 安装包：

```bash
npm run dist:setup
```

打包产物会输出到 `release/` 目录。

## PicGo 图床配置

1. 安装并打开 [PicGo](https://picgo.app/)。
2. 在 PicGo 中配置图床。
3. 开启 PicGo Server，默认地址为 `http://127.0.0.1:36677`。
4. 如果配置了 Server 密钥，在 NextTyproa 偏好设置中填写相同密钥。
5. 在偏好设置中选择 PicGo 图床模式并测试连接。
6. 在编辑器中粘贴或插入图片后，Markdown 会写入图床 URL。

## 快捷键

| 功能             | Windows / Linux        | macOS                 |
| -------------- | ---------------------- | --------------------- |
| 打开 Markdown 文件 | `Ctrl+O`               | `Cmd+O`               |
| 打开文件夹          | `Ctrl+Shift+O`         | `Cmd+Shift+O`         |
| 新建笔记           | `Ctrl+N`               | `Cmd+N`               |
| 保存当前笔记         | `Ctrl+S`               | `Cmd+S`               |
| 快速打开           | `Ctrl+P`               | `Cmd+P`               |
| 关闭当前标签         | `Ctrl+W`               | `Cmd+W`               |
| 全局搜索           | `Ctrl+Shift+F`         | `Cmd+Shift+F`         |
| 当前文档查找         | `Ctrl+F`               | `Cmd+F`               |
| 当前文档替换         | `Ctrl+H`               | `Cmd+H`               |
| 切换源码模式         | `Ctrl+/`               | `Cmd+/`               |
| 专注模式           | `Ctrl+Alt+F`           | `Cmd+Alt+F`           |
| 打字机模式          | `Ctrl+Alt+T`           | `Cmd+Alt+T`           |
| 沉浸写作           | `F11` / `Ctrl+Shift+D` | `F11` / `Cmd+Shift+D` |
| 导出 HTML        | `Ctrl+Shift+E`         | `Cmd+Shift+E`         |
| 导出 PDF         | `Ctrl+Alt+P`           | `Cmd+Alt+P`           |
| 偏好设置           | `Ctrl+,`               | `Cmd+,`               |

## API 概览

后端主要提供本地工作区、文件树、笔记读写、搜索、导出和图片资产接口。

| 方法                                | 路径                   | 说明               |
| --------------------------------- | -------------------- | ---------------- |
| `GET`                             | `/api/health`        | 健康检查             |
| `GET` / `POST`                    | `/api/workspace`     | 获取或设置工作区         |
| `GET`                             | `/api/tree`          | 获取文件树            |
| `POST`                            | `/api/tree/refresh`  | 刷新文件树与搜索索引       |
| `GET` / `PUT` / `POST` / `DELETE` | `/api/note`          | Markdown 笔记 CRUD |
| `POST`                            | `/api/files/folder`  | 创建文件夹            |
| `PUT`                             | `/api/files/rename`  | 重命名文件或文件夹        |
| `PUT`                             | `/api/files/move`    | 移动文件或文件夹         |
| `DELETE`                          | `/api/files`         | 删除文件或文件夹         |
| `POST`                            | `/api/export/html`   | 导出 HTML          |
| `GET`                             | `/api/search`        | 搜索当前工作区 Markdown |
| `GET`                             | `/api/search/status` | 获取搜索索引状态         |
| `POST`                            | `/api/asset`         | 本地图片上传           |
| `GET`                             | `/api/asset`         | 本地图片读取           |

开发模式请求后端接口时需要携带：

```http
X-Auth-Token: dev-token-change-me
```

## 配置说明

* 后端默认配置：`backend/src/main/resources/application.yml`

* 桌面内嵌配置：`backend/src/main/resources/application-embedded.yml`

* Electron 设置：用户数据目录中的 `settings.json`

* 自定义主题：Electron 用户数据目录下的 `themes/*.css`

* 环境变量示例：`.env.example`

## 贡献

欢迎提交 Issue 和 Pull Request。建议在提交前运行：

```bash
npm run dist:verify
```

如果只修改前端，也建议额外运行：

```bash
cd frontend
npm test
```

提交 PR 时请尽量说明：

* 修改目的

* 主要变更

* 本地验证命令

* 可能影响的功能范围

## 作者

**凉风辞叶**

## 许可证

本项目基于 MIT License 开源。
