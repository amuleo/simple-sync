import { App, Modal } from 'obsidian';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
}

export class ConfirmModal extends Modal {
  private options: ConfirmOptions;
  private resolver: (v: boolean) => void;

  constructor(app: App, options: ConfirmOptions, resolver: (v: boolean) => void) {
    super(app);
    this.options = options;
    this.resolver = resolver;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass('simple-sync-modal');
    contentEl.addClass('simple-sync-confirm');

    // Native title
    this.titleEl.setText(this.options.title);

    // Back button
    const backBtn = this.titleEl.createEl('button', {
      cls: 'simple-sync-back-btn',
      text: '‹',
      attr: { 'aria-label': 'Back' },
    });
    backBtn.onclick = () => {
      this.resolver(false);
      this.close();
    };
    this.titleEl.appendChild(
      this.titleEl.createEl('span', {
        text: this.options.title,
        cls: 'simple-sync-title-text',
      })
    );

    const msg = contentEl.createEl('div', { cls: 'simple-sync-confirm-message' });
    for (const line of this.options.message.split('\n')) {
      msg.createEl('p', { text: line });
    }

    const buttons = contentEl.createEl('div', {
      cls: 'simple-sync-confirm-buttons',
    });

    const cancel = buttons.createEl('button', {
      text: this.options.cancelText || 'Cancel',
    });
    cancel.onclick = () => {
      this.resolver(false);
      this.close();
    };

    const ok = buttons.createEl('button', {
      text: this.options.confirmText || 'OK',
      cls: this.options.isDangerous ? 'mod-warning' : 'mod-cta',
    });
    ok.onclick = () => {
      this.resolver(true);
      this.close();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

export function askConfirmation(
  app: App,
  options: ConfirmOptions
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(app, options, resolve).open();
  });
}
