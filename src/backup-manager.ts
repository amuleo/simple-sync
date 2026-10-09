import { Vault, TFile, normalizePath } from 'obsidian';
import JSZip from 'jszip';
import { GitHubAPI } from './github-api';
import { SimpleSyncSettings } from './settings';
import { formatJalaliPath, jalaliTimestampSuffix, formatJalaliReadable } from './jalali';

const LOCAL_BACKUP_FOLDER = '.backup';
const SNAPSHOT_PREFIX = 'snapshot';

export type ProgressStep = 'scanning' | 'creating' | 'uploading' | 'snapshotting' | 'downloading' | 'extracting' | 'localCopy';
export type ProgressCallback = (step: ProgressStep, percent: number) => void;

export interface BackupEntry {
  folder: string;
  date: string;
  description: string;
  zipPath: string;
  readmePath: string;
  size: number;
}

export interface BackupResult {
  folder: string;
  localPath: string;
  fileCount: number;
  size: number;
}

export class BackupManager {
  constructor(
    private vault: Vault,
    private github: GitHubAPI,
    private settings: SimpleSyncSettings
  ) {}

  updateSettings(s: SimpleSyncSettings) {
    this.settings = s;
  }

  // ============================================================
  // Backup
  // ============================================================

  async createBackup(description: string, onProgress: ProgressCallback): Promise<BackupResult> {
    const exclude = this.getExcludePatterns();

    // 1. Scan
    onProgress('scanning', 3);
    const files = this.collectFiles(exclude);
    if (files.length === 0) throw new Error('No files to back up');

    // 2. Build ZIP
    onProgress('creating', 10);
    const zip = new JSZip();
    let totalBytes = 0;
    let processed = 0;

    for (const file of files) {
      try {
        const content = await this.vault.readBinary(file);
        zip.file(file.path, content);
        totalBytes += content.byteLength;
      } catch (e) {
        console.warn('[Simple SYNC] read failed:', file.path, e);
      }
      processed++;
      if (processed % 15 === 0 || processed === files.length) {
        onProgress('creating', 10 + Math.floor((processed / files.length) * 40));
      }
    }

    onProgress('creating', 52);
    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // 3. Folder name (Jalali date with collision-safe suffix)
    const now = new Date();
    const datePath = formatJalaliPath(now);
    const baseFolder = `${this.settings.backupFolder}/${datePath}`;
    let folder = baseFolder;
    let attempts = 0;
    while (await this.folderExists(folder)) {
      attempts++;
      folder = `${baseFolder}-${jalaliTimestampSuffix(now)}${attempts > 1 ? '-' + attempts : ''}`;
      if (attempts > 50) break;
    }

    // 4. README
    const readme = this.buildReadme(description, now, files.length, totalBytes);
    const readmeBytes = new TextEncoder().encode(readme);

    // 5. Upload
    onProgress('uploading', 58);
    const zipBytes = await blob.arrayBuffer();
    await this.github.commitFiles(
      [
        { path: `${folder}/backup.zip`, content: zipBytes },
        { path: `${folder}/README.md`, content: readmeBytes.buffer },
      ],
      `Backup ${datePath} — ${description || 'no description'}`
    );

    onProgress('uploading', 88);

    // 6. Local mirror
    onProgress('localCopy', 92);
    const localPath = await this.saveLocalMirror(folder, blob, readme);

    onProgress('localCopy', 100);

    return { folder, localPath, fileCount: files.length, size: totalBytes };
  }

  // ============================================================
  // Restore
  // ============================================================

  async listBackups(): Promise<BackupEntry[]> {
    const files = await this.github.listFolderFiles(this.settings.backupFolder);

    const folders = new Map<string, { zip?: any; readme?: any }>();
    for (const f of files) {
      const parts = f.path.split('/');
      if (parts.length < 2) continue;
      const folderName = parts.slice(0, -1).join('/');
      const fileName = parts[parts.length - 1];
      const entry = folders.get(folderName) || {};
      if (fileName === 'backup.zip') entry.zip = f;
      if (fileName === 'README.md') entry.readme = f;
      folders.set(folderName, entry);
    }

    const result: BackupEntry[] = [];
    for (const [folderPath, entry] of folders) {
      if (!entry.zip) continue;
      let description = '';
      try {
        if (entry.readme) {
          const text = await this.github.getFileText(entry.readme.path);
          description = this.extractDescription(text || '');
        }
      } catch {}

      result.push({
        folder: folderPath,
        date: folderPath.split('/').pop() || folderPath,
        description,
        zipPath: entry.zip.path,
        readmePath: entry.readme?.path || '',
        size: entry.zip.size,
      });
    }

    return result.sort((a, b) => b.date.localeCompare(a.date));
  }

