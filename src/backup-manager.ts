import { Vault, normalizePath } from 'obsidian';
import JSZip from 'jszip';
import { GitHubAPI } from './github-api';
import { SimpleSyncSettings } from './settings';
import { toJalali, formatJalaliPath, formatJalaliReadable } from './jalali';

const LOCAL_BACKUP_FOLDER = '.backup';
const SNAPSHOT_PREFIX = 'snapshot';
const SYSTEM_FOLDERS = ['.obsidian', '.trash', '.git'];

const READ_CONCURRENCY = 12;
const WRITE_CONCURRENCY = 10;

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

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array(Math.min(limit, items.length))
    .fill(null)
    .map(async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) break;
        try {
          results[idx] = await fn(items[idx], idx);
        } catch {
          // leave undefined
        }
      }
    });
  await Promise.all(workers);
  return results;
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
  // Public: stats for the modal
  // ============================================================

  async countFilesAndSize(includeSystem: boolean): Promise<{ count: number; size: number }> {
    const paths = await this.collectAllPaths(includeSystem);
    let size = 0;
    await mapConcurrent(paths, READ_CONCURRENCY, async (p) => {
      try {
        const st = await this.vault.adapter.stat(p);
        if (st && st.size) size += st.size;
      } catch {}
      return null;
    });
    return { count: paths.length, size };
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
    const paths = await this.collectAllPaths(includeSystem);
    if (paths.length === 0) throw new Error('No files to back up');

    onProgress('creating', 8);
    const zip = new JSZip();

    let totalBytes = 0;
    let succeeded = 0;
    let processed = 0;

    // Parallel read + add to JSZip
    await mapConcurrent(paths, READ_CONCURRENCY, async (path) => {
      try {
        const content = await this.vault.adapter.readBinary(path);
        zip.file(path, content);
        totalBytes += content.byteLength;
        succeeded++;
      } catch (e) {
        console.warn('[Simple SYNC] read failed:', path, e);
      }
      processed++;
      if (processed % 20 === 0 || processed === paths.length) {
        const pct = 8 + Math.floor((processed / paths.length) * 42);
        onProgress('creating', pct);
      }
      return null;
    });

    if (succeeded === 0) throw new Error('No files could be read');

    onProgress('creating', 50);
    const blob = await zip.generateAsync(
      {
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 5 },
      },
      (meta) => {
        // meta.percent from 0-100 during zip generation
        onProgress('creating', 50 + Math.floor(meta.percent * 0.08));
      }
    );

    // Folder name
    const now = new Date();
    const datePath = formatJalaliPath(toJalali(now));
    const baseFolder = `${this.settings.backupFolder}/${datePath}`;
    let folder = baseFolder;
    if (await this.folderExists(folder)) {
      folder = `${baseFolder}-${this.randomSuffix()}`;
    }

    const folderName = folder.split('/').pop() || 'backup';
    const zipName = this.makeZipFileName(folderName);

    const readme = this.buildReadme(description, now, succeeded, totalBytes);
    const readmeBytes = new TextEncoder().encode(readme);

    onProgress('uploading', 60);
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

    // Parallelize README fetch
    const folderArr = Array.from(folders.entries()).filter(([, e]) => e.zip);
    const results = await mapConcurrent(folderArr, 6, async ([folderPath, entry]) => {
      let description = '';
      try {
        if (entry.readme) {
          const text = await this.github.getFileText(entry.readme.path);
          description = this.extractDescription(text || '');
        }
      } catch {}
      const lastSegment = folderPath.split('/').pop() || folderPath;
      const out: BackupEntry = {
        folder: folderPath,
        date: lastSegment,
        description,
        zipPath: entry.zip.path,
        readmePath: entry.readme?.path || '',
        zipName: entry.zip.path.split('/').pop() || 'backup.zip',
        size: entry.zip.size,
      };
      return out;
    });

    const result = results.filter(Boolean) as BackupEntry[];
    return result.sort((a, b) => b.date.localeCompare(a.date));
  }

  async restoreBackup(entry: BackupEntry, onProgress: ProgressCallback): Promise<number> {
    onProgress('snapshotting', 3);
    await this.snapshotCurrentVault(onProgress);

    onProgress('downloading', 25);
    const zipBuffer = await this.github.getFileContent(entry.zipPath);
    if (!zipBuffer) throw new Error('Could not download backup');

    onProgress('extracting', 45);
    const zip = await JSZip.loadAsync(zipBuffer);
    const entries = Object.entries(zip.files).filter(([, e]: any) => !e.dir) as [string, any][];

    // Pre-create all parent folders once (sequentially, deduped)
    const folderSet = new Set<string>();
    for (const [path] of entries) {
      const parts = path.split('/');
      parts.pop();
      let current = '';
      for (const p of parts) {
        current = current ? `${current}/${p}` : p;
        folderSet.add(current);
      }
    }
    const folderList = Array.from(folderSet).sort(
      (a, b) => a.split('/').length - b.split('/').length
    );
    for (const f of folderList) {
      try {
        const exists = await this.vault.adapter.exists(f);
        if (!exists) await this.vault.adapter.mkdir(f);
      } catch {}
    }

    // Parallel extraction + write
    let count = 0;
    let processed = 0;
    await mapConcurrent(entries, WRITE_CONCURRENCY, async ([path, file]) => {
      try {
        const content = await file.async('arraybuffer');
        await this.vault.adapter.writeBinary(normalizePath(path), content);
        count++;
      } catch (e) {
        console.warn('[Simple SYNC] restore failed:', path, e);
      }
      processed++;
      if (processed % 20 === 0 || processed === entries.length) {
        const pct = 45 + Math.floor((processed / entries.length) * 55);
        onProgress('extracting', pct);
      }
      return null;
    });

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

    // Pre-create folders
    const folderSet = new Set<string>();
    for (const path of paths) {
      const parts = path.split('/');
      parts.pop();
      let current = '';
      for (const p of parts) {
        current = current ? `${current}/${p}` : p;
        folderSet.add(`${folder}/${current}`);
      }
    }
    for (const f of Array.from(folderSet).sort(
      (a, b) => a.split('/').length - b.split('/').length
    )) {
      try {
        const exists = await this.vault.adapter.exists(f);
        if (!exists) await this.vault.adapter.mkdir(f);
      } catch {}
    }

    let count = 0;
    let processed = 0;
    await mapConcurrent(paths, READ_CONCURRENCY, async (path) => {
      try {
        const content = await this.vault.adapter.readBinary(path);
        await this.vault.adapter.writeBinary(`${folder}/${path}`, content);
        count++;
      } catch {}
      processed++;
      if (processed % 20 === 0 && paths.length > 0) {
        onProgress('snapshotting', 3 + Math.floor((processed / paths.length) * 22));
      }
      return null;
    });
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

    try {
      const exists = await this.vault.adapter.exists(localDir);
      if (!exists) await this.vault.adapter.mkdir(localDir);
    } catch {}

    const zipBuffer = await blob.arrayBuffer();
    const readmeBytes = new TextEncoder().encode(readme);

    await Promise.all([
      this.vault.adapter.writeBinary(`${localDir}/${zipName}`, zipBuffer),
      this.vault.adapter.writeBinary(`${localDir}/README.md`, readmeBytes.buffer),
    ]);

    return localDir;
  }

  // ============================================================
  // Path walking
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
    return path === LOCAL_BACKUP_FOLDER || path.startsWith(LOCAL_BACKUP_FOLDER + '/');
  }

  private isSystemPath(path: string): boolean {
    for (const folder of SYSTEM_FOLDERS) {
      if (path === folder || path.startsWith(folder + '/')) return true;
    }
    const segments = path.split('/');
    return segments.some((s) => s.startsWith('.') && s !== '.' && s !== '..');
  }

  private makeZipFileName(folderName: string): string {
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
