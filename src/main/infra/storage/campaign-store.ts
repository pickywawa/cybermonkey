import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  campaignSchema,
  type Campaign,
  type CampaignDetail,
  type RunReport,
} from '../../../shared/domain/report.js';
import { Queue, readJson, writeJson } from './atomic.js';

const uuid = z.string().uuid();
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/** campaigns/<id>/{campaign.json, reports/<run>.json, captures/<run>-<entry>.png} */
export class CampaignStore {
  private queue = new Queue();
  constructor(private projectDirectory: (projectId: string) => string) {}

  private dir(projectId: string, campaignId: string) {
    uuid.parse(campaignId);
    return path.join(this.projectDirectory(projectId), 'campaigns', campaignId);
  }
  async list(projectId: string): Promise<Campaign[]> {
    const root = path.join(this.projectDirectory(projectId), 'campaigns');
    const ids = await fs.readdir(root).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)));
    const campaigns = await Promise.all(
      ids
        .filter((id) => uuid.safeParse(id).success)
        .map(async (id) => {
          try {
            const c = campaignSchema.parse(await readJson(path.join(root, id, 'campaign.json')));
            return c.projectId === projectId && c.id === id ? c : null;
          } catch {
            return null;
          }
        }),
    );
    return campaigns
      .filter((c): c is Campaign => !!c)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async create(projectId: string, label?: string) {
    const now = new Date().toISOString();
    const campaign = campaignSchema.parse({
      id: randomUUID(),
      projectId,
      createdAt: now,
      updatedAt: now,
      status: 'open',
      label: label || 'Campagne ' + new Date().toLocaleString('fr-FR'),
    });
    await this.queue.run(async () => {
      const directory = this.dir(projectId, campaign.id);
      await fs.mkdir(directory, { recursive: true });
      await writeJson(path.join(directory, 'campaign.json'), campaign);
    });
    return campaign;
  }
  async load(projectId: string, campaignId: string): Promise<CampaignDetail> {
    const directory = this.dir(projectId, campaignId);
    const campaign = campaignSchema.parse(await readJson(path.join(directory, 'campaign.json')));
    if (campaign.projectId !== projectId || campaign.id !== campaignId)
      throw new Error('Campagne incohérente');
    const files = await fs
      .readdir(path.join(directory, 'reports'))
      .catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)));
    const reports = await Promise.all(
      files
        .filter((f) => /^[a-zA-Z0-9-]+\.json$/.test(f))
        .map(async (f) => {
          const report = await readJson<RunReport>(path.join(directory, 'reports', f));
          if (
            report.projectId !== projectId ||
            report.campaignId !== campaignId ||
            report.id + '.json' !== f ||
            !Array.isArray(report.entries)
          )
            throw new Error('Rapport incohérent');
          return report;
        }),
    );
    return { campaign, reports: reports.sort((a, b) => a.startedAt.localeCompare(b.startedAt)) };
  }
  update(
    projectId: string,
    campaignId: string,
    patch: { label?: string; status?: Campaign['status'] },
  ) {
    return this.queue.run(async () => {
      const { campaign } = await this.load(projectId, campaignId);
      const next = campaignSchema.parse({
        ...campaign,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
      await writeJson(path.join(this.dir(projectId, campaignId), 'campaign.json'), next);
      return next;
    });
  }
  clean(projectId: string, campaignId?: string) {
    return this.queue.run(async () => {
      const campaigns = campaignId
        ? [(await this.load(projectId, campaignId)).campaign]
        : await this.list(projectId);
      for (const c of campaigns) {
        const directory = this.dir(projectId, c.id);
        await fs.rm(path.join(directory, 'reports'), { recursive: true, force: true });
        await fs.rm(path.join(directory, 'captures'), { recursive: true, force: true });
        await writeJson(path.join(directory, 'campaign.json'), {
          ...c,
          status: 'open',
          updatedAt: new Date().toISOString(),
        });
      }
    });
  }
  async saveCapture(
    report: Pick<RunReport, 'id' | 'projectId' | 'campaignId'>,
    entryId: string,
    image: string,
  ) {
    uuid.parse(report.id);
    uuid.parse(entryId);
    if (!report.campaignId) throw new Error('Rapport sans campagne');
    if (!PNG.test(image)) throw new Error('Format de capture invalide');
    const directory = path.join(this.dir(report.projectId, report.campaignId), 'captures');
    await fs.mkdir(directory, { recursive: true });
    const file = `${report.id}-${entryId}.png`;
    try {
      await fs.writeFile(path.join(directory, file), Buffer.from(image.slice(22), 'base64'), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    return 'capture:' + file;
  }
  async saveReport(report: RunReport) {
    if (!report.campaignId) throw new Error('Rapport sans campagne');
    uuid.parse(report.id);
    const directory = path.join(this.dir(report.projectId, report.campaignId), 'reports');
    await fs.mkdir(directory, { recursive: true });
    const copy = structuredClone(report);
    for (const e of copy.entries)
      if (e.screenshot?.startsWith('data:image/png;base64,'))
        e.screenshot = await this.saveCapture(report, e.id, e.screenshot);
    await writeJson(path.join(directory, report.id + '.json'), copy);
  }
  async screenshot(input: {
    projectId: string;
    campaignId: string;
    runId: string;
    entryId: string;
  }) {
    uuid.parse(input.runId);
    uuid.parse(input.entryId);
    try {
      const buffer = await fs.readFile(
        path.join(
          this.dir(input.projectId, input.campaignId),
          'captures',
          `${input.runId}-${input.entryId}.png`,
        ),
      );
      return 'data:image/png;base64,' + buffer.toString('base64');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      return null;
    }
  }
}
