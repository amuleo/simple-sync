import { Plugin, Notice } from 'obsidian';
import { SimpleSyncSettings, DEFAULT_SETTINGS, SimpleSyncSettingTab } from './settings';
import { I18n, Lang } from './i18n';
import { GitHubAPI } from './github-api';
import { BackupManager } from './backup-manager';
import { BackupModal } from './backup-modal';
import { GuideModal } from './guide-modal';
import { askConfirmation } from './confirm-modal';
import { ProgressModal } from './progress-modal';

export default class SimpleSyncPlugin extends Plugin {
  settings: SimpleSyncSettings;
  i18n: I18n;
  github: GitHubAPI;
  backupManager: BackupManager;

  private statusBarEl: HTMLElement | null = null;
  private operationLock = false;
  private recentLogs: string[] = [];

  async onload() {
    await this.loadSettings();

    this.i18n = new I18n(this.settings.language);
    this.github = new GitHubAPI(this.settings);
    this.backupManager = new BackupManager(this.app.vault, this.github, this.settings);

    this.addSettingTab(new SimpleSyncSettingTab(this.app, this));

    this.addCommand({
      id: 'simple-sync-open',
      name: this.i18n.t('cmd.open'),
      callback: () => this.openMain(),
    });

    this.addCommand({
      id: 'simple-sync-quick-backup',
      name: this.i18n.t('cmd.quickBackup'),
      callback: () => this.quickBackup(),
    });

    this.addCommand({
      id: 'simple-sync-guide',
      name: this.i18n.t('cmd.guide'),
      callback: () => this.openGuide(),
    });

    this.updateStatusBar();
    console.log('[Simple SYNC] loaded');
  }

  onunload() {
    console.log('[Simple SYNC] unloaded');
  }

  // ============ Public ============

  openMain(): void {
    new BackupModal(this.app, this).open();
  }

  openGuide(): void {
    new GuideModal(this.app, this).open();
  }

  async quickBackup(): Promise<void> {
    if (this.operationLock) {
      new Notice(this.i18n.t('error.locked'));
      return;
    }
    if (!this.settings.token || !this.settings.repo) {
      new Notice(this.i18n.t('error.noRepo'), 5000);
      return;
    }

    const desc = 'Quick backup';
    const ok = await askConfirmation(this.app, {
      title: this.i18n.t('cmd.quickBackup'),
      message: desc,
      confirmText: this.i18n.t('action.confirm'),
      cancelText: this.i18n.t('action.cancel'),
    });
    if (!ok) return;

    this.operationLock = true;
    const progress = new ProgressModal(this.app, this);
    progress.open();

    try {
      const result = await this.backupManager.createBackup(desc, (step, pct) => {
        progress.update(step, pct);
      });
      progress.finish();
      if (this.settings.showNotifications) {
        new Notice(
          `${this.i18n.t('backup.finished')}\n${result.fileCount} files`,
          6000
        );
      }
      this.updateStatusBar('ok');
    } catch (e: any) {
      progress.close();
      new Notice(this.i18n.t('backup.failed', { error: e.message }), 8000);
      this.updateStatusBar('error');
    } finally {
      this.operationLock = false;
    }
  }

  // ============ Status Bar ============

  updateStatusBar(state: 'idle' | 'busy' | 'ok' | 'error' = 'idle'): void {
    if (!this.settings.showStatusBar) {
      if (this.statusBarEl) {
        this.statusBarEl.remove();
        this.statusBarEl = null;
      }
      return;
    }
    if (!this.statusBarEl) {
      this.statusBarEl = this.addStatusBarItem();
      this.statusBarEl.addClass('simple-sync-status-bar');
      this.statusBarEl.onClickEvent(() => this.openMain());
    }
    this.statusBarEl.setText(this.i18n.t(`status.${state}`));
    if (state === 'ok' || state === 'error') {
      window.setTimeout(() => {
        if (this.statusBarEl) this.statusBarEl.setText(this.i18n.t('status.idle'));
      }, 3000);
    }
  }

  // ============ Log ============

  log(message: string): void {
    const ts = new Date().toLocaleTimeString();
    this.recentLogs.push(`[${ts}] ${message}`);
    if (this.recentLogs.length > 100) this.recentLogs.shift();
    console.log('[Simple SYNC]', message);
  }

  // ============ Settings ============

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.github?.updateSettings(this.settings);
    this.backupManager?.updateSettings(this.settings);
    this.i18n?.setLang(this.settings.language);
  }
}
