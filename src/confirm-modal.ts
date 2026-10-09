import { App, Modal, Setting } from 'obsidian';
import SimpleSyncPlugin from './main';
import { BackupEntry, BackupManager } from './backup-manager';

export interface RestoreDecision {
  confirmed: boolean;
  includeSystem: boolean;
}

export class RestoreConfirmModal extends Modal {
  plugin: SimpleSyncPlugin;
  entry: BackupEntry;
  resolver: (decision: RestoreDecision) => void;
  includeSystem: boolean;

  constructor(
    app: App,
    plugin: SimpleSyncPlugin,
    entry: BackupEntry,
    resolver: (d: RestoreDecision) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.entry = entry;
    this.resolver = resolver;
    // Default on only if we are sure the backup has system files
    this.includeSystem = entry.hasSystemFiles === 'yes';
  }

  onOpen() {
    const t = (k: string, v?: any) => this.plugin.i18n.t(k, v);
    const { contentEl } = this;
    this.modalEl.addClass('simple-sync-modal');
    this.plugin.i18n.applyDirection(this.modalEl);
    contentEl.addClass('simple-sync-confirm');

    // Native title
    this.titleEl.setText(t('restore.confirmTitle'));

    // Back button in top-left
    const backBtn = this.titleEl.createEl('button', {
      cls: 'simple-sync-back-btn',
      text: '‹',
      attr: { 'aria-label': t('action.back') },
    });
    backBtn.onclick = () => {
      this.resolver({ confirmed: false, includeSystem: false });
      this.close();
    };
    // Move title text after back button
    this.titleEl.appendChild(
      this.titleEl.createEl('span', {
        text: t('restore.confirmTitle'),
        cls: 'simple-sync-title-text',
      })
    );

    contentEl.createEl('p', {
      text: t('restore.confirmMessage'),
      cls: 'simple-sync-confirm-message',
    });

    // Backup info
    const info = contentEl.createEl('div', { cls: 'simple-sync-info-box' });
    info.createEl('div', {
      text: this.entry.date,
      cls: 'simple-sync-list-title',
    });
    if (this.entry.description) {
      info.createEl('div', {
        text: this.entry.description,
        cls: 'simple-sync-list-desc',
      });
    }
    info.createEl('div', {
      text: BackupManager.formatBytes(this.entry.size),
      cls: 'simple-sync-list-meta',
    });

    // ---- System files toggle — ALWAYS shown ----
    const status = this.entry.hasSystemFiles || 'unknown';
    let descText = '';
    let disabled = false;

    if (status === 'yes') {
      descText = t('restore.includeSystem.desc');
      // default on
    } else if (status === 'no') {
      descText = t('restore.includeSystem.none');
      disabled = true;
      this.includeSystem = false;
    } else {
      descText = t('restore.includeSystem.unknown');
      // default off, but user can enable
    }

    const setting = new Setting(contentEl)
      .setName(t('restore.includeSystem'))
      .setDesc(descText)
      .addToggle((tg) => {
        tg.setValue(this.includeSystem).onChange((v) => {
          this.includeSystem = v;
        });
        if (disabled) tg.setDisabled(true);
      });

    if (disabled) setting.settingEl.addClass('simple-sync-toggle-disabled');

    // Buttons
    const buttons = contentEl.createEl('div', {
      cls: 'simple-sync-confirm-buttons',
    });

    const cancel = buttons.createEl('button', { text: t('action.cancel') });
    cancel.onclick = () => {
      this.resolver({ confirmed: false, includeSystem: false });
      this.close();
    };

    const ok = buttons.createEl('button', {
      text: t('action.confirm'),
      cls: 'mod-warning',
    });
    ok.onclick = () => {
      this.resolver({
        confirmed: true,
        includeSystem: this.includeSystem,
      });
      this.close();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
