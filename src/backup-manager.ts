import { Vault, normalizePath } from 'obsidian';
import { zip as fflateZip, unzip as fflateUnzip } from 'fflate';
import { GitHubAPI } from './github-api';
import { SimpleSyncSettings } from './settings';
import { toJalali, formatJalaliPath, formatJalaliReadable } from './jalali';

const LOCAL_BACKUP_FOLDER = '.backup';
const SNAPSHOT_PREFIX = 'snapshot';
const SYSTEM_FOLDERS = ['.obsidian', '.trash', '.git'];

// GitHub Contents API limit is 100 MB per file.
// Use 88 MB to leave headroom (base64 overhead, JSON wrapping, etc.)
const MAX_SINGLE_FILE_BYTES = 88 * 1024 * 1024;
const PART_SIZE_BYTES = 80 * 1024 * 1024;

// ============================================================
// fflate level type
// ============================================================

type FflateLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

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
  compressionLevel: FflateLevel;
  uploadConcurrency: number;
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
  let compressionLevel: FflateLevel = 6;
  let uploadConcurrency = 4;

  if (memory <= 2) {
    readConcurrency = 6; writeConcurrency = 6; statConcurrency = 24;
    folderWalkConcurrency = 8; compressionLevel = 4; uploadConcurrency = 2;
  } else if (memory <= 4) {
    readConcurrency = isMobile ? 12 : 20;
    writeConcurrency = isMobile ? 10 : 16;
    statConcurrency = isMobile ? 48 : 80;
    folderWalkConcurrency = isMobile ? 20 : 32;
    compressionLevel = isMobile ? 5 : 6;
    uploadConcurrency = isMobile ? 2 : 4;
  } else if (memory <= 8) {
    readConcurrency = isMobile ? 20 : 32;
    writeConcurrency = isMobile ? 16 : 24;
    statConcurrency = isMobile ? 96 : 128;
    folderWalkConcurrency = isMobile ? 32 : 48;
    compressionLevel = 6;
    uploadConcurrency = isMobile ? 3 : 5;
  } else {
    readConcurrency = 32; writeConcurrency = 24; statConcurrency = 128;
    folderWalkConcurrency = 48; compressionLevel = 6; uploadConcurrency = 6;
  }

  const maxIO = cores * 2;
  readConcurrency = Math.min(readConcurrency, Math.max(maxIO, 6));
  writeConcurrency = Math.min(writeConcurrency, Math.max(maxIO, 6));

  return {
    memory, cores, isMobile,
    readConcurrency, writeConcurrency, statConcurrency,
    folderWalkConcurrency, compressionLevel, uploadConcurrency,
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
  | 'scanning' | 'creating' | 'splitting' | 'uploading' | 'uploadingPart'
  | 'snapshotting' | 'downloading' | 'downloadingPart' | 'reassembling'
  | 'extracting' | 'localCopy';
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
  partPaths: string[];
}

export interface BackupResult {
  folder: string;
  localPath: string;
  fileCount: number;
  size: number;
  parts: number;
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
// fflate wrappers
// ============================================================

function fflateZipAsync(
  files: Record<string, Uint8Array>,
  opts: { level: FflateLevel; mem: number }
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    fflateZip(files, opts, (err, data) => err ? reject(err) : resolve(data));
  });
}

function fflateUnzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    fflateUnzip(data, (err, out) => err ? reject(err) : resolve(out));
  });
}

// ============================================================
// Byte helpers
// ============================================================

