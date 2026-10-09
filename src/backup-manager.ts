import { Vault, normalizePath } from 'obsidian';
import { zip as fflateZip, unzip as fflateUnzip } from 'fflate';
import { GitHubAPI } from './github-api';
import { SimpleSyncSettings } from './settings';
import { toJalali, formatJalaliPath, formatJalaliReadable } from './jalali';

const LOCAL_BACKUP_FOLDER = '.backup';
const SNAPSHOT_PREFIX = 'snapshot';
const SYSTEM_FOLDERS = ['.obsidian', '.trash', '.git'];

// ============================================================
// Device profile
// ============================================================

interface DeviceProfile {
  memory: number;
  cores: number;
  isMobile: boolean;
  readConcurrency: number;
  writeConcurrency: number;
  statConcurrency: number;
  folderWalkConcurrency: number;
  compressionLevel: number;
}

function detectDeviceProfile(): DeviceProfile {
  let memory = 4;
  let cores = 4;
  let isMobile = false;
  try {
    const nav: any = typeof navigator !== 'undefined' ? navigator : {};
    if (typeof nav.deviceMemory === 'number') memory = nav.deviceMemory;
    if (typeof nav.hardwareConcurrency === 'number') cores = nav.hardwareConcurrency;
    if (typeof document !== 'undefined') isMobile = document.body.hasClass('is-mobile');
  } catch {}

  let readConcurrency = 12;
  let writeConcurrency = 10;
  let statConcurrency = 64;
  let folderWalkConcurrency = 24;
  let compressionLevel = 6;

  if (memory <= 2) {
    readConcurrency = 6;
    writeConcurrency = 6;
    statConcurrency = 24;
    folderWalkConcurrency = 8;
    compressionLevel = 4;
  } else if (memory <= 4) {
    readConcurrency = isMobile ? 12 : 20;
    writeConcurrency = isMobile ? 10 : 16;
    statConcurrency = isMobile ? 48 : 80;
    folderWalkConcurrency = isMobile ? 20 : 32;
    compressionLevel = isMobile ? 5 : 6;
  } else if (memory <= 8) {
    readConcurrency = isMobile ? 20 : 32;
    writeConcurrency = isMobile ? 16 : 24;
    statConcurrency = isMobile ? 96 : 128;
    folderWalkConcurrency = isMobile ? 32 : 48;
    compressionLevel = 6;
  } else {
    readConcurrency = 32;
    writeConcurrency = 24;
    statConcurrency = 128;
    folderWalkConcurrency = 48;
    compressionLevel = 6;
  }

  const maxIO = cores * 2;
  readConcurrency = Math.min(readConcurrency, Math.max(maxIO, 6));
  writeConcurrency = Math.min(writeConcurrency, Math.max(maxIO, 6));

  return {
    memory, cores, isMobile,
    readConcurrency, writeConcurrency, statConcurrency,
    folderWalkConcurrency, compressionLevel,
  };
}

const DEVICE: DeviceProfile = detectDeviceProfile();

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
export type IsCancelledFn = () => boolean;

