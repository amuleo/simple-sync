import { Vault, normalizePath } from 'obsidian';
import JSZip from 'jszip';
import { GitHubAPI } from './github-api';
import { SimpleSyncSettings } from './settings';
import { toJalali, formatJalaliPath, formatJalaliReadable } from './jalali';

const LOCAL_BACKUP_FOLDER = '.backup';
const SNAPSHOT_PREFIX = 'snapshot';
const SYSTEM_FOLDERS = ['.obsidian', '.trash', '.git'];

const READ_CONCURRENCY_MAX = 32;
const WRITE_CONCURRENCY_MAX = 24;
const STAT_CONCURRENCY_MAX = 128;
const FOLDER_WALK_CONCURRENCY_MAX = 48;

const STORE_EXTENSIONS = new Set([
  'zip', 'gz', 'bz2', 'xz', '7z', 'rar', 'tar', 'zst', 'br',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'tif', 'heic', 'heif',
  'mp3', 'mp4', 'mov', 'avi', 'mkv', 'webm', 'wav', 'flac', 'ogg', 'm4a', 'm4v',
  'pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
]);

export type ProgressStep =
  | 'scanning' | 'creating' | 'uploading'
  | 'snapshotting' | 'downloading' | 'extracting' | 'localCopy';
export type ProgressCallback = (step: ProgressStep, percent: number) => void;

export interface BackupEntry {
  folder: string;
  date: string;
  description: string;
  zipPath: string;
  readmePath: string;
  zipName: string;
  size: number;
  hasSystemFiles: boolean;
}

export interface BackupResult {
  folder: string;
  localPath: string;
  fileCount: number;
  size: number;
}

export interface VaultStats {
  files: number;
  folders: number;
  size: number;
}

interface PathSet {
  files: string[];
  folders: string[];
}

interface ListedFolder {
  files: string[];
  folders: string[];
}

// ============================================================
// Adaptive concurrency
// ============================================================

function adaptiveConcurrency(count: number, base: number, max: number): number {
  if (count <= 20) return Math.min(base, max);
  if (count <= 200) return Math.min(base * 2, max);
  if (count <= 1000) return Math.min(base * 3, max);
  if (count <= 5000) return Math.min(base * 4, max);
  return max;
}

// ============================================================
// Parallel map — dynamic worker count
// ============================================================

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  failFast = true
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const errors: any[] = [];
  let cursor = 0;
  const workerCount = Math.min(Math.max(limit, 1), items.length);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= items.length) break;
          try {
            results[idx] = await fn(items[idx], idx);
          } catch (e) {
            errors.push(e);
            if (failFast) throw e;
          }
        }
      })()
    );
  }
  await Promise.allSettled(workers);
  if (failFast && errors.length > 0) throw errors[0];
  return results;
}

// ============================================================
// Multi-function scanning strategy
//   - countVisible(): instant via cached vault.getFiles()
//   - countSystem(): walks ONLY system folders with max concurrency
//   - statBatch(): parallel stat with adaptive concurrency
// ============================================================

async function listFolder(vault: Vault, folder: string): Promise<ListedFolder> {
  try {
    const listing: any = await vault.adapter.list(folder);
    const files: string[] = Array.isArray(listing?.files)
      ? listing.files.map((x: any) => String(x))
      : [];
    const folders: string[] = Array.isArray(listing?.folders)
      ? listing.folders.map((x: any) => String(x))
      : [];
    return { files, folders };
  } catch {
    return { files: [], folders: [] };
  }
}

async function statSize(vault: Vault, path: string): Promise<number> {
  try {
    const st: any = await vault.adapter.stat(path);
    return typeof st?.size === 'number' ? st.size : 0;
  } catch {
    return 0;
  }
}

// ============================================================
// BackupManager
// ============================================================

export class BackupManager {
  private statsCache = new Map<string, { value: VaultStats; ts: number }>();
  private statsInFlight = new Map<string, Promise<VaultStats>>();
  private STATS_TTL = 30000;

  constructor(
    private vault: Vault,
    private github: GitHubAPI,
    private settings: SimpleSyncSettings
  ) {}

  updateSettings(s: SimpleSyncSettings) {
    this.settings = s;
  }

  // ============================================================
  // Stats — cached, adaptively parallel
  // ============================================================

  getCachedStats(includeSystem: boolean): VaultStats | null {
    const key = includeSystem ? 'system' : 'visible';
    const c = this.statsCache.get(key);
    return c ? c.value : null;
  }

  invalidateStats() {
    this.statsCache.clear();
  }

  async countFilesAndSize(includeSystem: boolean): Promise<VaultStats> {
    const key = includeSystem ? 'system' : 'visible';
    const now = Date.now();

    const cached = this.statsCache.get(key);
    if (cached && now - cached.ts < this.STATS_TTL) {
      return cached.value;
    }

    const inflight = this.statsInFlight.get(key);
    if (inflight) return inflight;

    const promise = this.computeStats(includeSystem)
      .then((value) => {
        this.statsCache.set(key, { value, ts: Date.now() });
        this.statsInFlight.delete(key);
        return value;
      })
      .catch((e) => {
        this.statsInFlight.delete(key);
        throw e;
      });

    this.statsInFlight.set(key, promise);
    return promise;
  }

