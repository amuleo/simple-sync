import { requestUrl } from 'obsidian';
import { SimpleSyncSettings } from './settings';

export interface RemoteFile {
  path: string;
  sha: string;
  size: number;
}

const UPLOAD_CONCURRENCY = 8;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Run `fn` over `items` with bounded concurrency.
 * All workers complete before this resolves; if any error occurred,
 * the first error is thrown. This prevents silent partial uploads.
 */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const errors: any[] = [];
  let cursor = 0;
  const workerCount = Math.min(limit, items.length);
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
          }
        }
      })()
    );
  }

  await Promise.all(workers);
  if (errors.length > 0) throw errors[0];
  return results;
}

export class GitHubAPI {
  private baseUrl = 'https://api.github.com';

  constructor(private settings: SimpleSyncSettings) {}

  updateSettings(s: SimpleSyncSettings) {
    this.settings = s;
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

  /**
   * Create a commit with the given files.
   * Blobs are uploaded in parallel. If any blob fails, the whole commit fails.
   */
  async commitFiles(
    files: { path: string; content: ArrayBuffer }[],
    message: string
  ): Promise<void> {
    if (files.length === 0) throw new Error('No files to commit');

    // 1. Parallel blob creation
    const entries = await mapConcurrent(files, UPLOAD_CONCURRENCY, async (f) => {
      const base64 = this.arrayBufferToBase64(f.content);
      const res = await this.request(`${this.baseUrl}${this.repoPath()}/git/blobs`, {
        method: 'POST',
        body: { content: base64, encoding: 'base64' },
      });
      if (res.status >= 400) {
        throw new Error(`Create blob failed for ${f.path}: ${res.status} ${res.text}`);
      }
      return { path: f.path, mode: '100644', type: 'blob', sha: res.json.sha };
    });

    // Safety net: verify every file produced a blob
    if (entries.length !== files.length || entries.some((e) => !e)) {
      throw new Error(
        `Upload incomplete: ${entries.filter(Boolean).length} of ${files.length} blobs created`
      );
    }

    const treeEntries: any[] = entries;

    // 2. Get parent commit
    const refRes = await this.request(
      `${this.baseUrl}${this.repoPath()}/git/ref/heads/${this.settings.branch}`
    );

    if (refRes.status >= 400) {
      // Empty repo — first commit
      const treeRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/trees`, {
        method: 'POST',
        body: { tree: treeEntries },
      });
      if (treeRes.status >= 400) throw new Error(`Create tree failed: ${treeRes.text}`);
      const commitRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/commits`, {
        method: 'POST',
        body: { message, tree: treeRes.json.sha, parents: [] },
      });
      if (commitRes.status >= 400) throw new Error(`Create commit failed: ${commitRes.text}`);
      const finalRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/refs`, {
        method: 'POST',
        body: { ref: `refs/heads/${this.settings.branch}`, sha: commitRes.json.sha },
      });
      if (finalRes.status >= 400) throw new Error(`Set ref failed: ${finalRes.text}`);
      return;
    }

    const parentSha = refRes.json.object.sha;

    // 3. Get parent tree
    const parentCommitRes = await this.request(
      `${this.baseUrl}${this.repoPath()}/git/commits/${parentSha}`
    );
    const treeRes = await this.request(
      `${this.baseUrl}${this.repoPath()}/git/trees/${parentCommitRes.json.tree.sha}?recursive=1`
    );
    const existing = treeRes.json.tree || [];

    // 4. Merge (replace same paths)
    const newPaths = new Set(files.map((f) => f.path));
    const merged = existing
      .filter((i: any) => i.type === 'blob' && !newPaths.has(i.path))
      .map((i: any) => ({
        path: i.path,
        mode: i.mode || '100644',
        type: 'blob',
        sha: i.sha,
      }));
    merged.push(...treeEntries);

    // 5. New tree
    const newTreeRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/trees`, {
      method: 'POST',
      body: { tree: merged },
    });
    if (newTreeRes.status >= 400) throw new Error(`Create merged tree failed: ${newTreeRes.text}`);

    // 6. New commit
    const commitRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/commits`, {
      method: 'POST',
      body: { message, tree: newTreeRes.json.sha, parents: [parentSha] },
    });
    if (commitRes.status >= 400) throw new Error(`Create commit failed: ${commitRes.text}`);

    // 7. Update ref
    const upd = await this.request(
      `${this.baseUrl}${this.repoPath()}/git/refs/heads/${this.settings.branch}`,
      { method: 'PATCH', body: { sha: commitRes.json.sha } }
    );
    if (upd.status >= 400) throw new Error(`Update branch failed: ${upd.text}`);
  }

  // ============================================================
  // Fast base64 encoding (manual, ~2-3x faster than fromCharCode+btoa for large files)
  // ============================================================

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const len = bytes.length;
    const groups = Math.floor(len / 3);
    const parts: string[] = [];
    const CHUNK = 16384; // groups per chunk

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
