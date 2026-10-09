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
    this.includeSystem = true;
  }

  onOpen() {
    const t = (k: string, v?: any) => this.plugin.i18n.t(k, v);
    const { contentEl } = this;
    contentEl.addClass('simple-sync-confirm');
    contentEl.addClass('simple-sync-modal-marker');
    this.plugin.i18n.applyDirection(contentEl);

    contentEl.createEl('h3', { text: t('restore.confirmTitle') });
    contentEl.createEl('p', {
      text: t('restore.confirmMessage'),
      cls: 'simple-sync-confirm-message',
    });

    // Info about the backup
    const info = contentEl.createEl('div', { cls: 'simple-sync-info-box' });
    const row1 = info.createEl('div', { cls: 'simple-sync-info-row' });
    row1.createEl('span', { text: this.entry.date, cls: 'simple-sync-list-title' });
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

    // System files toggle — only if backup contains them
    if (this.entry.hasSystemFiles) {
      new Setting(contentEl)
        .setName(t('restore.includeSystem'))
        .setDesc(t('restore.includeSystem.desc'))
        .addToggle((tg) =>
          tg.setValue(this.includeSystem).onChange((v) => {
            this.includeSystem = v;
          })
        );
    }

    // Buttons
    const buttons = contentEl.createEl('div', { cls: 'simple-sync-confirm-buttons' });

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
        includeSystem: this.entry.hasSystemFiles ? this.includeSystem : true,
      });
      this.close();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}