  private async computeStats(includeSystem: boolean): Promise<VaultStats> {
    // Function 1: visible files (instant via cache)
    const visible = this.countVisible();

    if (!includeSystem) {
      return {
        files: visible.files,
        folders: visible.folders,
        size: visible.size,
      };
    }

    // Function 2: walk ONLY system folders
    const system = await this.walkSystemFolders();

    // Function 3: stat all system files in parallel with adaptive concurrency
    const concurrency = adaptiveConcurrency(
      system.files.length,
      STAT_CONCURRENCY_MAX / 4,
      STAT_CONCURRENCY_MAX
    );
    const sizes = await mapConcurrent(
      system.files,
      concurrency,
      (p) => statSize(this.vault, p),
      false
    );

    let sysSize = 0;
    for (const s of sizes) sysSize += s || 0;

    return {
      files: visible.files + system.files.length,
      folders: visible.folders + system.folders.length,
      size: visible.size + sysSize,
    };
  }

  private countVisible(): VaultStats {
    let files = 0;
    let size = 0;
    for (const f of this.vault.getFiles()) {
      if (this.isInsideLocalBackup(f.path)) continue;
      if (this.isSystemPath(f.path)) continue;
      files++;
      size += f.stat.size;
    }
    return { files, folders: this.countVisibleFolders(), size };
  }

  // ============================================================
  // System folder walk — only 3 folders, max parallel
  // ============================================================

  private async walkSystemFolders(): Promise<PathSet> {
    const files: string[] = [];
    const folders: string[] = [];

    const walk = async (folder: string): Promise<void> => {
      const listing = await listFolder(this.vault, folder);
      for (const f of listing.files) files.push(f);

      const concurrency = adaptiveConcurrency(
        listing.folders.length,
        4,
        FOLDER_WALK_CONCURRENCY_MAX
      );
      await mapConcurrent(
        listing.folders,
        concurrency,
        async (sf) => {
          folders.push(sf);
          await walk(sf);
          return null;
        },
        false
      );
    };

    // Walk the 3 system folders in parallel
    await mapConcurrent(
      SYSTEM_FOLDERS,
      3,
      async (sys) => {
        try {
          const exists = await this.vault.adapter.exists(sys);
          if (!exists) return null;
          folders.push(sys);
          await walk(sys);
        } catch {}
        return null;
      },
      false
    );

    return { files, folders };
  }

  private countVisibleFolders(): number {
    let count = 0;
    const root: any = this.vault.getRoot();
    const visit = (folder: any) => {
      if (!folder || !Array.isArray(folder.children)) return;
      for (const child of folder.children) {
        if (child && Array.isArray(child.children)) {
          count++;
          visit(child);
        }
      }
    };
    visit(root);
    return count;
  }

  // ============================================================
  // Full walk (for backup)
  // ============================================================

