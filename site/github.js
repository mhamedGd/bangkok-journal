import { config } from './config.js';

export class GitHubError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'GitHubError'; this.status = status; }
}
export function encodeText(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeText(encoded) {
  return new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/\s/g, '')), char => char.charCodeAt(0)));
}
export function validPhotoPath(path) {
  return typeof path === 'string' && /^photos\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.jpg$/.test(path);
}
export function validateJournal(data) {
  if (data?.version !== 1 || !Array.isArray(data.memories)) throw new Error('This journal has an unsupported format.');
  const ids = new Set();
  for (const m of data.memories) {
    if (typeof m.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(m.id) || ids.has(m.id)) throw new Error('A memory has an invalid or duplicate ID.');
    ids.add(m.id);
    if (!['title','place','note','date','tag','updatedAt','createdAt'].every(key => typeof m[key] === 'string')) throw new Error('A memory is missing required details.');
    if (m.title.length > 120 || m.place.length > 160 || m.note.length > 12000 || !/^\d{4}-\d{2}-\d{2}$/.test(m.date) || !Number.isFinite(Date.parse(`${m.date}T12:00:00Z`))) throw new Error('A memory has invalid text or a date.');
    if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng) || Math.abs(m.lat) > 90 || Math.abs(m.lng) > 180) throw new Error('A memory has invalid map coordinates.');
    if (!Array.isArray(m.photos) || m.photos.length > 8 || m.photos.some(p => !validPhotoPath(p.path) || typeof p.alt !== 'string')) throw new Error('A memory has invalid photos.');
  }
  return data;
}
export function applyOperation(journal, operation) {
  validateJournal(journal);
  const current = journal.memories.find(m => m.id === operation.id);
  if (operation.type === 'upsert' && current && JSON.stringify(current) === JSON.stringify(operation.memory)) return journal;
  if (operation.type === 'delete' && !current) return journal;
  if (operation.baseUpdatedAt ? current?.updatedAt !== operation.baseUpdatedAt : !!current) {
    throw new Error('This memory changed in another tab. Close the editor and reopen the latest version before saving. Your text is still here.');
  }
  let memories = journal.memories.filter(m => m.id !== operation.id);
  if (operation.type === 'upsert') {
    if (operation.memory?.id !== operation.id) throw new Error('Memory ID mismatch.');
    memories = [...memories, operation.memory];
  } else if (operation.type !== 'delete') throw new Error('Unsupported change.');
  return validateJournal({ version: 1, memories });
}
export class GitHubClient {
  #token;
  constructor(token, settings = config, transport = (...args) => fetch(...args)) {
    this.#token = token;
    this.settings = settings;
    this.transport = transport;
    this.repoPath = `/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`;
  }
  lock() { this.#token = ''; }
  async request(path, options = {}) {
    if (!this.#token) throw new GitHubError('Editing is locked. Unlock your journal again.');
    let response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      response = await this.transport(`https://api.github.com${path}`, {
        ...options,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.#token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
        signal: controller.signal,
      });
    } catch (error) {
      console.warn('GitHub connection failed:', error.name, error.message);
      throw new GitHubError('GitHub could not be reached. If you were saving, refresh the journal to check whether the save completed before retrying.');
    }
    finally { clearTimeout(timeout); }
    if (!response.ok) {
      const errors = {
        401: 'Your repository key is invalid or expired. Lock editing and connect a new key.',
        403: 'GitHub denied this request. Check that your key has Contents: Read and write for this repository, or try again if its request limit was reached.',
        404: 'GitHub could not find the journal. Check that your key includes this repository.',
        409: 'The journal changed while saving. Please try again.',
        422: 'GitHub could not publish this change. Check repository rules and try again.',
      };
      throw new GitHubError(errors[response.status] || `GitHub returned an error (${response.status}). Your changes have not been discarded.`, response.status);
    }
    return response.status === 204 ? null : response.json();
  }
  async authenticate() {
    const user = await this.request('/user');
    if (user.id !== this.settings.ownerId) { this.lock(); throw new Error(`Only ${this.settings.owner} can edit this journal.`); }
    const repo = await this.request(this.repoPath);
    if (!repo.permissions?.push) { this.lock(); throw new Error('This key cannot write to the journal repository.'); }
    return { login: user.login };
  }
  async readLatest() {
    const ref = await this.request(`${this.repoPath}/git/ref/heads/${this.settings.branch}`);
    const commit = await this.request(`${this.repoPath}/git/commits/${ref.object.sha}`);
    const file = await this.request(`${this.repoPath}/contents/${this.settings.dataPath}?ref=${ref.object.sha}`);
    if (file.encoding !== 'base64') throw new Error('The journal is too large to load with this method. Download a backup before adding more.');
    return { head: ref.object.sha, tree: commit.tree.sha, journal: validateJournal(JSON.parse(decodeText(file.content))) };
  }
  async commitOperation(operation, uploads = [], removedPhotos = []) {
    // All files belong to one commit; publish the branch only after everything exists.
    const photoEntries = [];
    for (const photo of uploads) {
      if (!validPhotoPath(photo.path)) throw new Error('Invalid photo path.');
      const blob = await this.request(`${this.repoPath}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: photo.base64, encoding: 'base64' }) });
      photoEntries.push({ path: `site/${photo.path}`, mode: '100644', type: 'blob', sha: blob.sha });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await this.readLatest();
      let journal;
      try { journal = applyOperation(latest.journal, operation); }
      catch (error) { error.latestJournal = latest.journal; throw error; }
      if (journal === latest.journal) return { journal, sha: latest.head, unchanged: true };
      const referenced = new Set(journal.memories.flatMap(m => m.photos.map(p => p.path)));
      const tree = [{ path: this.settings.dataPath, mode: '100644', type: 'blob', content: `${JSON.stringify(journal, null, 2)}\n` }, ...photoEntries];
      const existingPaths = new Set(latest.journal.memories.flatMap(m => m.photos.map(p => p.path)));
      for (const path of removedPhotos) {
        if (validPhotoPath(path) && existingPaths.has(path) && !referenced.has(path)) tree.push({ path: `site/${path}`, mode: '100644', type: 'blob', sha: null });
      }
      const createdTree = await this.request(`${this.repoPath}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: latest.tree, tree }) });
      const title = operation.type === 'delete' ? 'Remove memory' : operation.baseUpdatedAt ? 'Update memory' : 'Add memory';
      const commit = await this.request(`${this.repoPath}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `${title}: ${(operation.memory?.title || operation.title || 'Bangkok').replace(/[\r\n]/g,' ')}`, tree: createdTree.sha, parents: [latest.head] }) });
      try {
        await this.request(`${this.repoPath}/git/refs/heads/${this.settings.branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
        return { journal, sha: commit.sha };
      } catch (error) {
        if (![409,422].includes(error.status) || attempt === 2) throw error;
        const current = await this.request(`${this.repoPath}/git/ref/heads/${this.settings.branch}`);
        if (current.object.sha === latest.head) throw error; // A rule failure, not a concurrent edit.
      }
    }
  }
}
