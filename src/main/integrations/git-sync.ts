import { tr } from './i18n.js';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { GitInfo } from '../../shared/domain/integrations.js';
import type { Settings } from '../../shared/domain/settings.js';
import type { Confirmer, Journal } from './context.js';
import {
  changedFiles,
  commitAndPush,
  commitText,
  fetchRemote,
  inspect,
  pullFastForward,
  realGit,
  type GitRunner,
} from './git.js';

interface ProjectDir {
  id: string;
  name: string;
  directory: string;
}

/**
 * Keeps the projects folder in step with its git remote, always through a confirmation window. It never merges,
 * rebases, forces or resolves anything: when the histories diverged it says so and stops.
 */
export class GitSync {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private lastPull = 0;
  private busy = false;
  private pushTimer?: ReturnType<typeof setTimeout>;
  /** What the person already declined, per folder: not proposed again until the changes differ. */
  private declined = new Map<string, string>();

  constructor(
    private d: {
      settings: () => Settings;
      projects: () => ProjectDir[];
      confirm: Confirmer;
      journal: Journal;
      /** A run is in progress: files are changing, wait. */
      isBusy: () => boolean;
      /** Re-read projects from disk after a pull, so the app never overwrites what came in. */
      reload: () => Promise<void>;
      git?: GitRunner;
    },
  ) {}
  private get git() {
    return this.d.git ?? realGit;
  }
  private cfg() {
    return this.d.settings().integrations.git;
  }
  private tr(fr: string, en: string) {
    return this.d.settings().language === 'en' ? en : fr;
  }

  start() {
    if (this.cfg().pullOnStart) this.later(8000, () => this.checkPull());
    this.heartbeat = setInterval(() => {
      const minutes = this.cfg().pullEveryMinutes;
      if (minutes > 0 && Date.now() - this.lastPull >= minutes * 60000) void this.checkPull();
    }, 60000);
    this.heartbeat.unref?.();
  }
  stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    clearTimeout(this.pushTimer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    t.unref?.();
    this.timers.add(t);
  }

  /** A scenario was created / edited ('content') or a run produced results ('run'). */
  onChange(kind: 'content' | 'run') {
    const c = this.cfg();
    if (kind === 'content' ? !c.pushOnChange : !c.pushOnRun) return;
    clearTimeout(this.pushTimer);
    const fire = () => {
      if (this.d.isBusy()) {
        this.pushTimer = setTimeout(fire, 30000);
        this.pushTimer.unref?.();
        return;
      }
      void this.proposePush();
    };
    this.pushTimer = setTimeout(fire, c.delaySeconds * 1000);
    this.pushTimer.unref?.();
  }

