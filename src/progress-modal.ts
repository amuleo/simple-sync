import { App, Modal } from 'obsidian';
import SimpleSyncPlugin from './main';

export class ProgressModal extends Modal {
  plugin: SimpleSyncPlugin;
  private percent = 0;
  private barEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private stepEl: HTMLElement | null = null;
  private allowClose = false;

  constructor(app: App, plugin: SimpleSyncPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass('simple-sync-modal');
    this.modalEl.addClass('simple-sync-progress-modal');
    this.plugin.i18n.applyDirection(this.modalEl);

    this.titleEl.setText(this.plugin.i18n.t('progress.title'));

    // Prevent ESC-close during operation
    this.scope.register([], 'Escape', (e) => {
      if (!this.allowClose) e.preventDefault?.();
    });

    this.stepEl = contentEl.createEl('div', {
      text: '',
      cls: 'simple-sync-progress-step',
    });

    const barWrap = contentEl.createEl('div', { cls: 'simple-sync-progress-bar' });
    this.barEl = barWrap.createEl('div', { cls: 'simple-sync-progress-fill' });
    this.barEl.style.width = '0%';

    this.labelEl = contentEl.createEl('div', {
      text: this.plugin.i18n.t('progress.percent', { percent: 0 }),
      cls: 'simple-sync-progress-percent',
    });
  }

  update(step: string, percent: number) {
    this.percent = Math.max(0, Math.min(100, Math.round(percent)));
    if (this.stepEl) {
      this.stepEl.setText(this.plugin.i18n.t(`progress.step.${step}`) || step);
    }
    if (this.barEl) this.barEl.style.width = `${this.percent}%`;
    if (this.labelEl) {
      this.labelEl.setText(
        this.plugin.i18n.t('progress.percent', { percent: this.percent })
      );
    }
  }

  finish() {
    this.allowClose = true;
    this.update('done', 100);
    window.setTimeout(() => this.close(), 400);
  }

  onClose() {
    this.contentEl.empty();
  }
}
