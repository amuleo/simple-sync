import { App, Modal } from 'obsidian';
import SimpleSyncPlugin from './main';

type GuideTab = 'start' | 'commands' | 'backup' | 'restore' | 'safety' | 'faq';

interface Section { title: string; lines: string[]; }
type Content = Record<GuideTab, Section>;

export class GuideModal extends Modal {
  plugin: SimpleSyncPlugin;
  activeTab: GuideTab = 'start';

  constructor(app: App, plugin: SimpleSyncPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass('simple-sync-modal');
    this.plugin.i18n.applyDirection(this.modalEl);

    this.titleEl.setText(this.plugin.i18n.t('guide.title'));

    // Back button
    const backBtn = this.titleEl.createEl('button', {
      cls: 'simple-sync-back-btn',
      text: '‹',
      attr: { 'aria-label': this.plugin.i18n.t('action.back') },
    });
    backBtn.onclick = () => this.close();
    this.titleEl.appendChild(
      this.titleEl.createEl('span', {
        text: this.plugin.i18n.t('guide.title'),
        cls: 'simple-sync-title-text',
      })
    );

    this.render();
  }

  private getContent(): Content {
    const lang = this.plugin.i18n.getLang();

    if (lang === 'fa') {
      return {
        start: {
          title: 'شروع کار',
          lines: [
            '۱. در تنظیمات، توکن گیت‌هاب خود را وارد کنید.',
            '۲. روی «تست اتصال» بزنید. اگر موفق شد، لیست مخازن شما بارگذاری می‌شود.',
            '۳. یک مخزن انتخاب کنید (پیشنهاد می‌شود یک مخزن خصوصی مخصوص بکاپ).',
            '۴. روی «باز کردن سینک ساده» بزنید.',
            '۵. توضیح کوتاهی بنویسید و روی «ساخت پشتیبان» بزنید.',
            '',
            'نکته: قبل از اولین پشتیبان‌گیری، مطمئن شوید که مخزن گیت‌هاب شما خالی یا آماده است.',
          ],
        },
        commands: {
          title: 'دستورات',
          lines: [
            'این افزونه ۳ دستور دارد:',
            '',
            '🔹 Open Simple SYNC',
            '   باز کردن مودال اصلی برای پشتیبان‌گیری و بازیابی.',
            '',
            '🔹 Quick Backup',
            '   ساخت سریع یک پشتیبان بدون باز کردن مودال.',
            '',
            '🔹 Open User Guide',
            '   همان پنجره‌ای که الان می‌بینید.',
          ],
        },
        backup: {
          title: 'پشتیبان‌گیری',
          lines: [
            '۱. تب «پشتیبان‌گیری» را باز کنید.',
            '۲. در کادر توضیحات، یک یادداشت کوتاه بنویسید (اختیاری).',
            '۳. روی «ساخت پشتیبان» بزنید.',
            '',
            'افزونه به‌صورت خودکار:',
            '   • کل مخزن شما را اسکن می‌کند (شامل پوشه‌های مخفی مثل .obsidian)',
            '   • یک فایل ZIP می‌سازد',
            '   • آن را در مسیر backups/YYYY.MM.DD/ در گیت‌هاب آپلود می‌کند',
            '   • یک کپی محلی در پوشه‌ی .backup/ داخل مخزن ذخیره می‌کند',
            '',
            'نام پوشه با تاریخ شمسی است. اگر در همان روز چند بکاپ بگیرید،',
            'به نام پوشه یک پسوند تصادفی اضافه می‌شود.',
          ],
        },
        restore: {
          title: 'بازیابی',
          lines: [
            '۱. تب «بازیابی» را باز کنید.',
            '۲. لیست پشتیبان‌های موجود نمایش داده می‌شود (اول ۷ مورد).',
            '۳. برای دیدن موارد بیشتر، روی «نمایش بیشتر» بزنید.',
            '۴. یکی را انتخاب و روی «بازیابی» بزنید.',
            '',
            'قبل از بازیابی، افزونه یک اسنپ‌شات از مخزن فعلی در',
            'پوشه‌ی .backup/snapshot-* ذخیره می‌کند تا در صورت نیاز',
            'بتوانید به وضعیت قبلی برگردید.',
            '',
            'در مودال تایید، می‌توانید انتخاب کنید که فایل‌های سیستمی',
            '(مثل .obsidian) هم بازیابی شوند یا نه.',
          ],
        },
        safety: {
          title: 'امنیت',
          lines: [
            '✅ توکن شما هرگز از دستگاه خارج نمی‌شود.',
            '✅ قبل از هر بازیابی، یک اسنپ‌شات از مخزن فعلی ذخیره می‌شود.',
            '✅ پوشه‌ی .backup همیشه از پشتیبان‌گیری‌های بعدی مستثنی است.',
            '✅ سایر مخازن شما هرگز دست‌کاری نمی‌شوند.',
            '✅ پشتیبان‌ها روی گیت‌هاب (و در صورت خصوصی بودن) محرمانه باقی می‌مانند.',
          ],
        },
        faq: {
          title: 'سوالات متداول',
          lines: [
            '❓ آیا پوشه‌های مخفی مثل .obsidian هم پشتیبان‌گیری می‌شوند؟',
            '   بله، اگر گزینه‌ی «شامل پوشه‌های مخفی» روشن باشد.',
            '',
            '❓ پوشه‌ی .backup چیست؟',
            '   یک پوشه‌ی محلی که نسخه‌های محلی و اسنپ‌شات‌ها را نگه می‌دارد.',
            '   این پوشه هرگز در پشتیبان‌گیری‌های بعدی قرار نمی‌گیرد.',
            '',
            '❓ اگر دو دستگاه داشته باشم چه می‌شود؟',
            '   هر دستگاه پشتیبان‌های خودش را در گیت‌هاب می‌بیند و می‌تواند هرکدام را بازیابی کند.',
          ],
        },
      };
    }

    return {
      start: {
        title: 'Getting Started',
        lines: [
          '1. Open settings and paste your GitHub token.',
          '2. Click "Test Connection". On success your repos load.',
          '3. Pick a repository (a private one is recommended).',
          '4. Click "Open Simple SYNC".',
          '5. Write a short description and click "Create Backup".',
          '',
          'Tip: Make sure your GitHub repo is empty or ready before the first backup.',
        ],
      },
      commands: {
        title: 'Commands',
        lines: [
          'This plugin provides 3 commands:',
          '',
          '🔹 Open Simple SYNC',
          '   Opens the main modal for backup and restore.',
          '',
          '🔹 Quick Backup',
          '   Creates a backup without opening the modal.',
          '',
          '🔹 Open User Guide',
          '   The window you are reading now.',
        ],
      },
      backup: {
        title: 'Backup',
        lines: [
          '1. Open the "Backup" tab.',
          '2. Write a short description (optional).',
          '3. Click "Create Backup".',
          '',
          'The plugin then:',
          '   • Scans your entire vault (including hidden folders)',
          '   • Builds a ZIP archive',
          '   • Uploads it to backups/YYYY.MM.DD/ on GitHub',
          '   • Saves a local mirror to .backup/ inside your vault',
          '',
          'Folder names use the Persian (Jalali) calendar.',
          'Multiple backups on the same day receive a random suffix.',
        ],
      },
      restore: {
        title: 'Restore',
        lines: [
          '1. Open the "Restore" tab.',
          '2. Your available backups are listed (first 7).',
          '3. Click "Show more" for additional items.',
          '4. Pick one and click "Restore".',
          '',
          'Before restoring, the plugin saves a snapshot of your current vault',
          'to .backup/snapshot-* so you can recover if needed.',
          '',
          'In the confirmation dialog you can choose whether to also',
          'restore system files (like .obsidian).',
        ],
      },
      safety: {
        title: 'Safety',
        lines: [
          '✅ Your token never leaves your device.',
          '✅ Every restore saves a snapshot of the current vault first.',
          '✅ The .backup folder is always excluded from new backups.',
          '✅ Other repositories are never touched.',
          '✅ Backups stay private if your repo is private.',
        ],
      },
      faq: {
        title: 'FAQ',
        lines: [
          '❓ Are hidden folders like .obsidian included?',
          '   Yes, if the "Include hidden" option is enabled.',
          '',
          '❓ What is the .backup folder?',
          '   A local folder that stores local mirrors and pre-restore snapshots.',
          '   It is always excluded from new backups.',
          '',
          '❓ What if I use multiple devices?',
          '   Each device sees all backups in the same GitHub repo.',
        ],
      },
    };
  }

