# Release files

Language: [简体中文](README.md) · [English](README.en.md)

Current stable version: **2.1.5**

Download the Windows x64 installer and portable executable from [GitHub Releases](https://github.com/zlzlyt1/web-novel-downloader/releases).

The repository keeps installation instructions and SHA-256 checksums. See the root [`README.en.md`](../README.en.md) for project documentation.

## Included packages

- `全网小说下载器 Setup 2.1.5.exe` — installer with desktop and Start Menu shortcuts.
- `全网小说下载器 2.1.5.exe` — portable edition; no installation required.

## 2.1.4 bookshelf and update features

- Persistent reader bookshelf for opened TXT and Markdown files.
- Incremental chapter updates that preserve existing text.
- Duplicate download detection by stable chapter ID or URL.

## 2.1.1 layout fixes

- Preserves semantic paragraphs in full-width mode.
- Removes artificial full-width spaces and character-spacing expansion.
- Cleans abnormal spaces around Chinese punctuation and quotation marks.
- Keeps the full available window width while using natural line wrapping.
- Adds regression coverage for dialogue-heavy text and hard line-break fragments.

## Security note

The Windows binaries are not signed with a commercial code-signing certificate, so Windows may show “Unknown publisher”. Use `SHA256SUMS.txt` to verify file integrity.
