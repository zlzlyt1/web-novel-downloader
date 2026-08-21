# Web Novel Downloader + Reader

[简体中文](README.md) · [English](README.en.md)

A Windows Electron desktop app that searches novel titles across the web, loads book indexes, downloads publicly accessible chapters as UTF-8 TXT, and reads them in the built-in reader.

## Features

- Search by full title across multiple novel websites.
- Load any HTTP/HTTPS result and attempt to detect its public chapter index.
- Generic parser for chapter links and article text, with range selection, rate limiting, failed-chapter placeholders, and TXT export.
- Dedicated adapter for Fanqie public book/reading pages and text decoding.
- Skips paid or locked chapters; does not bypass login, payment, CAPTCHA, or access controls.
- Built-in reader with table of contents, font size, line height, paragraph spacing, themes, progress, and paragraph optimization that turns sentence-per-paragraph mobile exports into natural desktop-width paragraphs while preserving chapters, dialogue, and scene breaks.
- Chapter updates live in the downloader's downloaded-books list: enter a larger target chapter number and append only unseen chapters in that range while preserving the existing TXT. Older files can be migrated by supplying the index URL once.
- Re-downloading the same book automatically deduplicates and checks for updates. A book with the same title from another source is saved separately rather than overwritten.
- A persistent bookshelf automatically collects opened TXT/Markdown files, shows chapter counts, and can remove a record without deleting the local file.
- Open local TXT or Markdown files.

## Download

Windows x64 2.1.8 packages are built in `release/`:

- `全网小说下载器 Setup 2.1.8.exe` — installer.
- `全网小说下载器 2.1.8.exe` — portable edition.

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
5. In the downloader's downloaded-books list, manually increase the “更新到” target and click “追加”. Existing text stays unchanged and only unseen chapters in the requested range are appended. For an older TXT without source metadata, paste its index URL once when prompted.
6. Click “书架” (Bookshelf) in the reader to manage opened books. Removing an item never deletes its local file.

## Compliance

For personal learning, research, and backup of content you are authorized to access only. Follow each website’s terms and applicable laws, respect copyright, support official editions, and do not use this project for commercial or large-scale scraping.
