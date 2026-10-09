import { App, Modal, Notice, Setting } from 'obsidian';
import SimpleSyncPlugin from './main';
import { BackupManager, BackupEntry } from './backup-manager';
import { ProgressModal } from './progress-modal';
import { askConfirmation } from './confirm-modal';

type Tab = 'backup' | 'restore' | 'about';

export class BackupModal extends Modal {
  plugin: SimpleSyncPlugin;
  manager: BackupManager;
  activeTab: Tab = 'backup';

  description = '';
  includeSystem = true;

  backups: BackupEntry[] = [];
  loadingBackups = false;
  backupsError: string | null = null;

  private statsEl: HTMLElement | null = null;
  private statsLoading = false;

  constructor(app: App, plugin: SimpleSyncPlugin) {
    super(app);
    this.plugin = plugin;
    this.manager = plugin.backupManager;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('simple-sync-modal-marker');
    this.plugin.i18n.applyDirection(contentEl);
    this.render();
  }

  private render() {
    const t = (k: string, v?: any) => this.plugin.i18n.t(k, v);
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createEl('div', { cls: 'simple-sync-header' });
    header.createEl('h2', { text: t('modal.title') });
    header.createEl('p', { text: t('modal.subtitle'), cls: 'simple-sync-subtitle' });

    const tabs = contentEl.createEl('div', { cls: 'simple-sync-tabs' });
    this.tab(tabs, 'backup', t('modal.tab.backup'));
    this.tab(tabs, 'restore', t('modal.tab.restore'));
    this.tab(tabs, 'about', t('modal.tab.about'));

    const body = contentEl.createEl('div', { cls: 'simple-sync-body' });

    if (this.activeTab === 'backup') this.renderBackupTab(body);
    else if (this.activeTab === 'restore') this.renderRestoreTab(body);
    else this.renderAboutTab(body);
  }

  private tab(parent: HTMLElement, id: Tab, label: string) {
    const btn = parent.createEl('button', {
      text: label,
      cls: `simple-sync-tab ${this.activeTab === id ? 'is-active' : ''}`,
    });
    btn.onclick = () => {
      this.activeTab = id;
      if (id === 'restore' && this.backups.length === 0 && !this.loadingBackups) {
        this.loadBackups();
      } else {
        this.render();
      }
    };
  }

  // ============================================================
  // Backup tab
  // ============================================================

  private renderBackupTab(parent: HTMLElement) {
    const t = (k: string, v?: any) => this.plugin.i18n.t(k, v);

    const section = parent.createEl('div', { cls: 'simple-sync-section' });
    section.createEl('h3', { text: t('backup.title') });
    section.createEl('p', { text: t('backup.desc'), cls: 'simple-sync-section-desc' });

    new Setting(parent)
      .setName(t('backup.descriptionLabel'))
      .addTextArea((ta) => {
        ta.inputEl.rows = 3;
        ta.inputEl.addClass('simple-sync-textarea');
        ta.setPlaceholder(t('backup.descriptionPlaceholder'));
        ta.setValue(this.description);
        ta.onChange((v) => { this.description = v; });
      });

    new Setting(parent)
      .setName(t('backup.includeSystem'))
      .addToggle((tg) =>
        tg.setValue(this.includeSystem).onChange((v) => {
          this.includeSystem = v;
          this.refreshStats();
        })
      );

    this.statsEl = parent.createEl('div', { cls: 'simple-sync-stats-line' });
    this.statsEl.setText(t('backup.stats', { count: '…', size: '…' }));
    this.refreshStats();

    const footer = parent.createEl('div', { cls: 'simple-sync-modal-footer' });
    const btn = footer.createEl('button', {
      text: t('backup.button'),
      cls: 'mod-cta simple-sync-btn-lg',
    });
    btn.onclick = () => this.doBackup();
  }

  private async refreshStats() {
    if (this.statsLoading || !this.statsEl) return;
    this.statsLoading = true;

    const t = (k: string, v?: any) => this.plugin.i18n.t(k, v);
    const el = this.statsEl;
    el.setText(t('backup.stats', { count: '…', size: '…' }));

    try {
      const { count, size } = await this.manager.countFilesAndSize(this.includeSystem);
      // Guard: user may have toggled again
      if (el === this.statsEl) {
        el.setText(t('backup.stats', { count, size: BackupManager.formatBytes(size) }));
      }
    } catch {
      if (el === this.statsEl) el.setText('');
    } finally {
      this.statsLoading = false;
    }
  }

