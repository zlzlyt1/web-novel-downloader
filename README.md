# 全网小说下载器 + 阅读器

[简体中文](#简体中文) · [English](#english)

## 简体中文

一个 Windows Electron 桌面应用：按书名搜索全网小说结果，载入书籍目录页，下载公开可见章节为 UTF-8 TXT，并用内置阅读器阅读。

## 功能

- 按完整书名搜索番茄、起点、纵横、晋江、17K、七猫、豆瓣及其他网站
- 所有 HTTP/HTTPS 搜索结果均可“载入下载器”并尝试识别公开章节目录
- 通用网页解析器自动发现同站章节链接、提取正文，并支持章节范围、限速、失败占位和 TXT 导出
- 番茄小说使用专用适配器，支持书籍页/阅读页识别和正文字体反混淆
- 自动跳过番茄付费或锁定章节；不绕过其他网站的登录、付费、验证码或访问控制
- 内置阅读器支持目录导航、字号、行距、段距、主题、阅读进度，以及“均衡/铺满”排版；铺满模式保留语义段落并使用自然换行，不拉伸字间距
- 阅读器可检查章节更新：保留已下载正文，只下载并追加来源目录中的新章节；旧版 TXT 首次提供书籍目录链接后即可建立更新记录
- 再次下载同一本书会自动去重并检查更新；没有新章节时不重复写入，来源不同的同名书会另存为新文件
- 阅读器书架会自动收录打开过的 TXT / Markdown，显示章节数并支持直接打开或仅移出书架（不删除本地文件）
- 可打开任意本地 TXT 或 Markdown 文件

## 下载兼容性说明

“载入下载器”会对每个网络结果提供相同入口，但网站技术和访问限制不同：

- 服务端直接输出公开目录和正文的网站，可由通用解析器下载。
- 登录、付费、验证码、403 风控、纯 JavaScript 动态页面会明确报错或留下失败章节。
- 本应用不会规避网站访问限制，也无法保证任意网页都能成功解析。

## 运行与构建

```powershell
npm start
npm run dist
```

Windows x64 2.1.5 构建产物位于 `release/`：

- `全网小说下载器 Setup 2.1.5.exe`：安装版
- `全网小说下载器 2.1.5.exe`：免安装便携版

也可以使用命令行：

```powershell
node src/crawler/cli.js <书籍目录URL> [章节数上限] [输出目录]
```

离线优化已有 TXT 段落：

```powershell
npm run optimize -- "E:\路径\小说.txt"
```

## 使用说明

1. 输入完整书名并点击“搜索网络”。
2. 在任意结果旁点击“载入下载器”，或直接粘贴书籍目录页链接。
3. 获取书籍信息后选择保存目录与章节范围，点击“开始下载”。
4. 下载完成后可直接阅读或打开所在文件夹。
5. 阅读已下载的 TXT 时，点击右上角“更新”；程序只会将新章节附加到文件结尾。旧版 TXT 会在首次更新时要求粘贴一次书籍目录页链接。
6. 点击阅读器左上角“书架”，可管理已打开的书籍；移出书架不会删除原始文件。

## 项目结构

```text
main.js                         Electron 主进程与 IPC
preload.js                      安全桥接
src/crawler/fanqie.js           番茄专用适配器
src/crawler/generic.js          通用公开网页目录/正文解析器
src/crawler/downloader.js       多来源下载编排
src/crawler/txt.js              TXT 导出
src/search/web-search.js        全网书名搜索
src/renderer/                   主界面与阅读器
scripts/test-generic-crawler.js 通用解析离线测试
build/icon-source.jpg           用户指定的应用图标源图
```

## 合规提示

本工具仅用于个人学习、研究，以及备份自己有权访问的公开内容。请遵守目标网站服务条款和相关法律法规，尊重作者版权，支持正版；请勿用于商业用途或大规模批量抓取。

## English

Web Novel Downloader + Reader is a Windows Electron desktop app that searches novel titles across the web, loads public chapter indexes, downloads accessible chapters as UTF-8 TXT, and reads them locally.

### Features

- Search by full title across multiple novel websites.
- Load HTTP/HTTPS results and attempt to detect public chapter indexes.
- Generic parser for chapter links and article text, with chapter ranges, rate limiting, failed-chapter placeholders, and TXT export.
- Dedicated Fanqie adapter for public book/reading pages and text decoding.
- Does not bypass login, payment, CAPTCHA, or access controls.
- Built-in reader with table of contents, themes, progress, typography controls, and natural full-width layout.
- Persistent bookshelf for opened TXT/Markdown files; remove a shelf record without deleting the local file.
- Incremental updates preserve existing chapters and append only newly discovered chapters.
- Re-downloading the same book automatically deduplicates by stable chapter ID or URL.

### Download and build

Windows x64 2.1.5 packages are built in `release/`:

- `全网小说下载器 Setup 2.1.5.exe` — installer.
- `全网小说下载器 2.1.5.exe` — portable edition.

```powershell
npm start
npm run dist
```

### Usage

1. Enter a complete title and click “搜索网络” (Search the web).
2. Load a result or paste a book index URL.
3. Choose an output directory and chapter range, then start downloading.
4. Open the TXT in the reader; use “更新” to append new chapters and “书架” to manage opened books.

### Compliance

For personal learning, research, and backup of content you are authorized to access only. Follow each website’s terms and applicable laws, respect copyright, and do not use this project for commercial or large-scale scraping.