  private render() {
    const t = (k: string) => this.plugin.i18n.t(k);
    const { contentEl } = this;
    contentEl.empty();

    const tabs = contentEl.createEl('div', { cls: 'simple-sync-tabs' });
    const content = this.getContent();

    const tabDefs: Array<[GuideTab, string]> = [
      ['start', t('guide.tab.start')],
      ['commands', t('guide.tab.commands')],
      ['backup', t('guide.tab.backup')],
      ['restore', t('guide.tab.restore')],
      ['safety', t('guide.tab.safety')],
      ['faq', t('guide.tab.faq')],
    ];

    for (const [id, label] of tabDefs) {
      const btn = tabs.createEl('button', {
        text: label,
        cls: `simple-sync-tab ${this.activeTab === id ? 'is-active' : ''}`,
      });
      btn.onclick = () => { this.activeTab = id; this.render(); };
    }

    const section = content[this.activeTab];
    const body = contentEl.createEl('div', { cls: 'simple-sync-guide-body' });
    body.createEl('h3', { text: section.title });
    for (const line of section.lines) {
      if (line === '') body.createEl('div', { cls: 'simple-sync-guide-spacer' });
      else body.createEl('p', { text: line, cls: 'simple-sync-guide-line' });
    }

    const footer = contentEl.createEl('div', { cls: 'simple-sync-modal-footer' });
    const close = footer.createEl('button', { text: t('action.close'), cls: 'mod-cta' });
    close.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
