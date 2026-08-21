# Web Novel Downloader + Reader

Language: [简体中文](README.md) · [English](README.en.md)

A Windows Electron desktop app that searches novel titles across the web, loads book indexes, downloads publicly accessible chapters as UTF-8 TXT, and reads them in the built-in reader.

## Features

- Search by full title across multiple novel websites.
- Load any HTTP/HTTPS result and attempt to detect its public chapter index.
- Generic parser for chapter links and article text, with range selection, rate limiting, failed-chapter placeholders, and TXT export.
- Dedicated adapter for Fanqie public book/reading pages and text decoding.
- Skips paid or locked chapters; does not bypass login, payment, CAPTCHA, or access controls.
- Built-in reader with table of contents, font size, line height, paragraph spacing, themes, progress, and balanced/full-width layout modes.
- Open local TXT or Markdown files.

## Download

Windows x64 packages are attached to the [v2.1.1 GitHub Release](https://github.com/zlzlyt1/web-novel-downloader/releases/tag/v2.1.1):

- `全网小说下载器 Setup 2.1.1.exe` — installer.
- `全网小说下载器 2.1.1.exe` — portable edition.

See [`release/README.md`](release/README.md) or [`release/README.en.md`](release/README.en.md) for release notes and verification files.

## Run and build

```powershell
npm start
npm run dist
```

The command-line crawler is also available:

```powershell
node src/crawler/cli.js <book-index-url> [chapter-limit] [output-directory]
```

Optimize existing TXT paragraph layout offline:

```powershell
npm run optimize -- "E:\path\novel.txt"
```

## Usage

1. Enter a complete title and click “搜索网络” (Search the web).
2. Click “载入下载器” (Load downloader) beside a result, or paste a book index URL.
3. Choose the output directory and chapter range, then start the download.
4. Read the exported file in the app or open its folder.

## Compliance

For personal learning, research, and backup of content you are authorized to access only. Follow each website’s terms and applicable laws, respect copyright, support official editions, and do not use this project for commercial or large-scale scraping.
