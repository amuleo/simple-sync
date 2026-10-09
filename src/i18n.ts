export type Lang = 'en' | 'fa';

export const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    'app.name': 'Simple SYNC',

    // Sections
    'section.appearance': 'Appearance',
    'section.auth': 'Authentication',
    'section.repo': 'Repository',
    'section.behavior': 'Behavior',

    // Settings
    'settings.title': 'Simple SYNC',
    'settings.actions': 'Actions',
    'settings.actions.desc': 'Open the main modal or the user guide',
    'settings.language': 'Language',
    'settings.language.desc': 'Interface language',
    'settings.lang.en': 'English',
    'settings.lang.fa': 'فارسی',
    'settings.notifications': 'Show notifications',
    'settings.showStatusBar': 'Show status bar icon',
    'settings.token': 'GitHub Token',
    'settings.token.desc': 'Fine-grained PAT with Contents: Read & Write',
    'settings.connection': 'Connection',
    'settings.connection.idle': 'Not tested yet',
    'settings.connection.ok': '✅ Connected as {user}',
    'settings.connection.fail': '❌ {error}',
    'settings.suggested': '⭐ Suggested repositories',
    'settings.suggested.desc': 'Likely Obsidian vaults',
    'settings.suggested.select': '--- Select ---',
    'settings.allRepos': 'All repositories',
    'settings.repo': 'Repository name',
    'settings.branch': 'Branch',
    'settings.backupFolder': 'Backup folder in repo',
    'settings.backupFolder.desc': 'Where ZIP archives are stored on GitHub',
    'settings.localFolder': 'Local backup folder',
    'settings.localFolder.desc': 'Where local copies are kept inside the vault',

    // Actions
    'action.open': 'Open Simple SYNC',
    'action.guide': 'User Guide',
    'action.test': 'Test Connection',
    'action.test.testing': 'Testing…',
    'action.close': 'Close',
    'action.cancel': 'Cancel',
    'action.confirm': 'Confirm',
    'action.refresh': 'Refresh',
    'action.back': 'Back',

    // Status bar
    'status.idle': '☁️ Simple SYNC',
    'status.busy': '⏳ Working',
    'status.ok': '✅ Done',
    'status.error': '❌ Failed',

    // Commands
    'cmd.open': 'Open Simple SYNC',
    'cmd.quickBackup': 'Quick Backup',
    'cmd.guide': 'Open User Guide',

    // Main modal
    'modal.title': 'Simple SYNC',
    'modal.subtitle': 'Backup and restore your vault using GitHub',
    'modal.tab.backup': 'Backup',
    'modal.tab.restore': 'Restore',
    'modal.tab.about': 'About',

    // Backup tab
    'backup.title': 'Create a Backup',
    'backup.desc': 'Write a short description, then create a snapshot of your entire vault.',
    'backup.descriptionLabel': 'Description',
    'backup.descriptionPlaceholder': 'e.g. Before major restructuring',
    'backup.button': 'Create Backup',
    'backup.includeSystem': 'Include hidden and system folders (.obsidian, .trash)',
    'backup.stats.calculating': 'Calculating file count…',
    'backup.stats': '{count} files · {folders} folders · {size}',
    'backup.scanning': 'Scanning vault…',
    'backup.creating': 'Creating ZIP archive…',
    'backup.splitting': 'Splitting archive into {count} parts…',
    'backup.uploading': 'Uploading to GitHub…',
    'backup.uploadingPart': 'Uploading part {current} of {total}…',
    'backup.localCopy': 'Saving local copy…',
    'backup.finished': '✅ Backup created successfully',
    'backup.finishedMulti': '✅ Backup created ({count} parts)',
    'backup.failed': '❌ Backup failed: {error}',
    'backup.lastBackup': 'Last backup',
    'backup.largeFile': 'Archive is {size} — will be split into {parts} parts',

    // Restore tab
    'restore.title': 'Restore from a Backup',
    'restore.desc': 'Choose a snapshot from your GitHub archive and restore it.',
    'restore.loading': 'Loading backups…',
    'restore.empty': 'No backups yet',
    'restore.button': 'Restore',
    'restore.showMore': 'Show {count} more',
    'restore.confirmTitle': 'Confirm Restore',
    'restore.confirmMessage': 'A snapshot of your current vault will be saved locally before restoring. Continue?',
    'restore.includeSystem': 'Include system files',
    'restore.includeSystem.desc': 'Restore hidden and system folders (.obsidian, .trash) from this backup',
    'restore.includeSystem.none': 'This backup does not contain system files',
    'restore.includeSystem.unknown': 'System file status unknown (older backup). Enable to attempt restore.',
    'restore.snapshotting': 'Saving current vault…',
    'restore.downloading': 'Downloading archive…',
    'restore.downloadingPart': 'Downloading part {current} of {total}…',
    'restore.reassembling': 'Reassembling archive…',
    'restore.extracting': 'Extracting files…',
    'restore.finished': '✅ Restored {count} files',
    'restore.failed': '❌ Restore failed: {error}',
    'restore.noDescription': '(no description)',
    'restore.multiPart': '{count} parts',

    // Progress modal
    'progress.title': 'Working…',
    'progress.percent': '{percent}%',
    'progress.cancelling': 'Cancelling…',
    'progress.cancelled': 'Operation cancelled',
    'progress.step.scanning': 'Scanning vault…',
    'progress.step.creating': 'Creating ZIP archive…',
    'progress.step.splitting': 'Splitting into parts…',
    'progress.step.uploading': 'Uploading to GitHub…',
    'progress.step.uploadingPart': 'Uploading parts…',
    'progress.step.snapshotting': 'Saving current vault…',
    'progress.step.downloading': 'Downloading archive…',
    'progress.step.downloadingPart': 'Downloading parts…',
    'progress.step.reassembling': 'Reassembling…',
    'progress.step.extracting': 'Extracting files…',
    'progress.step.localCopy': 'Saving local copy…',
    'progress.step.done': 'Done',

    // About tab
    'about.title': 'About',
    'about.text': 'Simple SYNC is a lightweight vault archiver. It stores timestamped ZIP snapshots in your GitHub repository, and keeps a local mirror in your vault. Every file is included by default — including hidden and system folders.',
    'about.safety': 'Safety',
    'about.safety.text': '• Your token never leaves your device.\n• Every restore saves a snapshot of the current vault first.\n• The .backup folder is excluded from future backups to avoid nesting.',

    // Guide
    'guide.title': 'Simple SYNC — User Guide',
    'guide.tab.start': 'Getting Started',
    'guide.tab.commands': 'Commands',
    'guide.tab.backup': 'Backup',
    'guide.tab.restore': 'Restore',
    'guide.tab.safety': 'Safety',
    'guide.tab.faq': 'FAQ',

    // Errors
    'error.noToken': 'Token not set',
    'error.noRepo': 'Repository not configured',
    'error.locked': 'Another operation is running',
    'error.unknown': 'Unknown error',
  },

  fa: {
    'app.name': 'سینک ساده',

    'section.appearance': 'ظاهر',
    'section.auth': 'احراز هویت',
    'section.repo': 'مخزن',
    'section.behavior': 'رفتار',

    'settings.title': 'سینک ساده',
    'settings.actions': 'عملیات',
    'settings.actions.desc': 'باز کردن مودال اصلی یا راهنما',
    'settings.language': 'زبان',
    'settings.language.desc': 'زبان رابط کاربری',
    'settings.lang.en': 'English',
    'settings.lang.fa': 'فارسی',
    'settings.notifications': 'نمایش اعلان‌ها',
    'settings.showStatusBar': 'نمایش آیکون در نوار وضعیت',
    'settings.token': 'توکن گیت‌هاب',
    'settings.token.desc': 'توکن Fine-grained با دسترسی Contents: Read & Write',
    'settings.connection': 'اتصال',
    'settings.connection.idle': 'هنوز تست نشده',
    'settings.connection.ok': '✅ متصل به {user}',
    'settings.connection.fail': '❌ {error}',
    'settings.suggested': '⭐ مخازن پیشنهادی',
    'settings.suggested.desc': 'احتمالاً مخازن Obsidian هستند',
    'settings.suggested.select': '--- انتخاب کنید ---',
    'settings.allRepos': 'همه‌ی مخازن',
    'settings.repo': 'نام مخزن',
    'settings.branch': 'شاخه',
    'settings.backupFolder': 'پوشه‌ی پشتیبان در مخزن',
    'settings.backupFolder.desc': 'محل ذخیره‌ی ZIPها در گیت‌هاب',
    'settings.localFolder': 'پوشه‌ی پشتیبان محلی',
    'settings.localFolder.desc': 'محل ذخیره‌ی نسخه‌های محلی در مخزن',

    'action.open': 'باز کردن سینک ساده',
    'action.guide': 'راهنمای کاربر',
    'action.test': 'تست اتصال',
    'action.test.testing': 'در حال تست…',
    'action.close': 'بستن',
    'action.cancel': 'انصراف',
    'action.confirm': 'تایید',
    'action.refresh': 'تازه‌سازی',
    'action.back': 'بازگشت',

    'status.idle': '☁️ سینک ساده',
    'status.busy': '⏳ در حال کار',
    'status.ok': '✅ انجام شد',
    'status.error': '❌ خطا',

    'cmd.open': 'باز کردن سینک ساده',
    'cmd.quickBackup': 'پشتیبان‌گیری سریع',
    'cmd.guide': 'باز کردن راهنما',

    'modal.title': 'سینک ساده',
    'modal.subtitle': 'پشتیبان‌گیری و بازیابی با گیت‌هاب',
    'modal.tab.backup': 'پشتیبان‌گیری',
    'modal.tab.restore': 'بازیابی',
    'modal.tab.about': 'درباره',

    'backup.title': 'ساخت پشتیبان',
    'backup.desc': 'توضیح کوتاهی بنویس، سپس یک اسنپ‌شات از کل مخزن بساز.',
    'backup.descriptionLabel': 'توضیحات',
    'backup.descriptionPlaceholder': 'مثلاً: قبل از بازسازی بزرگ',
    'backup.button': 'ساخت پشتیبان',
    'backup.includeSystem': 'شامل پوشه‌های مخفی و سیستمی (.obsidian, .trash)',
    'backup.stats.calculating': 'در حال محاسبه تعداد فایل…',
    'backup.stats': '{count} فایل · {folders} پوشه · {size}',
    'backup.scanning': 'اسکن مخزن…',
    'backup.creating': 'ساخت فایل ZIP…',
    'backup.splitting': 'تقسیم آرشیو به {count} بخش…',
    'backup.uploading': 'آپلود به گیت‌هاب…',
    'backup.uploadingPart': 'آپلود بخش {current} از {total}…',
    'backup.localCopy': 'ذخیره‌ی نسخه‌ی محلی…',
    'backup.finished': '✅ پشتیبان با موفقیت ساخته شد',
    'backup.finishedMulti': '✅ پشتیبان ساخته شد ({count} بخش)',
    'backup.failed': '❌ پشتیبان‌گیری ناموفق: {error}',
    'backup.lastBackup': 'آخرین پشتیبان',
    'backup.largeFile': 'حجم آرشیو {size} است — به {parts} بخش تقسیم می‌شود',

    'restore.title': 'بازیابی از پشتیبان',
    'restore.desc': 'یک اسنپ‌شات از آرشیو گیت‌هاب انتخاب کن و بازیابی کن.',
    'restore.loading': 'در حال بارگذاری پشتیبان‌ها…',
    'restore.empty': 'هنوز پشتیبانی وجود ندارد',
    'restore.button': 'بازیابی',
    'restore.showMore': 'نمایش {count} مورد بیشتر',
    'restore.confirmTitle': 'تایید بازیابی',
    'restore.confirmMessage': 'قبل از بازیابی، یک اسنپ‌شات از مخزن فعلی ذخیره می‌شود. ادامه؟',
    'restore.includeSystem': 'شامل فایل‌های سیستمی',
    'restore.includeSystem.desc': 'بازیابی پوشه‌های مخفی و سیستمی (.obsidian, .trash) از این پشتیبان',
    'restore.includeSystem.none': 'این پشتیبان شامل فایل‌های سیستمی نیست',
    'restore.includeSystem.unknown': 'وضعیت فایل‌های سیستمی نامشخص است (پشتیبان قدیمی). برای تلاش، فعال کنید.',
    'restore.snapshotting': 'ذخیره‌ی مخزن فعلی…',
    'restore.downloading': 'دانلود آرشیو…',
    'restore.downloadingPart': 'دانلود بخش {current} از {total}…',
    'restore.reassembling': 'بازسازی آرشیو…',
    'restore.extracting': 'استخراج فایل‌ها…',
    'restore.finished': '✅ {count} فایل بازیابی شد',
    'restore.failed': '❌ بازیابی ناموفق: {error}',
    'restore.noDescription': '(بدون توضیح)',
    'restore.multiPart': '{count} بخش',

    'progress.title': 'در حال انجام…',
    'progress.percent': '{percent}%',
    'progress.cancelling': 'در حال لغو…',
    'progress.cancelled': 'عملیات لغو شد',
    'progress.step.scanning': 'اسکن مخزن…',
    'progress.step.creating': 'ساخت فایل ZIP…',
    'progress.step.splitting': 'تقسیم به بخش‌ها…',
    'progress.step.uploading': 'آپلود به گیت‌هاب…',
    'progress.step.uploadingPart': 'آپلود بخش‌ها…',
    'progress.step.snapshotting': 'ذخیره‌ی مخزن فعلی…',
    'progress.step.downloading': 'دانلود آرشیو…',
    'progress.step.downloadingPart': 'دانلود بخش‌ها…',
    'progress.step.reassembling': 'بازسازی…',
    'progress.step.extracting': 'استخراج فایل‌ها…',
    'progress.step.localCopy': 'ذخیره‌ی نسخه‌ی محلی…',
    'progress.step.done': 'انجام شد',

    'about.title': 'درباره',
    'about.text': 'سینک ساده یک آرشیوگر سبک برای مخزن شماست. اسنپ‌شات‌های ZIP زمان‌دار را در مخزن گیت‌هاب شما ذخیره می‌کند و یک نسخه‌ی محلی هم در مخزن نگه می‌دارد. به‌طور پیش‌فرض همه‌ی فایل‌ها شامل می‌شوند — حتی پوشه‌های مخفی و سیستمی.',
    'about.safety': 'امنیت',
    'about.safety.text': '• توکن شما هرگز از دستگاه خارج نمی‌شود.\n• قبل از هر بازیابی، یک اسنپ‌شات از مخزن فعلی ذخیره می‌شود.\n• پوشه‌ی .backup از پشتیبان‌گیری‌های بعدی مستثنی می‌شود.',

    'guide.title': 'سینک ساده — راهنمای کاربر',
    'guide.tab.start': 'شروع کار',
    'guide.tab.commands': 'دستورات',
    'guide.tab.backup': 'پشتیبان‌گیری',
    'guide.tab.restore': 'بازیابی',
    'guide.tab.safety': 'امنیت',
    'guide.tab.faq': 'سوالات متداول',

    'error.noToken': 'توکن تنظیم نشده',
    'error.noRepo': 'مخزن تنظیم نشده',
    'error.locked': 'یک عملیات دیگر در حال اجراست',
    'error.unknown': 'خطای ناشناخته',
  },
};

export class I18n {
  private lang: Lang;

  constructor(lang: Lang = 'en') {
    this.lang = lang;
  }

  setLang(lang: Lang): void {
    this.lang = lang;
  }

  getLang(): Lang {
    return this.lang;
  }

  isRtl(): boolean {
    return this.lang === 'fa';
  }

  t(key: string, vars?: Record<string, string | number>): string {
    const template = STRINGS[this.lang][key] || STRINGS.en[key] || key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_, k) =>
      vars[k] !== undefined ? String(vars[k]) : `{${k}}`
    );
  }

  applyDirection(el: HTMLElement): void {
    const rtl = this.isRtl();
    el.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    el.style.textAlign = rtl ? 'right' : 'left';
    el.toggleClass('simple-sync-rtl', rtl);
  }
}
