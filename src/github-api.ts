import { requestUrl } from 'obsidian';
import { SimpleSyncSettings } from './settings';

export interface RemoteFile {
  path: string;
  sha: string;
  size: number;
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

  async commitFiles(
    files: { path: string; content: ArrayBuffer }[],
    message: string
  ): Promise<void> {
    // 1. Create blobs
    const treeEntries: any[] = [];
    for (const f of files) {
      const base64 = this.arrayBufferToBase64(f.content);
      const blobRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/blobs`, {
        method: 'POST',
        body: { content: base64, encoding: 'base64' },
      });
      if (blobRes.status >= 400) throw new Error(`Create blob failed for ${f.path}`);
      treeEntries.push({ path: f.path, mode: '100644', type: 'blob', sha: blobRes.json.sha });
    }

    // 2. Get parent commit
    const refRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/ref/heads/${this.settings.branch}`);
    if (refRes.status >= 400) {
      // Empty repo — first commit
      const treeRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/trees`, {
        method: 'POST',
        body: { tree: treeEntries },
      });
      const commitRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/commits`, {
        method: 'POST',
        body: { message, tree: treeRes.json.sha, parents: [] },
      });
      await this.request(`${this.baseUrl}${this.repoPath()}/git/refs`, {
        method: 'POST',
        body: { ref: `refs/heads/${this.settings.branch}`, sha: commitRes.json.sha },
      });
      return;
    }
    const parentSha = refRes.json.object.sha;

    // 3. Get parent tree
    const parentCommitRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/commits/${parentSha}`);
    const treeRes = await this.request(
      `${this.baseUrl}${this.repoPath()}/git/trees/${parentCommitRes.json.tree.sha}?recursive=1`
    );
    const existing = treeRes.json.tree || [];

    // 4. Merge (replace same paths)
    const newPaths = new Set(files.map((f) => f.path));
    const merged = existing
      .filter((i: any) => i.type === 'blob' && !newPaths.has(i.path))
      .map((i: any) => ({ path: i.path, mode: i.mode || '100644', type: 'blob', sha: i.sha }));
    merged.push(...treeEntries);

    // 5. New tree
    const newTreeRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/trees`, {
      method: 'POST',
      body: { tree: merged },
    });

    // 6. New commit
    const commitRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/commits`, {
      method: 'POST',
      body: { message, tree: newTreeRes.json.sha, parents: [parentSha] },
    });

    // 7. Update ref
    const upd = await this.request(
      `${this.baseUrl}${this.repoPath()}/git/refs/heads/${this.settings.branch}`,
      { method: 'PATCH', body: { sha: commitRes.json.sha } }
    );
    if (upd.status >= 400) throw new Error('Failed to update branch');
  }

  async deleteFolder(folderPath: string, message: string): Promise<void> {
    const refRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/ref/heads/${this.settings.branch}`);
    if (refRes.status >= 400) throw new Error('Branch not found');
    const parentSha = refRes.json.object.sha;

    const parentCommitRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/commits/${parentSha}`);
    const treeRes = await this.request(
      `${this.baseUrl}${this.repoPath()}/git/trees/${parentCommitRes.json.tree.sha}?recursive=1`
    );
    const existing = treeRes.json.tree || [];
    const prefix = folderPath.replace(/\/$/, '') + '/';

    const newTree = existing
      .filter((i: any) => i.type === 'blob' && !i.path.startsWith(prefix))
      .map((i: any) => ({ path: i.path, mode: i.mode || '100644', type: 'blob', sha: i.sha }));

    const newTreeRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/trees`, {
      method: 'POST',
      body: { tree: newTree },
    });
    const commitRes = await this.request(`${this.baseUrl}${this.repoPath()}/git/commits`, {
      method: 'POST',
      body: { message, tree: newTreeRes.json.sha, parents: [parentSha] },
    });
    await this.request(`${this.baseUrl}${this.repoPath()}/git/refs/heads/${this.settings.branch}`, {
      method: 'PATCH',
      body: { sha: commitRes.json.sha },
    });
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
}