  async restoreBackup(entry: BackupEntry, onProgress: ProgressCallback): Promise<number> {
    // 1. Snapshot current vault
    onProgress('snapshotting', 3);
    await this.snapshotCurrentVault(onProgress);

    // 2. Download
    onProgress('downloading', 28);
    const zipBuffer = await this.github.getFileContent(entry.zipPath);
    if (!zipBuffer) throw new Error('Could not download backup');

    // 3. Extract
    onProgress('extracting', 48);
    const zip = await JSZip.loadAsync(zipBuffer);
    const entries = Object.entries(zip.files).filter(([, e]: any) => !e.dir);

    let count = 0;
    for (let i = 0; i < entries.length; i++) {
      const [path, file] = entries[i] as any;
      try {
        const content = await file.async('arraybuffer');
        await this.writeToVault(path, content);
        count++;
      } catch (e) {
        console.warn('[Simple SYNC] restore failed:', path, e);
      }
      if (i % 15 === 0 || i === entries.length - 1) {
        onProgress('extracting', 48 + Math.floor((i / entries.length) * 50));
      }
    }

    onProgress('extracting', 100);
    return count;
  }

  async deleteBackup(entry: BackupEntry): Promise<void> {
    await this.github.deleteFolder(entry.folder, `Delete backup ${entry.date}`);
  }

  // ============================================================
  // Snapshot
  // ============================================================

  private async snapshotCurrentVault(onProgress: ProgressCallback): Promise<string> {
    const files = this.collectFiles(this.getExcludePatterns());
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const folder = `${LOCAL_BACKUP_FOLDER}/${SNAPSHOT_PREFIX}-${stamp}`;

    let count = 0;
    for (const file of files) {
      try {
        const content = await this.vault.readBinary(file);
        await this.writeToVault(`${folder}/${file.path}`, content);
        count++;
      } catch {}
      if (count % 15 === 0) {
        onProgress('snapshotting', 3 + Math.floor((count / files.length) * 22));
      }
    }
    onProgress('snapshotting', 25);
    return folder;
  }

  private async saveLocalMirror(folder: string, blob: Blob, readme: string): Promise<string> {
    const parts = folder.split('/');
    const dateFolder = parts.slice(-1)[0] || 'backup';
    const localDir = `${LOCAL_BACKUP_FOLDER}/${dateFolder}`;

    const zipBuffer = await blob.arrayBuffer();
    await this.writeToVault(`${localDir}/backup.zip`, zipBuffer);

    const readmeBytes = new TextEncoder().encode(readme);
    await this.writeToVault(`${localDir}/README.md`, readmeBytes.buffer);

    return localDir;
  }

  // ============================================================
  // Helpers
  // ============================================================

  private getExcludePatterns(): string[] {
    const patterns = [LOCAL_BACKUP_FOLDER];
    if (this.settings.excludePatterns) {
      for (const line of this.settings.excludePatterns.split('\n')) {
        const p = line.trim();
        if (p && !p.startsWith('#')) patterns.push(p.replace(/\/$/, ''));
      }
    }
    return patterns;
  }

  private collectFiles(exclude: string[]): TFile[] {
    const out: TFile[] = [];
    for (const file of this.vault.getFiles()) {
      if (this.isExcluded(file.path, exclude)) continue;
      out.push(file);
    }
    return out;
  }

  private isExcluded(path: string, patterns: string[]): boolean {
    for (const p of patterns) {
      if (path === p || path.startsWith(p + '/')) return true;
    }
    return false;
  }

  private async folderExists(folder: string): Promise<boolean> {
    try {
      const files = await this.github.listFolderFiles(folder);
      return files.some((f) => f.path.startsWith(folder + '/'));
    } catch {
      return false;
    }
  }

  private buildReadme(description: string, date: Date, fileCount: number, totalBytes: number): string {
    return [
      '# Simple SYNC Backup',
      '',
      `**Date:** ${formatJalaliReadable(date)}`,
      `**Files:** ${fileCount}`,
      `**Size:** ${this.formatBytes(totalBytes)}`,
      '',
      '## Description',
      '',
      description || '_(no description)_',
      '',
      '---',
      `Created by Simple SYNC at ${new Date().toISOString()}`,
    ].join('\n');
  }

  private extractDescription(readme: string): string {
    const match = readme.match(/## Description\s*\n+([\s\S]*?)(?:\n\n---|$)/);
    if (match) {
      const desc = match[1].trim();
      if (desc === '_(no description)_') return '';
      return desc;
    }
    return '';
  }

  private async writeToVault(path: string, content: ArrayBuffer): Promise<void> {
    const normalized = normalizePath(path);
    const existing = this.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) {
      await this.vault.modifyBinary(existing, content);
      return;
    }

    const parts = normalized.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.vault.getAbstractFileByPath(current)) {
        try { await this.vault.createFolder(current); } catch {}
      }
    }

    try {
      await this.vault.createBinary(normalized, content);
    } catch (e: any) {
      if (e.message?.includes('already exists')) {
        const f = this.vault.getAbstractFileByPath(normalized);
        if (f instanceof TFile) await this.vault.modifyBinary(f, content);
      } else {
        throw e;
      }
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  static formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
}