  private async doBackup() {
    const t = (k: string, v?: any) => this.plugin.i18n.t(k, v);

    if (!this.plugin.settings.token || !this.plugin.settings.repo) {
      new Notice(t('error.noRepo'), 5000);
      return;
    }

    const ok = await askConfirmation(this.app, {
      title: t('backup.button'),
      message: this.description || t('backup.descriptionPlaceholder'),
      confirmText: t('action.confirm'),
      cancelText: t('action.cancel'),
    });
    if (!ok) return;

    const progress = new ProgressModal(this.app, this.plugin);
    progress.open();

    try {
      const result = await this.manager.createBackup(
        this.description,
        this.includeSystem,
        (step, pct) => progress.update(step, pct)
      );
      progress.finish();
      this.description = '';
      if (this.plugin.settings.showNotifications) {
        new Notice(
          `${t('backup.finished')}\n${result.fileCount} files · ${BackupManager.formatBytes(result.size)}`,
          6000
        );
      }
      this.plugin.updateStatusBar('ok');
      this.render();
    } catch (e: any) {
      progress.close();
      new Notice(t('backup.failed', { error: e.message }), 8000);
      this.plugin.updateStatusBar('error');
    }
  }

  // ============================================================
  // Restore tab
  // ============================================================

  private renderRestoreTab(parent: HTMLElement) {
    const t = (k: string, v?: any) => this.plugin.i18n.t(k, v);

    const section = parent.createEl('div', { cls: 'simple-sync-section' });
    section.createEl('h3', { text: t('restore.title') });
    section.createEl('p', { text: t('restore.desc'), cls: 'simple-sync-section-desc' });

    if (this.loadingBackups) {
      parent.createEl('p', { text: t('restore.loading'), cls: 'simple-sync-loading' });
      return;
    }

    if (this.backupsError) {
      parent.createEl('div', {
        cls: 'mod-warning simple-sync-error',
        text: t('restore.failed', { error: this.backupsError }),
      });
    }

    if (this.backups.length === 0) {
      parent.createEl('div', { cls: 'simple-sync-empty', text: t('restore.empty') });
    } else {
      const list = parent.createEl('div', { cls: 'simple-sync-list' });
      for (const entry of this.backups) this.renderBackupEntry(list, entry);
    }

    const footer = parent.createEl('div', { cls: 'simple-sync-modal-footer' });
    const refresh = footer.createEl('button', { text: t('action.refresh'), cls: 'simple-sync-btn-lg' });
    refresh.onclick = () => this.loadBackups();
  }

  private renderBackupEntry(parent: HTMLElement, entry: BackupEntry) {
    const t = (k: string, v?: any) => this.plugin.i18n.t(k, v);

    const item = parent.createEl('div', { cls: 'simple-sync-list-item' });

    const info = item.createEl('div', { cls: 'simple-sync-list-info' });
    info.createEl('div', { text: entry.date, cls: 'simple-sync-list-title' });
    info.createEl('div', {
      text: entry.description || t('restore.noDescription'),
      cls: 'simple-sync-list-desc',
    });
    info.createEl('div', {
      text: BackupManager.formatBytes(entry.size),
      cls: 'simple-sync-list-meta',
    });

    const actions = item.createEl('div', { cls: 'simple-sync-list-actions' });
    const restoreBtn = actions.createEl('button', {
      text: t('restore.button'),
      cls: 'mod-cta simple-sync-restore-btn',
    });
    restoreBtn.onclick = () => this.doRestore(entry);
  }

  private async loadBackups() {
    this.loadingBackups = true;
    this.backupsError = null;
    this.render();
    try {
      this.backups = await this.manager.listBackups();
    } catch (e: any) {
      this.backupsError = e.message;
    }
    this.loadingBackups = false;
    this.render();
  }

  private async doRestore(entry: BackupEntry) {
    const t = (k: string, v?: any) => this.plugin.i18n.t(k, v);

    const ok = await askConfirmation(this.app, {
      title: t('restore.confirmTitle'),
      message: t('restore.confirmMessage'),
      confirmText: t('action.confirm'),
      cancelText: t('action.cancel'),
      isDangerous: true,
    });
    if (!ok) return;

    const progress = new ProgressModal(this.app, this.plugin);
    progress.open();

    try {
      const count = await this.manager.restoreBackup(entry, (step, pct) => {
        progress.update(step, pct);
      });
      progress.finish();
      if (this.plugin.settings.showNotifications) {
        new Notice(t('restore.finished', { count }), 6000);
      }
      this.plugin.updateStatusBar('ok');
    } catch (e: any) {
      progress.close();
      new Notice(t('restore.failed', { error: e.message }), 8000);
      this.plugin.updateStatusBar('error');
    }
  }

  // ============================================================
  // About tab
  // ============================================================

  private renderAboutTab(parent: HTMLElement) {
    const t = (k: string, v?: any) => this.plugin.i18n.t(k, v);

    const section = parent.createEl('div', { cls: 'simple-sync-section' });
    section.createEl('h3', { text: t('about.title') });
    section.createEl('p', { text: t('about.text') });

    section.createEl('h4', { text: t('about.safety') });
    const pre = section.createEl('pre', { cls: 'simple-sync-pre' });
    pre.setText(t('about.safety.text'));

    const footer = parent.createEl('div', { cls: 'simple-sync-modal-footer' });
    const guide = footer.createEl('button', { text: t('action.guide'), cls: 'simple-sync-btn-lg' });
    guide.onclick = () => {
      this.close();
      this.plugin.openGuide();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
