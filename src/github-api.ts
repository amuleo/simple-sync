import { requestUrl } from 'obsidian';
import { SimpleSyncSettings } from './settings';

export interface RemoteFile {
  path: string;
  sha: string;
  size: number;
}

export type UploadProgressCallback = (done: number, total: number) => void;
export type IsCancelledFn = () => boolean;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Single-file uploads via Contents API are capped at 100 MB by GitHub
const MAX_SINGLE_FILE_BYTES = 95 * 1024 * 1024;

// ============================================================
// Device profile
// ============================================================

interface DeviceCapabilities {
  memory: number;
  cores: number;
  isMobile: boolean;
  maxRetries: number;
}

function detectCapabilities(): DeviceCapabilities {
  let memory = 4;
  let cores = 4;
  let isMobile = false;
  try {
    const nav: any = typeof navigator !== 'undefined' ? navigator : {};
    if (typeof nav.deviceMemory === 'number') memory = nav.deviceMemory;
    if (typeof nav.hardwareConcurrency === 'number') cores = nav.hardwareConcurrency;
    if (typeof document !== 'undefined') isMobile = document.body.hasClass('is-mobile');
  } catch {}
  return { memory, cores, isMobile, maxRetries: memory <= 2 ? 1 : 3 };
}

const CAPS = detectCapabilities();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

// ============================================================
// GitHub API
// ============================================================

export class GitHubAPI {
  private baseUrl = 'https://api.github.com';

  constructor(private settings: SimpleSyncSettings) {}

  updateSettings(s: SimpleSyncSettings) {
    this.settings = s;
  }

  getCapabilities() {
    return CAPS;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.settings.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
  }

  private repoPath(): string {
    return `/repos/${this.settings.owner}/${this.settings.repo}`;
  }

  private async request(url: string, options: any = {}): Promise<any> {
    const method = options.method || 'GET';
    const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    try {
      return await requestUrl({ url, method, headers: this.headers(), body, throw: false });
    } catch (err: any) {
      throw new Error(`Network error: ${err.message || String(err)}`);
    }
  }

  private async requestWithRetry(
    url: string,
    options: any = {},
    maxRetries = CAPS.maxRetries
  ): Promise<any> {
    let lastErr: any = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.request(url, options);
        // Retry on transient errors
        if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          lastErr = new Error(`HTTP ${res.status}`);
          if (attempt < maxRetries) {
            await sleep(Math.pow(2, attempt) * 600);
            continue;
          }
        }
        return res;
      } catch (e) {
        lastErr = e;
        if (attempt < maxRetries) await sleep(Math.pow(2, attempt) * 600);
      }
    }
    throw lastErr || new Error('Request failed');
  }

  // ============================================================
  // Auth / Repos
  // ============================================================

  async getCurrentUser(): Promise<{ login: string; name: string }> {
    const res = await this.request(`${this.baseUrl}/user`);
    if (res.status === 401) throw new Error('Invalid or expired token');
    if (res.status >= 400) throw new Error(`Auth error: ${res.status}`);
    return { login: res.json.login, name: res.json.name || '' };
  }

  async listRepos(): Promise<any[]> {
    const res = await this.request(`${this.baseUrl}/user/repos?sort=updated&per_page=100`);
    if (res.status >= 400) throw new Error(`Repos error: ${res.status}`);
    return res.json;
  }

  // ============================================================
  // Refs / Trees
  // ============================================================

  async getBranchSha(branch: string): Promise<string | null> {
    const res = await this.request(`${this.baseUrl}${this.repoPath()}/git/ref/heads/${branch}`);
    if (res.status >= 400) return null;
    return res.json.object.sha;
  }

  async listFolderFiles(folder: string): Promise<RemoteFile[]> {
    const sha = await this.getBranchSha(this.settings.branch);
    if (!sha) return [];
    const res = await this.request(
      `${this.baseUrl}${this.repoPath()}/git/trees/${sha}?recursive=1`
    );
    if (res.status >= 400) return [];
    const tree = res.json.tree || [];
    const prefix = folder ? folder.replace(/\/$/, '') + '/' : '';
    return tree
      .filter((i: any) => i.type === 'blob' && i.path.startsWith(prefix))
      .map((i: any) => ({ path: i.path, sha: i.sha, size: i.size || 0 }));
  }

  // ============================================================
  // Single-file upload via Contents API (FAST)
  // ============================================================

  /**
   * Upload a single file via the Contents API.
   * This is dramatically faster than the multi-blob+tree+commit dance:
   * one HTTP request instead of N+3.
   *
   * Max size: ~100 MB (GitHub limit).
   */
  async uploadFile(
    path: string,
    content: Uint8Array,
    message: string
  ): Promise<void> {
    if (content.byteLength > MAX_SINGLE_FILE_BYTES) {
      const mb = (content.byteLength / 1024 / 1024).toFixed(1);
      throw new Error(
        `File too large (${mb} MB). GitHub's single-file limit is ~100 MB.`
      );
    }

    const base64 = this.uint8ToBase64(content);

    const res = await this.requestWithRetry(
      `${this.baseUrl}${this.repoPath()}/contents/${encodeURI(path)}`,
      {
        method: 'PUT',
        body: {
          message,
          content: base64,
          branch: this.settings.branch,
        },
      }
    );

    if (res.status === 422) {
      throw new Error('Upload rejected by GitHub (file too large or invalid path)');
    }
    if (res.status >= 400) {
      throw new Error(`Upload failed for ${path}: ${res.status} — ${res.text}`);
    }
  }

  // ============================================================
  // File content
  // ============================================================

  async getFileContent(path: string): Promise<ArrayBuffer | null> {
    const res = await this.request(
      `${this.baseUrl}${this.repoPath()}/contents/${encodeURI(path)}?ref=${this.settings.branch}`
    );
    if (res.status >= 400) return null;
    const content = res.json.content;
    if (!content) return null;
    return this.base64ToArrayBuffer(content.replace(/\s/g, ''));
  }

  async getFileText(path: string): Promise<string | null> {
    const buf = await this.getFileContent(path);
    return buf ? new TextDecoder().decode(buf) : null;
  }

  // ============================================================
  // Fast base64 encoding for Uint8Array (chunked, table-based)
  // ============================================================

  private uint8ToBase64(bytes: Uint8Array): string {
    const len = bytes.length;
    const groups = Math.floor(len / 3);
    const parts: string[] = [];
    const CHUNK = 16384;

    for (let start = 0; start < groups; start += CHUNK) {
      const end = Math.min(start + CHUNK, groups);
      let s = '';
      for (let g = start; g < end; g++) {
        const i = g * 3;
        const a = bytes[i];
        const b = bytes[i + 1];
        const c = bytes[i + 2];
        s += B64[a >> 2];
        s += B64[((a & 3) << 4) | (b >> 4)];
        s += B64[((b & 15) << 2) | (c >> 6)];
        s += B64[c & 63];
      }
      parts.push(s);
    }

    const rem = len - groups * 3;
    if (rem === 1) {
      const a = bytes[groups * 3];
      parts.push(B64[a >> 2] + B64[(a & 3) << 4] + '==');
    } else if (rem === 2) {
      const a = bytes[groups * 3];
      const b = bytes[groups * 3 + 1];
      parts.push(B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + B64[(b & 15) << 2] + '=');
    }

    return parts.join('');
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64.replace(/\s/g, ''));
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
}
