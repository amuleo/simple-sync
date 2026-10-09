# Simple SYNC

> A lightweight, reliable backup and restore plugin for Obsidian — using GitHub as a timestamped archive. Bilingual (English / Persian), mobile-first, and safe by design.

---

## English

### What is Simple SYNC?

Simple SYNC turns your GitHub repository into a **time-stamped vault archive**. Instead of syncing files one by one and dealing with merge conflicts, it takes clean snapshots of your entire vault and stores them as ZIP files. Every snapshot is dated, described, and easy to restore.

It's simple, predictable, and works identically on Android, iOS, Windows, and macOS.

### Features

- 📦 **Full-vault snapshots** — every file, every folder, including hidden and system ones (`.obsidian`, `.trash`, etc.)
- 📅 **Persian (Jalali) calendar** — folder names use accurate dates like `1405.01.15`
- 📝 **User descriptions** — attach a short note to each backup so you remember why
- 🔄 **One-click restore** — pick any snapshot and restore it
- 🛡️ **Automatic pre-restore snapshot** — before any restore, your current vault is saved locally
- 💾 **Dual storage** — every backup goes both to GitHub and to a local `.backup/` folder in your vault
- 🌐 **Bilingual** — English and Persian, with dynamic RTL support
- 📱 **Mobile-first** — responsive modals for both phone and desktop
- 🔒 **Private by design** — your token never leaves your device
- 📖 **Built-in user guide** — full walkthrough inside the plugin

### How it works

**Backup:**
1. Open the plugin → **Backup** tab
2. Write a short description
3. Click **Create Backup**

The plugin then:
- Scans your entire vault (all files, all folders)
- Builds a ZIP archive
- Uploads it to `backups/YYYY.MM.DD/` in your GitHub repository
- Saves a mirror copy to `.backup/` inside your vault

**Restore:**
1. Open the plugin → **Restore** tab
2. Pick a snapshot from the list
3. Click **Restore**

The plugin then:
- Saves a snapshot of your current vault to `.backup/snapshot-*`
- Downloads the chosen ZIP
- Extracts it into your vault, overwriting existing files

### Installation

**Via BRAT (recommended):**
1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. Open BRAT settings → **Add Beta plugin**
3. Enter: `amuleo/simple-sync`
4. Enable **Simple SYNC** in Community Plugins

**Manual install:**
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/amuleo/simple-sync/releases)
2. Place them in `.obsidian/plugins/simple-sync/`
3. Restart Obsidian and enable the plugin

### Setup

1. Create a **fine-grained Personal Access Token** on GitHub with `Contents: Read & Write` permission
2. Open Obsidian → Settings → **Simple SYNC**
3. Paste your token and click **Test Connection**
4. Choose a repository from the suggested list (or all repositories)
5. Start backing up

### Commands

| Command | Description |
|---|---|
| `Open Simple SYNC` | Opens the main modal |
| `Quick Backup` | Creates a backup without opening the modal |
| `Open User Guide` | Opens the built-in documentation |

### Safety

- ✅ No automatic overwrites without confirmation
- ✅ Pre-restore snapshot of the current vault
- ✅ Token stored locally only
- ✅ `.backup` folder always excluded from new backups
- ✅ Your other repositories are never touched

### Requirements

- Obsidian 1.4.0 or newer
- A GitHub account with a fine-grained Personal Access Token

### License

MIT © AMULEO

---

## فارسی

### سینک ساده چیست؟

سینک ساده مخزن گیت‌هاب شما را به یک **آرشیو زمان‌دار برای Vault** تبدیل می‌کند. به جای همگام‌سازی فایل‌به‌فایل و درگیری با تداخل‌ها، از کل Vault شما اسنپ‌شات‌های تمیز می‌گیرد و آن‌ها را به صورت فایل ZIP ذخیره می‌کند. هر اسنپ‌شات تاریخ‌دار، توضیح‌دار و به‌راحتی قابل بازیابی است.

ساده، قابل پیش‌بینی و با عملکرد یکسان روی اندروید، iOS، ویندوز و مک.

### امکانات

