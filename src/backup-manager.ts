import { Vault, normalizePath } from 'obsidian';
import JSZip from 'jszip';
import { GitHubAPI } from './github-api';
import { SimpleSyncSettings } from './settings';
import { toJalali, formatJalaliPath, formatJalaliReadable } from './jalali';

const LOCAL_BACKUP_FOLDER = '.backup';
const SNAPSHOT_PREFIX = 'snapshot';
const SYSTEM_FOLDERS = ['.obsidian', '.trash', '.git'];

export type ProgressStep = 'scanning' | 'creating' | 'uploading' | 'snapshotting' | 'downloading' | 'extracting' | 'localCopy';
export type ProgressCallback = (step: ProgressStep, percent: number) => void;

export interface BackupEntry {
  folder: string;
  date: string;
  description: string;
  zipPath: string;
  readmePath: string;
  zipName: string;
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

  async createBackup(
    description: string,
    includeSystem: boolean,
    onProgress: ProgressCallback
  ): Promise<BackupResult> {
    onProgress('scanning', 3);

    // Walk the raw filesystem via the adapter so hidden folders
    // (.obsidian, .trash, .git, etc.) are included.
    const paths = await this.collectAllPaths(includeSystem);

    if (paths.length === 0) throw new Error('No files to back up');

    onProgress('creating', 10);
    const zip = new JSZip();
    let totalBytes = 0;
    let processed = 0;
    let succeeded = 0;

    for (const path of paths) {
      try {
        const content = await this.vault.adapter.readBinary(path);
        zip.file(path, content);
        totalBytes += content.byteLength;
        succeeded++;
      } catch (e) {
        console.warn('[Simple SYNC] read failed:', path, e);
      }
      processed++;
      if (processed % 15 === 0 || processed === paths.length) {
        onProgress('creating', 10 + Math.floor((processed / paths.length) * 40));
      }
    }

    if (succeeded === 0) throw new Error('No files could be read');

    onProgress('creating', 52);
    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // Folder name
    const now = new Date();
    const datePath = formatJalaliPath(toJalali(now));
    const baseFolder = `${this.settings.backupFolder}/${datePath}`;
    let folder = baseFolder;
    if (await this.folderExists(folder)) {
      folder = `${baseFolder}-${this.randomSuffix()}`;
    }

    // ZIP filename based on folder name
    const folderName = folder.split('/').pop() || 'backup';
    const zipName = this.makeZipFileName(folderName);

    const readme = this.buildReadme(description, now, succeeded, totalBytes);
    const readmeBytes = new TextEncoder().encode(readme);

    onProgress('uploading', 58);
    const zipBytes = await blob.arrayBuffer();
    await this.github.commitFiles(
      [
        { path: `${folder}/${zipName}`, content: zipBytes },
        { path: `${folder}/README.md`, content: readmeBytes.buffer },
      ],
      `Backup ${datePath} — ${description || 'no description'}`
    );

    onProgress('uploading', 88);

    onProgress('localCopy', 92);
    const localPath = await this.saveLocalMirror(folder, zipName, blob, readme);

    onProgress('localCopy', 100);

    return { folder, localPath, fileCount: succeeded, size: totalBytes };
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
      if (fileName.endsWith('.zip')) entry.zip = f;
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

      const lastSegment = folderPath.split('/').pop() || folderPath;
      result.push({
        folder: folderPath,
        date: lastSegment,
        description,
        zipPath: entry.zip.path,
        readmePath: entry.readme?.path || '',
        zipName: entry.zip.path.split('/').pop() || 'backup.zip',
        size: entry.zip.size,
      });
    }