function splitBytes(data: Uint8Array, chunkSize: number): Uint8Array[] {
  if (data.byteLength <= chunkSize) return [data];
  const parts: Uint8Array[] = [];
  for (let i = 0; i < data.byteLength; i += chunkSize) {
    parts.push(data.slice(i, Math.min(i + chunkSize, data.byteLength)));
  }
  return parts;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

function formatPartSuffix(i: number): string {
  return `part-${String(i).padStart(3, '0')}`;
}

// ============================================================
// BackupManager
// ============================================================

const STATS_TTL = 5 * 60 * 1000;

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
  // Stats
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
  // Backup (with large-file support)
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

    // 2. Read files in parallel
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

    // 3. fflate ZIP
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

    // Free memory
    for (const k of Object.keys(fileMap)) delete fileMap[k];

    // 4. Folder name & file name
    const now = new Date();
    const datePath = formatJalaliPath(toJalali(now));
    const baseFolder = `${this.settings.backupFolder}/${datePath}`;
    let folder = baseFolder;
    if (await this.folderExists(folder)) {
      folder = `${baseFolder}-${this.randomSuffix()}`;
    }
    const folderName = folder.split('/').pop() || 'backup';
    const zipName = this.makeZipFileName(folderName);

    const zipSize = zipBytes.byteLength;

    // 5. Single-file path
    if (zipSize <= MAX_SINGLE_FILE_BYTES) {
      const readme = this.buildReadme(
        description, now, succeeded, totalBytes, hasSystemFiles, 1, zipSize
      );
      const readmeBytes = new TextEncoder().encode(readme);

      onProgress('uploading', 62);
      await this.github.uploadFile(
        `${folder}/${zipName}`,
        zipBytes,
        `Backup ${datePath} — ${description || 'no description'}`
      );
      if (isCancelled?.()) throw new Error('Cancelled');
      onProgress('uploading', 85);

      await this.github.uploadFile(
        `${folder}/README.md`,
        readmeBytes,
        `Add README for ${datePath}`
      );
      onProgress('uploading', 90);

      onProgress('localCopy', 92);
      const localPath = await this.saveLocalMirror(folder, zipName, [zipBytes], readme);
      onProgress('localCopy', 100);

      this.invalidateStats();

      return {
        folder,
        localPath,
        fileCount: succeeded,
        size: zipSize,
        parts: 1,
      };
    }

    // 6. Multi-part path
    const parts = splitBytes(zipBytes, PART_SIZE_BYTES);
    const partCount = parts.length;

    const readme = this.buildReadme(
      description, now, succeeded, totalBytes, hasSystemFiles, partCount, zipSize
    );
    const readmeBytes = new TextEncoder().encode(readme);

    onProgress('splitting', 62);

    let uploadedParts = 0;
    onProgress('uploadingPart', 64);

    await mapConcurrent(
      parts,
      DEVICE.uploadConcurrency,
      async (partData, i) => {
        if (isCancelled?.()) throw new Error('Cancelled');
        const partName = `${zipName}.${formatPartSuffix(i + 1)}`;
        await this.github.uploadFile(
          `${folder}/${partName}`,
          partData,
          `Backup ${datePath} — part ${i + 1}/${partCount}`
        );
        uploadedParts++;
        const pct = 64 + Math.floor((uploadedParts / partCount) * 24);
        onProgress('uploadingPart', Math.min(pct, 88));
        return null;
      },
      { failFast: true, isCancelled }
    );

    if (isCancelled?.()) throw new Error('Cancelled');

    await this.github.uploadFile(
      `${folder}/README.md`,
      readmeBytes,
      `Add README for ${datePath}`
    );
    onProgress('uploadingPart', 90);

    onProgress('localCopy', 92);
    const localPath = await this.saveLocalMirror(folder, zipName, parts, readme);
    onProgress('localCopy', 100);

    this.invalidateStats();

    return {
      folder,
      localPath,
      fileCount: succeeded,
      size: zipSize,
      parts: partCount,
    };
  }

  // ============================================================
  // List backups
  // ============================================================

  async listBackups(): Promise<BackupEntry[]> {
    const files = await this.github.listFolderFiles(this.settings.backupFolder);

    type FolderState = {
      readme?: any;
      singleZip?: any;
      parts: { index: number; file: any }[];
    };
    const folders = new Map<string, FolderState>();

    for (const f of files) {
      const parts = f.path.split('/');
      if (parts.length < 2) continue;
      const folderName = parts.slice(0, -1).join('/');
      const fileName = parts[parts.length - 1];

      let st = folders.get(folderName);
      if (!st) {
        st = { parts: [] };
        folders.set(folderName, st);
      }

      if (fileName === 'README.md') {
        st.readme = f;
      } else if (/\.zip\.part-\d+$/.test(fileName)) {
        const m = fileName.match(/\.part-(\d+)$/);
        const idx = m ? parseInt(m[1], 10) : 0;
        st.parts.push({ index: idx, file: f });
      } else if (fileName.endsWith('.zip')) {
        st.singleZip = f;
      }
    }

    const entries: BackupEntry[] = [];

    for (const [folderPath, st] of folders) {
      const hasParts = st.parts.length > 0;
      if (!st.singleZip && !hasParts) continue;

      let description = '';
      let hasSystemFiles: 'yes' | 'no' | 'unknown' = 'unknown';
      try {
        if (st.readme) {
          const text = await this.github.getFileText(st.readme.path);
          description = this.extractDescription(text || '');
          hasSystemFiles = this.detectSystemFiles(text || '');
        }
      } catch {}

      const lastSegment = folderPath.split('/').pop() || folderPath;
      let partPaths: string[];
      let size = 0;
      let zipName: string;
      let zipPath: string;

      if (hasParts) {
        st.parts.sort((a, b) => a.index - b.index);
        partPaths = st.parts.map((p) => p.file.path);
        for (const p of st.parts) size += p.file.size || 0;
        zipName = st.parts[0].file.path.split('/').pop()?.replace(/\.part-\d+$/, '') || 'backup.zip';
        zipPath = st.parts[0].file.path;
      } else {
        partPaths = [st.singleZip.path];
        size = st.singleZip.size || 0;
        zipName = st.singleZip.path.split('/').pop() || 'backup.zip';
        zipPath = st.singleZip.path;
      }

      entries.push({
        folder: folderPath,
        date: lastSegment,
        description,
        zipPath,
        readmePath: st.readme?.path || '',
        zipName,
        size,
        hasSystemFiles,
        partPaths,
      });
    }

    return entries.sort((a, b) => b.date.localeCompare(a.date));
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

    const isMulti = entry.partPaths.length > 1;
    const partBuffers: Uint8Array[] = new Array(entry.partPaths.length);

    if (isMulti) onProgress('downloadingPart', 25);
    else onProgress('downloading', 25);

    let downloaded = 0;
    await mapConcurrent(
      entry.partPaths,
      Math.min(4, DEVICE.uploadConcurrency),
      async (path, i) => {
        if (isCancelled?.()) throw new Error('Cancelled');
        const buf = await this.github.getFileContent(path);
        if (!buf) throw new Error(`Failed to download part ${i + 1}`);
        partBuffers[i] = new Uint8Array(buf);
        downloaded++;
        const pct = 25 + Math.floor((downloaded / entry.partPaths.length) * 20);
        onProgress(isMulti ? 'downloadingPart' : 'downloading', Math.min(pct, 45));
        return null;
      },
      { failFast: true, isCancelled }
    );

    if (isCancelled?.()) throw new Error('Cancelled');

    let zipBytes: Uint8Array;
    if (isMulti) {
      onProgress('reassembling', 46);
      zipBytes = concatBytes(partBuffers);
      partBuffers.length = 0;
    } else {
      zipBytes = partBuffers[0];
    }

    onProgress('extracting', 50);
    let files: Record<string, Uint8Array>;
    try {
      files = await fflateUnzipAsync(zipBytes);
    } catch (e: any) {
      throw new Error(`Unzip failed: ${e.message}`);
    }

    zipBytes = new Uint8Array(0);

    const entries: [string, Uint8Array][] = [];
    for (const [path, content] of Object.entries(files)) {
      if (!includeSystem && this.isSystemPath(path)) continue;
      entries.push([path, content]);
    }

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
          const pct = 50 + Math.floor((processed / entries.length) * 50);
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
  // Snapshot
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

  // ============================================================
  // Local mirror
  // ============================================================

  private async saveLocalMirror(
    folder: string,
    zipName: string,
    parts: Uint8Array[],
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
    const writes: Promise<any>[] = [];

    if (parts.length === 1) {
      const buf = parts[0].buffer.slice(
        parts[0].byteOffset,
        parts[0].byteOffset + parts[0].byteLength
      ) as ArrayBuffer;
      writes.push(this.vault.adapter.writeBinary(`${localDir}/${zipName}`, buf));
    } else {
      for (let i = 0; i < parts.length; i++) {
        const partName = `${zipName}.${formatPartSuffix(i + 1)}`;
        const buf = parts[i].buffer.slice(
          parts[i].byteOffset,
          parts[i].byteOffset + parts[i].byteLength
        ) as ArrayBuffer;
        writes.push(this.vault.adapter.writeBinary(`${localDir}/${partName}`, buf));
      }
    }

    writes.push(
      this.vault.adapter.writeBinary(`${localDir}/README.md`, readmeBytes.buffer)
    );

    await Promise.all(writes);
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
    hasSystemFiles: boolean,
    parts: number,
    zipBytes: number
  ): string {
    const lines = [
      '# Simple SYNC Backup',
      '',
      `**Date:** ${formatJalaliReadable(date)}`,
      `**Files:** ${fileCount}`,
      `**Source size:** ${this.formatBytes(totalBytes)}`,
      `**Archive size:** ${this.formatBytes(zipBytes)}`,
      `**System files:** ${hasSystemFiles ? 'yes' : 'no'}`,
    ];

    if (parts > 1) {
      lines.push(`**Parts:** ${parts}`);
    }

    lines.push(
      '',
      '## Description',
      '',
      description || '_(no description)_',
      '',
      '---',
      `Created by Simple SYNC at ${new Date().toISOString()}`,
      `Device: ${DEVICE.isMobile ? 'mobile' : 'desktop'} · RAM: ${DEVICE.memory}GB · Cores: ${DEVICE.cores}`,
    );

    return lines.join('\n');
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