  private async guarded<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (this.busy) return undefined;
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
    }
  }

  /** Fetch, and if the remote is ahead, offer a fast-forward. */
  checkPull() {
    return this.guarded(async () => {
      this.lastPull = Date.now();
      if (this.d.isBusy()) return;
      const roots = new Map<string, { dir: string; info: GitInfo }>();
      for (const p of this.d.projects()) {
        const info = await inspect(p.directory, this.git);
        if (info.isRepo && info.root && !roots.has(info.root))
          roots.set(info.root, { dir: p.directory, info });
      }
      for (const [root, { dir }] of roots) {
        const fetched = await fetchRemote(dir, this.git);
        if (!fetched.ok) {
          this.d.journal.add(
            'git',
            false,
            this.tr(
              `Récupération impossible (${path.basename(root)}) : ${fetched.message.slice(0, 200)}`,
              `Cannot fetch (${path.basename(root)}): ${fetched.message.slice(0, 200)}`,
            ),
          );
          continue;
        }
        const info = await inspect(dir, this.git);
        if (!info.upstream) {
          this.d.journal.add(
            'git',
            true,
            this.tr(
              `${path.basename(root)} : aucune branche distante suivie, rien à récupérer.`,
              `${path.basename(root)}: no upstream branch, nothing to pull.`,
            ),
          );
          continue;
        }
        if (!info.behind) continue;
        if (info.ahead) {
          await this.d.confirm({
            kind: 'git-pull',
            informational: true,
            title: this.tr('Historiques divergents', 'Diverged histories'),
            message: this.tr(
              `La branche ${info.branch} a ${info.ahead} validation(s) locale(s) et ${info.behind} nouvelle(s) sur ${info.upstream}. Cybermonkey ne fusionne rien : résolvez-le avec git, puis revenez.`,
              `Branch ${info.branch} has ${info.ahead} local commit(s) and ${info.behind} new one(s) on ${info.upstream}. Cybermonkey merges nothing: resolve it with git, then come back.`,
            ),
            details: [root],
            confirmLabel: 'OK',
          });
          this.d.journal.add(
            'git',
            false,
            this.tr(
              `${path.basename(root)} : historiques divergents, à résoudre à la main.`,
              `${path.basename(root)}: diverged histories, resolve by hand.`,
            ),
          );
          continue;
        }
        const answer = await this.d.confirm({
          kind: 'git-pull',
          title: this.tr(
            `Récupérer ${info.behind} validation(s) ?`,
            `Pull ${info.behind} commit(s)?`,
          ),
          message: this.tr(
            `Mise à jour de ${info.branch} depuis ${info.upstream} (avance rapide uniquement : rien n’est fusionné, rien n’est écrasé).`,
            `Update ${info.branch} from ${info.upstream} (fast-forward only: nothing is merged, nothing is overwritten).`,
          ),
          details: [root],
          confirmLabel: this.tr('Récupérer', 'Pull'),
        });
        if (!answer) {
          this.d.journal.add(
            'git',
            true,
            this.tr(
              'Récupération proposée mais aucune fenêtre pour répondre : ignorée.',
              'Pull offered but no window to answer: skipped.',
            ),
          );
          continue;
        }
        if (!answer.accepted) continue;
        const result = await pullFastForward(dir, this.git);
        if (result.ok) await this.d.reload();
        else if (result.conflict)
          await this.d.confirm({
            kind: 'git-pull',
            informational: true,
            title: this.tr('Récupération impossible', 'Cannot pull'),
            message: this.tr(
              'Des changements locaux ou divergents empêchent l’avance rapide. Rien n’a été modifié : résolvez-le avec git.',
              'Local or diverging changes prevent a fast-forward. Nothing was modified: resolve it with git.',
            ),
            details: [result.message],
            confirmLabel: 'OK',
          });
        this.d.journal.add('git', result.ok, `${path.basename(root)} : ${result.message}`);
      }
    });
  }

  /** Offer to commit and push each project folder that has changes. */
  proposePush() {
    return this.guarded(async () => {
      const c = this.cfg();
      for (const p of this.d.projects()) {
        if (this.d.isBusy()) return;
        const info = await inspect(p.directory, this.git);
        if (!info.isRepo) continue;
        const files = await changedFiles(p.directory, c.includeMedia, this.git).catch(() => []);
        if (!files.length) continue;
        const signature = createHash('sha1').update(files.join('\n')).digest('hex');
        if (this.declined.get(p.directory) === signature) continue;
        const summary = `${p.name} (${files.length} ${this.tr('fichier', 'file')}${files.length > 1 ? 's' : ''})`;
        const target =
          info.upstream ??
          `${info.remote ?? 'origin'}/${info.branch ?? 'HEAD'} (${this.tr('nouvelle branche distante', 'new remote branch')})`;
        const answer = await this.d.confirm({
          kind: 'git-push',
          title: this.tr(`Envoyer « ${p.name} » sur git ?`, `Push “${p.name}” to git?`),
          message: this.tr(
            `${files.length} fichier(s) modifié(s) seront validés puis poussés vers ${target}. Aucun envoi forcé.`,
            `${files.length} changed file(s) will be committed and pushed to ${target}. Never forced.`,
          ),
          details: [
            ...files.slice(0, 12),
            ...(files.length > 12 ? [`… et ${files.length - 12} autre(s)`] : []),
            ...(c.includeMedia
              ? []
              : [
                  this.tr(
                    'Captures et vidéos exclues (réglable).',
                    'Screenshots and videos excluded (configurable).',
                  ),
                ]),
          ],
          editable: {
            label: this.tr('Message de validation', 'Commit message'),
            value: commitText(c.commitMessage, summary),
            rows: 2,
          },
          confirmLabel: this.tr('Valider et pousser', 'Commit and push'),
        });
        if (!answer) {
          this.d.journal.add(
            'git',
            true,
            this.tr(
              'Envoi proposé mais aucune fenêtre pour répondre : ignoré.',
              'Push offered but no window to answer: skipped.',
            ),
          );
          return;
        }
        if (!answer.accepted) {
          this.declined.set(p.directory, signature);
          continue;
        }
        const result = await commitAndPush(
          p.directory,
          (answer.edited ?? '').trim() || commitText(c.commitMessage, summary),
          c.includeMedia,
          this.git,
        );
        this.declined.delete(p.directory);
        this.d.journal.add('git', result.ok, `${p.name} : ${result.message}`);
        if (!result.ok)
          await this.d.confirm({
            kind: 'git-push',
            informational: true,
            title: this.tr('Envoi non terminé', 'Push not completed'),
            message: result.message,
            details: [],
            confirmLabel: 'OK',
          });
      }
    });
  }
}
