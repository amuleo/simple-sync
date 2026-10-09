import { App, Modal } from 'obsidian';
import SimpleSyncPlugin from './main';

export class ProgressModal extends Modal {
  plugin: SimpleSyncPlugin;
  private stepLabel: string = '';
  private percent: number = 0;
  private barEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private stepEl: HTMLElement | null = null;
  private allowClose = false;

  constructor(app: App, plugin: SimpleSyncPlugin) {
    super(app);
    this.plugin = plugin;
    this.allowClose = false;
  }

  onOpen() {
    const { contentEl } = this;
    this.plugin.i18n.applyDirection(contentEl);
    this.modalEl.addClass('simple-sync-progress-modal');

    // Block clicking outside
    this.scope.register([], 'Escape', () => {});

    contentEl.createEl('h3', {
      text: this.plugin.i18n.t('progress.title'),
      cls: 'simple-sync-progress-title',
    });

    // Step label
    this.stepEl = contentEl.createEl('div', {
      text: '',
      cls: 'simple-sync-progress-step',
    });

    // Bar
    const barWrap = contentEl.createEl('div', { cls: 'simple-sync-progress-bar' });
    this.barEl = barWrap.createEl('div', { cls: 'simple-sync-progress-fill' });
    this.barEl.style.width = '0%';

    // Percent
    this.labelEl = contentEl.createEl('div', {
      text: this.plugin.i18n.t('progress.percent', { percent: 0 }),
      cls: 'simple-sync-progress-percent',
    });
  }

  update(step: string, percent: number) {
    this.stepLabel = step;
    this.percent = Math.max(0, Math.min(100, Math.round(percent)));

    if (this.stepEl) this.stepEl.setText(this.plugin.i18n.t(`progress.step.${step}`) || step);
    if (this.barEl) this.barEl.style.width = `${this.percent}%`;
    if (this.labelEl) this.labelEl.setText(this.plugin.i18n.t('progress.percent', { percent: this.percent }));
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
