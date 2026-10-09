import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import SimpleSyncPlugin from './main';
import { suggestObsidianRepos, SuggestedRepo } from './repo-suggester';
import { Lang } from './i18n';

export interface SimpleSyncSettings {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  backupFolder: string;
  localFolder: string;
  language: Lang;
  showNotifications: boolean;
  showStatusBar: boolean;
}

export const DEFAULT_SETTINGS: SimpleSyncSettings = {
  token: '',
  owner: '',
  repo: '',
  branch: 'main',
  backupFolder: 'backups',
  localFolder: '.backup',
  language: 'en',
  showNotifications: true,
  showStatusBar: true,
};

export class SimpleSyncSettingTab extends PluginSettingTab {
  plugin: SimpleSyncPlugin;
  private userRepos: any[] = [];
  private suggestions: SuggestedRepo[] = [];
  private connState: 'idle' | 'ok' | 'fail' = 'idle';
  private connUser = '';
  private connError = '';

  constructor(app: App, plugin: SimpleSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const t = (k: string, v?: any) => this.plugin.i18n.t(k, v);
    const { containerEl } = this;
    containerEl.empty();
    this.plugin.i18n.applyDirection(containerEl);

    containerEl.createEl('h2', { text: t('settings.title') });

    new Setting(containerEl)
      .setName(t('settings.actions'))
      .setDesc(t('settings.actions.desc'))
      .addButton((b) =>
        b.setButtonText(t('action.open')).setCta().onClick(() => this.plugin.openMain())
      )
      .addButton((b) =>
        b.setButtonText(t('action.guide')).onClick(() => this.plugin.openGuide())
      );

    new Setting(containerEl).setName(t('section.appearance')).setHeading();

    new Setting(containerEl)
      .setName(t('settings.language'))
      .setDesc(t('settings.language.desc'))
      .addDropdown((dd) => {
        dd.addOption('en', t('settings.lang.en'));
        dd.addOption('fa', t('settings.lang.fa'));
        dd.setValue(this.plugin.settings.language);
        dd.onChange(async (v) => {
          this.plugin.settings.language = v as Lang;
          this.plugin.i18n.setLang(v as Lang);
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(t('settings.notifications'))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.showNotifications).onChange(async (v) => {
          this.plugin.settings.showNotifications = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t('settings.showStatusBar'))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.showStatusBar).onChange(async (v) => {
          this.plugin.settings.showStatusBar = v;
          await this.plugin.saveSettings();
          this.plugin.updateStatusBar();
        })
      );

    new Setting(containerEl).setName(t('section.auth')).setHeading();

    new Setting(containerEl)
      .setName(t('settings.token'))
      .setDesc(t('settings.token.desc'))
      .addText((tx) => {
        tx.inputEl.type = 'password';
        tx.setPlaceholder('github_pat_...')
          .setValue(this.plugin.settings.token)
          .onChange(async (v) => {
            this.plugin.settings.token = v.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t('settings.connection'))
      .setDesc(this.getConnText())
      .addButton((b) =>
        b.setButtonText(t('action.test')).onClick(async () => {
          b.setButtonText(t('action.test.testing')).setDisabled(true);
          try {
            const user = await this.plugin.github.getCurrentUser();
            this.connState = 'ok';
            this.connUser = user.login;
            this.plugin.settings.owner = user.login;
            await this.plugin.saveSettings();
            this.userRepos = await this.plugin.github.listRepos();
            this.suggestions = suggestObsidianRepos(this.userRepos);
            new Notice(t('settings.connection.ok', { user: user.login }));
          } catch (e: any) {
            this.connState = 'fail';
            this.connError = e.message;
            new Notice(t('settings.connection.fail', { error: e.message }));
          }
          b.setButtonText(t('action.test')).setDisabled(false);
          this.display();
        })
      );

    new Setting(containerEl).setName(t('section.repo')).setHeading();

    if (this.suggestions.length > 0) {
      new Setting(containerEl)
        .setName(t('settings.suggested'))
        .setDesc(t('settings.suggested.desc'))
        .addDropdown((dd) => {
          dd.addOption('', t('settings.suggested.select'));
          this.suggestions.forEach((s) => {
            dd.addOption(s.name, `${s.name} ${s.isPrivate ? '🔒' : '🌐'}`);
          });
          dd.setValue('');
          dd.onChange(async (v) => {
            if (v) {
              this.plugin.settings.repo = v;
              await this.plugin.saveSettings();
              this.display();
            }
          });
        });
    }

    if (this.userRepos.length > 0) {
      new Setting(containerEl).setName(t('settings.allRepos')).addDropdown((dd) => {
        dd.addOption('', t('settings.suggested.select'));
        this.userRepos.forEach((r) => {
          dd.addOption(r.name, `${r.name} ${r.private ? '🔒' : '🌐'}`);
        });
        dd.setValue(this.plugin.settings.repo || '');
        dd.onChange(async (v) => {
          if (v) { this.plugin.settings.repo = v; await this.plugin.saveSettings(); }
        });
      });
    }

    new Setting(containerEl)
      .setName(t('settings.repo'))
      .addText((tx) =>
        tx.setValue(this.plugin.settings.repo).onChange(async (v) => {
          this.plugin.settings.repo = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t('settings.branch'))
      .addText((tx) =>
        tx.setValue(this.plugin.settings.branch).onChange(async (v) => {
          this.plugin.settings.branch = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName(t('section.behavior')).setHeading();

    new Setting(containerEl)
      .setName(t('settings.backupFolder'))
      .setDesc(t('settings.backupFolder.desc'))
      .addText((tx) =>
        tx.setValue(this.plugin.settings.backupFolder).onChange(async (v) => {
          this.plugin.settings.backupFolder = v.trim() || 'backups';
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t('settings.localFolder'))
      .setDesc(t('settings.localFolder.desc'))
      .addText((tx) => {
        tx.inputEl.disabled = true;
        tx.setValue(this.plugin.settings.localFolder);
      });
  }

  private getConnText(): string {
    const t = (k: string, v?: any) => this.plugin.i18n.t(k, v);
    if (this.connState === 'ok') return t('settings.connection.ok', { user: this.connUser });
    if (this.connState === 'fail') return t('settings.connection.fail', { error: this.connError });
    return t('settings.connection.idle');
  }
}
