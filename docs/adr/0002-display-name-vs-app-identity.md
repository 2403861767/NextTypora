# 显示名与应用身份分离

Status: accepted

产品名长期被错拼为 `NextTyproa`（`yp` 颠倒），而启动闪屏显示的是正确的 `NextTypora`，于是用户看到的第一屏和任务栏是两个名字。我们在 1.0.3 把显示层统一为 `NextTypora`，同时**显式调用 `app.setName('NextTyproa')`**，让 Electron 的 userData 路径继续指向旧位置。

原因：userData 路径由 `app.getName()` 决定，而它默认取 `package.json` 的 `productName`。只要改了 `productName`，已安装用户的 `settings.json` 和 `themes/` 就会被留在旧目录里——主题、自定义快捷键、最近工作区、打开的标签页全部静默丢失。

## Consequences

那行 `app.setName('NextTyproa')` 看起来像个拼写错误，但它是保护已安装用户数据的唯一一行。**删掉它会在一次升级里静默清空所有老用户的设置。**

`appId` 与 Java 包名同样保留 `nexttyproa`：改 `appId` 会让 Windows 把它当成一个新软件，旧版本不会被覆盖，用户机器上会留下两个安装。

因此这个项目里「显示名」和「应用身份」是两个独立概念，见 `GLOSSARY.md`。