export interface BackupEntry {
  folder: string;
  date: string;
  description: string;
  zipPath: string;
  readmePath: string;
  zipName: string;
  size: number;
  hasSystemFiles: 'yes' | 'no' | 'unknown';
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
// Concurrency helpers
// ============================================================

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  opts: { failFast?: boolean; isCancelled?: IsCancelledFn } = {}
): Promise<R[]> {
  const { failFast = true, isCancelled } = opts;
  const results: R[] = new Array(items.length);
  const errors: any[] = [];
  let cursor = 0;
  const workerCount = Math.min(Math.max(limit, 1), items.length);
  const workers: Promise<void>[] = [];

  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        while (true) {
          if (isCancelled?.()) break;
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
  if (isCancelled?.()) throw new Error('Cancelled');
  if (failFast && errors.length > 0) throw errors[0];
  return results;
}

async function listFolder(vault: Vault, folder: string): Promise<ListedFolder> {
  try {
    const listing: any = await vault.adapter.list(folder);
    const files: string[] = Array.isArray(listing?.files)
      ? listing.files.map((x: any) => String(x)) : [];
    const folders: string[] = Array.isArray(listing?.folders)
      ? listing.folders.map((x: any) => String(x)) : [];
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
// fflate promise wrappers
// ============================================================

function fflateZipAsync(
  files: Record<string, Uint8Array>,
  opts: { level: number; mem: number }
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    fflateZip(files, opts, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function fflateUnzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    fflateUnzip(data, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
}

// ============================================================
// BackupManager
// ============================================================

const STATS_TTL = 5 * 60 * 1000;  // 5 minutes

export class BackupManager {
  private statsCache = new Map<string, { value: VaultStats; ts: number }>();
  private statsInFlight = new Map<string, Promise<VaultStats>>();

  constructor(
    private vault: Vault,
    private github: GitHubAPI,
    private settings: SimpleSyncSettings
  ) {}

  updateSettings(s: SimpleSyncSettings) {
    this.settings = s;
  }

  getDeviceProfile(): DeviceProfile {
    return DEVICE;
  }

  // ============================================================
  // Stats: cached, background-refreshable
  // ============================================================

  getCachedStats(includeSystem: boolean): VaultStats | null {
    const c = this.statsCache.get(includeSystem ? 'system' : 'visible');
    return c ? c.value : null;
  }

  isCacheStale(includeSystem: boolean): boolean {
    const c = this.statsCache.get(includeSystem ? 'system' : 'visible');
    if (!c) return true;
    return Date.now() - c.ts > STATS_TTL;
  }

  invalidateStats() {
    this.statsCache.clear();
  }

  async countFilesAndSize(includeSystem: boolean): Promise<VaultStats> {
    const key = includeSystem ? 'system' : 'visible';
    const now = Date.now();
    const cached = this.statsCache.get(key);
    if (cached && now - cached.ts < STATS_TTL) return cached.value;

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

  /** Fire-and-forget background refresh. */
  refreshStatsInBackground(includeSystem: boolean) {
    if (!this.isCacheStale(includeSystem)) return;
    this.countFilesAndSize(includeSystem).catch(() => {});
  }

  private async computeStats(includeSystem: boolean): Promise<VaultStats> {
    const visible = this.countVisible();
    if (!includeSystem) return visible;

    const system = await this.walkSystemFolders();
    const sizes = await mapConcurrent(
      system.files,
      DEVICE.statConcurrency,
      (p) => statSize(this.vault, p),
      { failFast: false }
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

  private async walkSystemFolders(): Promise<PathSet> {
    const files: string[] = [];
    const folders: string[] = [];

    const walk = async (folder: string): Promise<void> => {
      const listing = await listFolder(this.vault, folder);
      for (const f of listing.files) files.push(f);

      await mapConcurrent(
        listing.folders,
        DEVICE.folderWalkConcurrency,
        async (sf) => {
          folders.push(sf);
          await walk(sf);
          return null;
        },
        { failFast: false }
      );
    };

    await mapConcurrent(
      SYSTEM_FOLDERS,
      3,
      async (sys) => {
        try {
          if (!(await this.vault.adapter.exists(sys))) return null;
          folders.push(sys);
          await walk(sys);
        } catch {}
        return null;
      },
      { failFast: false }
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
  // Full walk
  // ============================================================

  private async collectAllPaths(
    includeSystem: boolean,
    isCancelled?: IsCancelledFn
  ): Promise<PathSet> {
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
      if (isCancelled?.()) return;
      const listing = await listFolder(this.vault, folder);
      for (const f of listing.files) {
        if (this.isInsideLocalBackup(f)) continue;
        files.push(f);
      }
      const subs = listing.folders.filter((sf) => !this.isInsideLocalBackup(sf));
      await mapConcurrent(
        subs,
        DEVICE.folderWalkConcurrency,
        async (sf) => {
          folders.push(sf);
          await walk(sf);
          return null;
        },
        { failFast: false, isCancelled }
      );
    };

    await walk('');
    if (isCancelled?.()) throw new Error('Cancelled');
    return { files, folders };
  }

  // ============================================================
  // Backup
  // ============================================================

  async createBackup(
    description: string,
    includeSystem: boolean,
    onProgress: ProgressCallback,
    isCancelled?: IsCancelledFn
  ): Promise<BackupResult> {
    // 1. Scan
    onProgress('scanning', 3);
    const { files: paths } = await this.collectAllPaths(includeSystem, isCancelled);
    if (paths.length === 0) throw new Error('No files to back up');

    const hasSystemFiles = includeSystem && paths.some((p) => this.isSystemPath(p));

    // 2. Read files in parallel → build fflate file map
    onProgress('creating', 10);
    const fileMap: Record<string, Uint8Array> = {};
    let totalBytes = 0;
    let succeeded = 0;
    let processed = 0;

    await mapConcurrent(
      paths,
      DEVICE.readConcurrency,
      async (path) => {
        try {
          const buf = await this.vault.adapter.readBinary(path);
          fileMap[path] = new Uint8Array(buf);
          totalBytes += buf.byteLength;
          succeeded++;
        } catch (e) {
          console.warn('[Simple SYNC] read failed:', path, e);
        }
        processed++;
        if (processed % 20 === 0 || processed === paths.length) {
          const pct = 10 + Math.floor((processed / paths.length) * 40);
          onProgress('creating', pct);
        }
        return null;
      },
      { failFast: false, isCancelled }
    );

    if (succeeded === 0) throw new Error('No files could be read');
    if (isCancelled?.()) throw new Error('Cancelled');

    // 3. fflate ZIP — much faster than JSZip
    onProgress('creating', 52);
    let zipBytes: Uint8Array;
    try {
      zipBytes = await fflateZipAsync(fileMap, {
        level: DEVICE.compressionLevel,
        mem: DEVICE.isMobile ? 6 : 8,
      });
    } catch (e: any) {
      throw new Error(`ZIP creation failed: ${e.message}`);
    }
    if (isCancelled?.()) throw new Error('Cancelled');
    onProgress('creating', 60);

    // 4. Determine folder name and file name
    const now = new Date();
    const datePath = formatJalaliPath(toJalali(now));
    const baseFolder = `${this.settings.backupFolder}/${datePath}`;
    let folder = baseFolder;
    if (await this.folderExists(folder)) {
      folder = `${baseFolder}-${this.randomSuffix()}`;
    }
    const folderName = folder.split('/').pop() || 'backup';
    const zipName = this.makeZipFileName(folderName);

    // 5. Build README
    const readme = this.buildReadme(description, now, succeeded, totalBytes, hasSystemFiles);
    const readmeBytes = new TextEncoder().encode(readme);

    // 6. Upload ZIP (single file via Contents API — FAST)
    onProgress('uploading', 62);
    await this.github.uploadFile(
      `${folder}/${zipName}`,
      zipBytes,
      `Backup ${datePath} — ${description || 'no description'}`
    );
    if (isCancelled?.()) throw new Error('Cancelled');
    onProgress('uploading', 82);

    // 7. Upload README
    await this.github.uploadFile(
      `${folder}/README.md`,
      readmeBytes,
      `Add README for ${datePath}`
    );
    onProgress('uploading', 90);

    // 8. Local mirror
    onProgress('localCopy', 92);
    const localPath = await this.saveLocalMirror(folder, zipName, zipBytes, readme);
    onProgress('localCopy', 100);

    this.invalidateStats();

    return {
      folder,
      localPath,
      fileCount: succeeded,
      size: zipBytes.byteLength,
    };
  }

  // ============================================================
  // List backups
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
      Math.min(10, DEVICE.readConcurrency),
      async ([folderPath, entry]) => {
        let description = '';
        let hasSystemFiles: 'yes' | 'no' | 'unknown' = 'unknown';
        try {
          if (entry.readme) {
            const text = await this.github.getFileText(entry.readme.path);
            description = this.extractDescription(text || '');
            hasSystemFiles = this.detectSystemFiles(text || '');
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
      { failFast: false }
    );

    return (results.filter(Boolean) as BackupEntry[])
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  private detectSystemFiles(readme: string): 'yes' | 'no' | 'unknown' {
    const m = readme.match(/system\s*files\s*:?\s*\*{0,2}\s*(yes|no|true|false)/i);
    if (!m) return 'unknown';
    const v = m[1].toLowerCase();
    return v === 'yes' || v === 'true' ? 'yes' : 'no';
  }

  // ============================================================
  // Restore
  // ============================================================

  async restoreBackup(
    entry: BackupEntry,
    includeSystem: boolean,
    onProgress: ProgressCallback,
    isCancelled?: IsCancelledFn
  ): Promise<number> {
    onProgress('snapshotting', 3);
    await this.snapshotCurrentVault(onProgress, isCancelled);

    onProgress('downloading', 25);
    const zipBuffer = await this.github.getFileContent(entry.zipPath);
    if (!zipBuffer) throw new Error('Could not download backup');
    if (isCancelled?.()) throw new Error('Cancelled');

    onProgress('extracting', 45);
    let files: Record<string, Uint8Array>;
    try {
      files = await fflateUnzipAsync(new Uint8Array(zipBuffer));
    } catch (e: any) {
      throw new Error(`Unzip failed: ${e.message}`);
    }

    // Filter
    const entries: [string, Uint8Array][] = [];
    for (const [path, content] of Object.entries(files)) {
      if (!includeSystem && this.isSystemPath(path)) continue;
      entries.push([path, content]);
    }

    // Pre-create folders
    const folderSet = new Set<string>();
    for (const [path] of entries) {
      const parts = path.split('/');
      parts.pop();
      let cur = '';
      for (const p of parts) {
        cur = cur ? `${cur}/${p}` : p;
        folderSet.add(cur);
      }
    }
    const folderList = Array.from(folderSet).sort(
      (a, b) => a.split('/').length - b.split('/').length
    );
    for (const f of folderList) {
      try {
        if (!(await this.vault.adapter.exists(f))) await this.vault.adapter.mkdir(f);
      } catch {}
    }

    let count = 0;
    let processed = 0;
    await mapConcurrent(
      entries,
      DEVICE.writeConcurrency,
      async ([path, content]) => {
        try {
          const buf = content.buffer.slice(
            content.byteOffset,
            content.byteOffset + content.byteLength
          );
          await this.vault.adapter.writeBinary(normalizePath(path), buf as ArrayBuffer);
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
      { failFast: false, isCancelled }
    );

    onProgress('extracting', 100);
    return count;
  }

  // ============================================================
  // Snapshot (safety)
  // ============================================================

  private async snapshotCurrentVault(
    onProgress: ProgressCallback,
    isCancelled?: IsCancelledFn
  ): Promise<string> {
    const { files: paths } = await this.collectAllPaths(true, isCancelled);
    if (paths.length === 0) return '';

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const folder = `${LOCAL_BACKUP_FOLDER}/${SNAPSHOT_PREFIX}-${stamp}`;

    const folderSet = new Set<string>();
    for (const path of paths) {
      const parts = path.split('/');
      parts.pop();
      let cur = '';
      for (const p of parts) {
        cur = cur ? `${cur}/${p}` : p;
        folderSet.add(`${folder}/${cur}`);
      }
    }
    for (const f of Array.from(folderSet).sort(
      (a, b) => a.split('/').length - b.split('/').length
    )) {
      try {
        if (!(await this.vault.adapter.exists(f))) await this.vault.adapter.mkdir(f);
      } catch {}
    }

    let processed = 0;
    await mapConcurrent(
      paths,
      DEVICE.readConcurrency,
      async (path) => {
        try {
          const buf = await this.vault.adapter.readBinary(path);
          await this.vault.adapter.writeBinary(`${folder}/${path}`, buf);
        } catch {}
        processed++;
        if (processed % 20 === 0) {
          onProgress('snapshotting', 3 + Math.floor((processed / paths.length) * 22));
        }
        return null;
      },
      { failFast: false, isCancelled }
    );
    onProgress('snapshotting', 25);
    return folder;
  }

  private async saveLocalMirror(
    folder: string,
    zipName: string,
    zipBytes: Uint8Array,
    readme: string
  ): Promise<string> {
    const dateFolder = folder.split('/').pop() || 'backup';
    const localDir = `${LOCAL_BACKUP_FOLDER}/${dateFolder}`;

    try {
      if (!(await this.vault.adapter.exists(localDir))) {
        await this.vault.adapter.mkdir(localDir);
      }
    } catch {}

    const readmeBytes = new TextEncoder().encode(readme);
    const zipBuf = zipBytes.buffer.slice(
      zipBytes.byteOffset,
      zipBytes.byteOffset + zipBytes.byteLength
    ) as ArrayBuffer;

    await Promise.all([
      this.vault.adapter.writeBinary(`${localDir}/${zipName}`, zipBuf),
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
      `Device: ${DEVICE.isMobile ? 'mobile' : 'desktop'} · RAM: ${DEVICE.memory}GB · Cores: ${DEVICE.cores}`,
    ].join('\n');
  }

  private extractDescription(readme: string): string {
    const m = readme.match(/## Description\s*\n+([\s\S]*?)(?:\n\n---|$)/);
    if (!m) return '';
    const desc = m[1].trim();
    return desc === '_(no description)_' ? '' : desc;
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