    return result.sort((a, b) => b.date.localeCompare(a.date));
  }

  async restoreBackup(entry: BackupEntry, onProgress: ProgressCallback): Promise<number> {
    onProgress('snapshotting', 3);
    await this.snapshotCurrentVault(onProgress);

    onProgress('downloading', 28);
    const zipBuffer = await this.github.getFileContent(entry.zipPath);
    if (!zipBuffer) throw new Error('Could not download backup');

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

  // ============================================================
  // Snapshot
  // ============================================================

  private async snapshotCurrentVault(onProgress: ProgressCallback): Promise<string> {
    const paths = await this.collectAllPaths(true);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const folder = `${LOCAL_BACKUP_FOLDER}/${SNAPSHOT_PREFIX}-${stamp}`;

    let count = 0;
    for (const path of paths) {
      try {
        const content = await this.vault.adapter.readBinary(path);
        await this.writeToVault(`${folder}/${path}`, content);
        count++;
      } catch {}
      if (count % 15 === 0 && paths.length > 0) {
        onProgress('snapshotting', 3 + Math.floor((count / paths.length) * 22));
      }
    }
    onProgress('snapshotting', 25);
    return folder;
  }

  private async saveLocalMirror(
    folder: string,
    zipName: string,
    blob: Blob,
    readme: string
  ): Promise<string> {
    const dateFolder = folder.split('/').pop() || 'backup';
    const localDir = `${LOCAL_BACKUP_FOLDER}/${dateFolder}`;

    const zipBuffer = await blob.arrayBuffer();
    await this.writeToVault(`${localDir}/${zipName}`, zipBuffer);

    const readmeBytes = new TextEncoder().encode(readme);
    await this.writeToVault(`${localDir}/README.md`, readmeBytes.buffer);

    return localDir;
  }

  // ============================================================
  // Path walking (adapter-based, includes hidden)
  // ============================================================

  private async collectAllPaths(includeSystem: boolean): Promise<string[]> {
    const out: string[] = [];

    const walk = async (folder: string): Promise<void> => {
      let listing;
      try {
        listing = await this.vault.adapter.list(folder);
      } catch {
        return;
      }

      for (const filePath of listing.files) {
        if (this.isInsideLocalBackup(filePath)) continue;
        if (!includeSystem && this.isSystemPath(filePath)) continue;
        out.push(filePath);
      }

      for (const subfolder of listing.folders) {
        if (this.isInsideLocalBackup(subfolder)) continue;
        await walk(subfolder);
      }
    };

    await walk('');
    return out;
  }

  private isInsideLocalBackup(path: string): boolean {
    return (
      path === LOCAL_BACKUP_FOLDER ||
      path.startsWith(LOCAL_BACKUP_FOLDER + '/')
    );
  }

  private isSystemPath(path: string): boolean {
    for (const folder of SYSTEM_FOLDERS) {
      if (path === folder || path.startsWith(folder + '/')) return true;
    }
    const segments = path.split('/');
    return segments.some((s) => s.startsWith('.') && s !== '.' && s !== '..');
  }

  private makeZipFileName(folderName: string): string {
    // "1405.01.15-641" → digits only → "14050115641"
    const digits = folderName.replace(/\D/g, '');
    if (!digits) return 'backup.zip';
    const prefix = (this.settings.backupFolder || 'backup').replace(/\W/g, '');
    return `${prefix || 'backup'}${digits}.zip`;
  }

  private randomSuffix(): string {
    return String(Math.floor(Math.random() * 900) + 100);
  }

  private async folderExists(folder: string): Promise<boolean> {
    try {
      const files = await this.github.listFolderFiles(folder);
      return files.some((f) => f.path.startsWith(folder + '/'));
    } catch {
      return false;
    }
  }

  // ============================================================
  // README / Description
  // ============================================================

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

  // ============================================================
  // Write to vault (adapter-based, works with hidden folders)
  // ============================================================

  private async writeToVault(path: string, content: ArrayBuffer): Promise<void> {
    const normalized = normalizePath(path);

    // Ensure parent folders exist
    const parts = normalized.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      try {
        const exists = await this.vault.adapter.exists(current);
        if (!exists) {
          await this.vault.adapter.mkdir(current);
        }
      } catch {
        // ignore
      }
    }

    try {
      await this.vault.adapter.writeBinary(normalized, content);
    } catch (e) {
      console.warn('[Simple SYNC] write failed:', normalized, e);
      throw e;
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
