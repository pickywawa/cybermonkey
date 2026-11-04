import { tr } from './i18n.js';
import { promises as fs } from 'node:fs';
import type { GitInfo } from '../../shared/domain/integrations.js';
import { command } from '../infra/env.js';

/** Runs `git <args>` in `cwd`, rejects with git's own message. Replaced by a fake in tests. */
export type GitRunner = (args: string[], cwd: string, timeoutMs?: number) => Promise<string>;

export const realGit: GitRunner = async (args, cwd, timeoutMs = 30000) =>
  (
    await command('git', args, {
      cwd,
      timeout: timeoutMs,
      // Never wait for a password on a terminal that does not exist: fail with a clear message instead.
      env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' },
    })
  ).toString();

const MEDIA_EXCLUDE = ':(exclude,glob)**/captures/**';
const scope = (includeMedia: boolean) => ['.', ...(includeMedia ? [] : [MEDIA_EXCLUDE])];

export async function inspect(dir: string, git: GitRunner = realGit): Promise<GitInfo> {
  // A folder that does not exist makes the spawn fail with ENOENT too: tell it apart from a missing git.
  const folder = await fs.stat(dir).catch(() => null);
  if (!folder?.isDirectory())
    return { isRepo: false, error: tr('Dossier introuvable.', 'Folder not found.') };
  let root: string;
  try {
    root = (await git(['rev-parse', '--show-toplevel'], dir)).trim();
  } catch (error) {
    const message = String((error as Error).message);
    if (/ENOENT|not found|n'est pas reconnu|spawn git/i.test(message))
      return {
        isRepo: false,
        error: tr('git est introuvable sur cette machine.', 'git was not found on this machine.'),
      };
    if (/no such file|cannot change to|not a directory|ENOTDIR/i.test(message))
      return { isRepo: false, error: tr('Dossier introuvable.', 'Folder not found.') };
    return { isRepo: false };
  }
  const info: GitInfo = { isRepo: true, root };
  const attempt = async (args: string[]) => {
    try {
      return (await git(args, dir)).trim();
    } catch {
      return undefined;
    }
  };
  info.branch = await attempt(['rev-parse', '--abbrev-ref', 'HEAD']);
  info.upstream = await attempt(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  info.remote =
    (info.branch && (await attempt(['config', `branch.${info.branch}.remote`]))) ||
    (await attempt(['remote']))?.split(/\s+/)[0] ||
    undefined;
  const status = await attempt(['status', '--porcelain', '-uall', '--', '.']);
  info.changes = status ? status.split('\n').filter(Boolean).length : 0;
  if (info.upstream) {
    const counts = await attempt(['rev-list', '--left-right', '--count', '@{u}...HEAD']);
    const [behind, ahead] = (counts ?? '').split(/\s+/).map(Number);
    if (Number.isFinite(behind)) info.behind = behind;
    if (Number.isFinite(ahead)) info.ahead = ahead;
  }
  return info;
}

/** Remote → local counters, after a fetch. A failed fetch (offline, no credentials) is reported, not thrown. */
export async function fetchRemote(dir: string, git: GitRunner = realGit) {
  try {
    await git(['fetch', '--quiet'], dir, 60000);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: String((error as Error).message) };
  }
}

export interface PullResult {
  ok: boolean;
  message: string;
  /** The histories diverged (or local edits block the update): the person must resolve it. Nothing was touched. */
  conflict?: boolean;
}
/**
 * Fast-forward only. Anything that would need a merge or a rebase is left alone and reported: resolving conflicts
 * is the person's job, with their own tools.
 */
export async function pullFastForward(dir: string, git: GitRunner = realGit): Promise<PullResult> {
  try {
    const out = await git(['pull', '--ff-only'], dir, 120000);
    return {
      ok: true,
      message: out.trim().split('\n').slice(-1)[0] || tr('À jour.', 'Up to date.'),
    };
  } catch (error) {
    const message = String((error as Error).message);
    const conflict =
      /not possible to fast-forward|diverg|overwritten by merge|would be overwritten|local changes/i.test(
        message,
      );
    return { ok: false, conflict, message: message.replace(/^git: /, '').slice(0, 600) };
  }
}

/** Changed files under `dir`, as `XY path` lines (index/work-tree codes kept for readability). */
export async function changedFiles(
  dir: string,
  includeMedia: boolean,
  git: GitRunner = realGit,
): Promise<string[]> {
  const out = await git(['status', '--porcelain', '-uall', '--', ...scope(includeMedia)], dir);
  return out.split('\n').filter(Boolean);
}

export interface PushResult {
  ok: boolean;
  committed: boolean;
  message: string;
  /** The remote moved on: pull first. The commit stays local. */
  rejected?: boolean;
}
export async function commitAndPush(
  dir: string,
  message: string,
  includeMedia: boolean,
  git: GitRunner = realGit,
): Promise<PushResult> {
  // Files already staged by the person are theirs: committing them along would be a surprise.
  const staged = (await git(['diff', '--cached', '--name-only'], dir)).trim();
  if (staged)
    return {
      ok: false,
      committed: false,
      message: tr(
        'Des fichiers sont déjà indexés (git add) : validez-les ou annulez-les, puis réessayez.',
        'Some files are already staged (git add): commit or unstage them, then try again.',
      ),
    };
  await git(['add', '-A', '--', ...scope(includeMedia)], dir, 60000);
  if (!(await git(['diff', '--cached', '--name-only'], dir)).trim())
    return { ok: true, committed: false, message: tr('Rien à valider.', 'Nothing to commit.') };
  try {
    await git(['commit', '-m', message], dir, 60000);
  } catch (error) {
    // Leave the index as it was found.
    await git(['reset', '--quiet'], dir).catch(() => {});
    return {
      ok: false,
      committed: false,
      message: String((error as Error).message)
        .replace(/^git: /, '')
        .slice(0, 600),
    };
  }
  const info = await inspect(dir, git);
  try {
    await git(
      info.upstream
        ? ['push']
        : ['push', '--set-upstream', info.remote ?? 'origin', info.branch ?? 'HEAD'],
      dir,
      120000,
    );
    return {
      ok: true,
      committed: true,
      message: tr('Poussé vers ', 'Pushed to ') + (info.upstream ?? info.remote ?? 'origin') + '.',
    };
  } catch (error) {
    const text = String((error as Error).message);
    const rejected = /rejected|non-fast-forward|fetch first|failed to push some refs/i.test(text);
    return {
      ok: false,
      committed: true,
      rejected,
      message: rejected
        ? tr(
            'Le dépôt distant a évolué : récupérez ses changements (pull) puis réessayez. Votre validation reste en local.',
            'The remote moved on: pull its changes, then try again. Your commit stays local.',
          )
        : text.replace(/^git: /, '').slice(0, 600),
    };
  }
}

export const commitText = (template: string, summary: string) =>
  (template || 'Cybermonkey : {summary}').replace(/\{summary\}/g, summary).slice(0, 200);
