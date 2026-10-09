const KEYWORDS = ['obsidian', 'vault', 'note', 'notes', 'zettelkasten', 'pkm', 'knowledge', 'backup'];

export interface SuggestedRepo {
  name: string;
  fullName: string;
  reason: string;
  score: number;
  isPrivate: boolean;
}

export function suggestObsidianRepos(repos: any[]): SuggestedRepo[] {
  const out: SuggestedRepo[] = [];
  for (const repo of repos) {
    let score = 0;
    const reasons: string[] = [];
    const n = repo.name.toLowerCase();
    const d = (repo.description || '').toLowerCase();
    for (const kw of KEYWORDS) {
      if (n.includes(kw)) { score += 10; reasons.push(`"${kw}"`); }
      if (d.includes(kw)) score += 5;
    }
    if (n.endsWith('-vault') || n.endsWith('-backup')) {
      score += 15;
      reasons.push('name pattern');
    }
    const days = (Date.now() - new Date(repo.updated_at).getTime()) / 86400000;
    if (days < 7) score += 3;
    if (score > 0) {
      out.push({
        name: repo.name,
        fullName: repo.full_name,
        reason: reasons.slice(0, 2).join(', ') || 'recent',
        score,
        isPrivate: repo.private,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}