  private async collectAllPaths(includeSystem: boolean): Promise<PathSet> {
    if (!includeSystem) {
      const files = this.vault
        .getFiles()
        .filter((f) => !this.isInsideLocalBackup(f.path) && !this.isSystemPath(f.path))
        .map((f) => f.path);
      return { files, folders: [] };
    }

    const files: string[] = [];
    const folders: string[] = [];

    const walk = async (folder: string): Promise<void> => {
      const listing = await listFolder(this.vault, folder);
      for (const f of listing.files) {
        if (this.isInsideLocalBackup(f)) continue;
        files.push(f);
      }
      const subs = listing.folders.filter((sf) => !this.isInsideLocalBackup(sf));
      const concurrency = adaptiveConcurrency(
        subs.length,
        4,
        FOLDER_WALK_CONCURRENCY_MAX
      );
      await mapConcurrent(
        subs,
        concurrency,
        async (sf) => {
          folders.push(sf);
          await walk(sf);
          return null;
        },
        false
      );
    };

    await walk('');
    return { files, folders };
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
    const { files: paths } = await this.collectAllPaths(includeSystem);
    if (paths.length === 0) throw new Error('No files to back up');

    const hasSystemFiles = includeSystem && paths.some((p) => this.isSystemPath(p));

    onProgress('creating', 8);
    const zip = new JSZip();

    let totalBytes = 0;
    let succeeded = 0;
    let processed = 0;

    const readConcurrency = adaptiveConcurrency(
      paths.length,
      READ_CONCURRENCY_MAX / 4,
      READ_CONCURRENCY_MAX
    );

    await mapConcurrent(paths, readConcurrency, async (path) => {
      try {
        const content = await this.vault.adapter.readBinary(path);
        const store = this.shouldStore(path);
        zip.file(path, content, store ? { compression: 'STORE' } : undefined);
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
    }, false);

    if (succeeded === 0) throw new Error('No files could be read');

    onProgress('creating', 50);
    const blob = await zip.generateAsync(
      {
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      },
      (meta) => {
        onProgress('creating', 50 + Math.floor(meta.percent * 0.08));
      }
    );

    const now = new Date();
    const datePath = formatJalaliPath(toJalali(now));
    const baseFolder = `${this.settings.backupFolder}/${datePath}`;
    let folder = baseFolder;
    if (await this.folderExists(folder)) {
      folder = `${baseFolder}-${this.randomSuffix()}`;
    }

    const folderName = folder.split('/').pop() || 'backup';
    const zipName = this.makeZipFileName(folderName);

    const readme = this.buildReadme(
      description,
      now,
      succeeded,
      totalBytes,
      hasSystemFiles
    );
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

    // Invalidate stats cache — we just created a new backup
    this.invalidateStats();

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

    const folderArr = Array.from(folders.entries()).filter(([, e]) => e.zip);

    const results = await mapConcurrent(
      folderArr,
      10,
      async ([folderPath, entry]) => {
        let description = '';
        let hasSystemFiles = false;
        try {
          if (entry.readme) {
            const text = await this.github.getFileText(entry.readme.path);
            description = this.extractDescription(text || '');
            hasSystemFiles = /System files:\*\*\s*yes/i.test(text || '');
          }
        } catch {}
        const lastSegment = folderPath.split('/').pop() || folderPath;
        return {
          folder: folderPath,
          date: lastSegment,
          description,
          zipPath: entry.zip.path,
          readmePath: entry.readme?.path || '',
          zipName: entry.zip.path.split('/').pop() || 'backup.zip',
          size: entry.zip.size,
          hasSystemFiles,
        } as BackupEntry;
      },
      false
    );

    const result = results.filter(Boolean) as BackupEntry[];
    return result.sort((a, b) => b.date.localeCompare(a.date));
  }

  async restoreBackup(
    entry: BackupEntry,
    includeSystem: boolean,
    onProgress: ProgressCallback
  ): Promise<number> {
    onProgress('snapshotting', 3);
    await this.snapshotCurrentVault(onProgress);

    onProgress('downloading', 25);
    const zipBuffer = await this.github.getFileContent(entry.zipPath);
    if (!zipBuffer) throw new Error('Could not download backup');

    onProgress('extracting', 45);
    const zip = await JSZip.loadAsync(zipBuffer);

    // Build filtered list
    const entries: [string, any][] = [];
    for (const [path, file] of Object.entries(zip.files)) {
      const f = file as any;
      if (f.dir) continue;
      if (!includeSystem && this.isSystemPath(path)) continue;
      entries.push([path, file]);
    }

    // Pre-create folders
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

    let count = 0;
    let processed = 0;
    const writeConcurrency = adaptiveConcurrency(
      entries.length,
      WRITE_CONCURRENCY_MAX / 4,
      WRITE_CONCURRENCY_MAX
    );

    await mapConcurrent(
      entries,
      writeConcurrency,
      async ([path, file]) => {
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
      },
      false
    );

    onProgress('extracting', 100);
    return count;
  }

  // ============================================================
  // Snapshot
  // ============================================================

  private async snapshotCurrentVault(onProgress: ProgressCallback): Promise<string> {
    const { files: paths } = await this.collectAllPaths(true);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const folder = `${LOCAL_BACKUP_FOLDER}/${SNAPSHOT_PREFIX}-${stamp}`;

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
    const folderList = Array.from(folderSet).sort(
      (a, b) => a.split('/').length - b.split('/').length
    );
    for (const f of folderList) {
      try {
        const exists = await this.vault.adapter.exists(f);
        if (!exists) await this.vault.adapter.mkdir(f);
      } catch {}
    }

    let count = 0;
    let processed = 0;
    const concurrency = adaptiveConcurrency(
      paths.length,
      READ_CONCURRENCY_MAX / 4,
      READ_CONCURRENCY_MAX
    );

    await mapConcurrent(
      paths,
      concurrency,
      async (path) => {
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
      },
      false
    );
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
  // Helpers
  // ============================================================

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

  private shouldStore(path: string): boolean {
    const idx = path.lastIndexOf('.');
    if (idx < 0) return false;
    const ext = path.slice(idx + 1).toLowerCase();
    return STORE_EXTENSIONS.has(ext);
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

  private buildReadme(
    description: string,
    date: Date,
    fileCount: number,
    totalBytes: number,
    hasSystemFiles: boolean
  ): string {
    return [
      '# Simple SYNC Backup',
      '',
      `**Date:** ${formatJalaliReadable(date)}`,
      `**Files:** ${fileCount}`,
      `**Size:** ${this.formatBytes(totalBytes)}`,
      `**System files:** ${hasSystemFiles ? 'yes' : 'no'}`,
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