- 📦 **اسنپ‌شات کامل Vault** — همه‌ی فایل‌ها، همه‌ی پوشه‌ها، شامل پوشه‌های مخفی و سیستمی (`.obsidian`, `.trash` و…)
- 📅 **تقویم شمسی** — نام پوشه‌ها با تاریخ دقیق مثل `1405.01.15`
- 📝 **توضیحات کاربر** — برای هر پشتیبان می‌توانید یک یادداشت کوتاه بنویسید
- 🔄 **بازیابی با یک کلیک** — از لیست اسنپ‌شات‌ها یکی را انتخاب و بازیابی کنید
- 🛡️ **اسنپ‌شات خودکار قبل از بازیابی** — قبل از هر بازیابی، Vault فعلی به صورت محلی ذخیره می‌شود
- 💾 **ذخیره‌سازی دوگانه** — هر پشتیبان هم در گیت‌هاب و هم در پوشه‌ی محلی `.backup/` ذخیره می‌شود
- 🌐 **دو زبانه** — انگلیسی و فارسی با پشتیبانی خودکار از RTL
- 📱 **موبایل-اول** — مودال‌های رسپانسیو برای گوشی و دسکتاپ
- 🔒 **حریم خصوصی** — توکن شما هرگز از دستگاه خارج نمی‌شود
- 📖 **راهنمای داخلی** — آموزش کامل درون افزونه

### نحوه‌ی کار

**پشتیبان‌گیری:**
۱. افزونه را باز کنید → تب **پشتیبان‌گیری**
۲. توضیح کوتاهی بنویسید
۳. روی **ساخت پشتیبان** بزنید

افزونه سپس:
- کل Vault شما را اسکن می‌کند (همه‌ی فایل‌ها و پوشه‌ها)
- یک فایل ZIP می‌سازد
- آن را در مسیر `backups/YYYY.MM.DD/` در مخزن گیت‌هاب آپلود می‌کند
- یک نسخه‌ی آینه در `.backup/` داخل Vault ذخیره می‌کند

**بازیابی:**
۱. افزونه را باز کنید → تب **بازیابی**
۲. یکی از اسنپ‌شات‌ها را از لیست انتخاب کنید
۳. روی **بازیابی** بزنید

افزونه سپس:
- یک اسنپ‌شات از Vault فعلی در `.backup/snapshot-*` ذخیره می‌کند
- ZIP انتخاب‌شده را دانلود می‌کند
- آن را در Vault استخراج می‌کند و فایل‌های موجود را بازنویسی می‌کند

### نصب

**با BRAT (پیشنهادی):**
۱. [BRAT](https://github.com/TfTHacker/obsidian42-brat) را از Community Plugins نصب کنید
۲. تنظیمات BRAT → **Add Beta plugin**
۳. وارد کنید: `amuleo/simple-sync`
۴. **Simple SYNC** را در Community Plugins فعال کنید

**نصب دستی:**
۱. فایل‌های `main.js`، `manifest.json` و `styles.css` را از [آخرین Release](https://github.com/amuleo/simple-sync/releases) دانلود کنید
۲. آن‌ها را در مسیر `.obsidian/plugins/simple-sync/` قرار دهید
۳. Obsidian را ری‌استارت و افزونه را فعال کنید

### راه‌اندازی

۱. یک **توکن Fine-grained** در گیت‌هاب با دسترسی `Contents: Read & Write` بسازید
۲. Obsidian → تنظیمات → **Simple SYNC**
۳. توکن را پیست کنید و روی **تست اتصال** بزنید
۴. یک مخزن از لیست پیشنهادی (یا از همه‌ی مخازن) انتخاب کنید
۵. پشتیبان‌گیری را شروع کنید

### دستورات

| دستور | توضیح |
|---|---|
| `Open Simple SYNC` | باز کردن مودال اصلی |
| `Quick Backup` | ساخت پشتیبان بدون باز کردن مودال |
| `Open User Guide` | باز کردن راهنمای داخلی |

### امنیت

- ✅ بدون بازنویسی خودکار بدون تایید
- ✅ اسنپ‌شات قبل از بازیابی
- ✅ توکن فقط به‌صورت محلی ذخیره می‌شود
- ✅ پوشه‌ی `.backup` همیشه از پشتیبان‌گیری‌های جدید مستثنی است
- ✅ سایر مخازن شما هرگز دست‌کاری نمی‌شوند

### پیش‌نیازها

- Obsidian نسخه‌ی ۱.۴.۰ یا بالاتر
- یک اکانت گیت‌هاب با توکن Fine-grained

### مجوز

MIT © AMULEO
