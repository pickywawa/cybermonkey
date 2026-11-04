import { tr } from './i18n.js';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

export interface Attachment {
  filename: string;
  contentType: string;
  data: Buffer;
}
export interface MailOptions {
  host: string;
  port: number;
  security: 'none' | 'starttls' | 'tls';
  username?: string;
  password?: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  attachments?: Attachment[];
  timeoutMs?: number;
  /** Tests only: a self-signed server. */
  rejectUnauthorized?: boolean;
}

const wrap = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');
/** RFC 2047: non-ASCII subjects travel as an encoded word. */
const subject = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
export const addressOf = (value: string) => {
  const m = value.match(/<([^<>\s]+)>/);
  return (m ? m[1] : value).trim();
};
const validAddress = (a: string) =>
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$|^[^\s@<>]+@localhost$/.test(a);
const safeHeader = (s: string) => s.replace(/[\r\n]+/g, ' ');

export function buildMessage(o: MailOptions, boundary = '=_cm_' + randomUUID()): string {
  const head = [
    `From: ${safeHeader(o.from)}`,
    `To: ${o.to.map(safeHeader).join(', ')}`,
    `Subject: ${subject(safeHeader(o.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@cybermonkey>`,
    'MIME-Version: 1.0',
  ];
  const textPart = (type: string) =>
    `Content-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64(o.text))}`;
  if (!o.attachments?.length) return head.join('\r\n') + '\r\n' + textPart('text/plain') + '\r\n';
  const parts = [`--${boundary}\r\n${textPart('text/plain')}`];
  for (const a of o.attachments)
    parts.push(
      `--${boundary}\r\nContent-Type: ${a.contentType}; name="${safeHeader(a.filename)}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${safeHeader(a.filename)}"\r\n\r\n${wrap(b64(a.data))}`,
    );
  return (
    head.join('\r\n') +
    `\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    parts.join('\r\n') +
    `\r\n--${boundary}--\r\n`
  );
}

interface Reply {
  code: number;
  text: string;
}
class Session {
  private buffer = '';
  private queue: Reply[] = [];
  private lines: string[] = [];
  private waiting?: { resolve: (r: Reply) => void; reject: (e: Error) => void };
  private failure?: Error;
  constructor(
    readonly socket: net.Socket,
    private timeoutMs: number,
  ) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\r\n')) >= 0) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 2);
        this.lines.push(line);
        const m = line.match(/^(\d{3})([ -])/);
        if (m && m[2] === ' ') {
          const reply = { code: Number(m[1]), text: this.lines.join('\n') };
          this.lines = [];
          if (this.waiting) {
            const w = this.waiting;
            this.waiting = undefined;
            w.resolve(reply);
          } else this.queue.push(reply);
        }
      }
    });
    const fail = (e: Error) => {
      this.failure = e;
      this.waiting?.reject(e);
      this.waiting = undefined;
    };
    socket.on('error', fail);
    socket.on('close', () =>
      fail(
        new Error(
          tr('Connexion SMTP fermée par le serveur', 'SMTP connection closed by the server'),
        ),
      ),
    );
  }
  reply(): Promise<Reply> {
    const ready = this.queue.shift();
    if (ready) return Promise.resolve(ready);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(tr('Délai SMTP dépassé', 'SMTP timeout'))),
        this.timeoutMs,
      );
      this.waiting = {
        resolve: (r) => (clearTimeout(timer), resolve(r)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      };
    });
  }
  async command(line: string, expect: number[], secret = false): Promise<Reply> {
    this.socket.write(line + '\r\n');
    const reply = await this.reply();
    if (!expect.includes(reply.code))
      throw new Error(
        `SMTP ${secret ? tr('(identifiants)', '(credentials)') : line.split(' ')[0]} : ${reply.text.replace(/\s+/g, ' ').slice(0, 200)}`,
      );
    return reply;
  }
}

/** Minimal SMTP client (EHLO, STARTTLS / implicit TLS, AUTH PLAIN or LOGIN, one message). No dependency to ship. */
export async function sendMail(o: MailOptions): Promise<void> {
  const to = o.to.map(addressOf);
  const from = addressOf(o.from);
  if (!validAddress(from))
    throw new Error(`${tr('Adresse d’expéditeur invalide', 'Invalid sender address')} : ${o.from}`);
  if (!to.length) throw new Error(tr('Aucun destinataire', 'No recipient'));
  for (const a of to)
    if (!validAddress(a))
      throw new Error(
        `${tr('Adresse de destinataire invalide', 'Invalid recipient address')} : ${a}`,
      );
  const local = ['localhost', '127.0.0.1', '::1'].includes(o.host);
  if (o.username && o.security === 'none' && !local)
    throw new Error(
      tr(
        'Refus d’envoyer un mot de passe sans chiffrement : choisissez STARTTLS ou TLS.',
        'Refusing to send a password without encryption: choose STARTTLS or TLS.',
      ),
    );
  const timeoutMs = o.timeoutMs ?? 20000;
  const tlsOptions = {
    host: o.host,
    servername: o.host,
    rejectUnauthorized: o.rejectUnauthorized ?? true,
  };

  const connect = (): Promise<net.Socket> =>
    new Promise((resolve, reject) => {
      const socket =
        o.security === 'tls'
          ? tls.connect({ ...tlsOptions, port: o.port }, () => resolve(socket))
          : net.connect({ host: o.host, port: o.port }, () => resolve(socket));
      socket.setTimeout(timeoutMs, () =>
        socket.destroy(
          new Error(tr('Connexion SMTP : délai dépassé', 'SMTP connection: timed out')),
        ),
      );
      socket.once('error', reject);
    });

  let session = new Session(await connect(), timeoutMs);
  try {
    const greeting = await session.reply();
    if (greeting.code !== 220) throw new Error('SMTP : ' + greeting.text.slice(0, 200));
    let ehlo = await session.command('EHLO cybermonkey.local', [250]);
    if (o.security === 'starttls') {
      if (!/STARTTLS/i.test(ehlo.text))
        throw new Error(
          tr('Le serveur ne propose pas STARTTLS', 'The server does not offer STARTTLS'),
        );
      await session.command('STARTTLS', [220]);
      const secured = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const s = tls.connect({ ...tlsOptions, socket: session.socket }, () => resolve(s));
        s.once('error', reject);
      });
      session = new Session(secured, timeoutMs);
      ehlo = await session.command('EHLO cybermonkey.local', [250]);
    }
    if (o.username) {
      const password = o.password ?? '';
      if (/AUTH[^\n]*PLAIN/i.test(ehlo.text) || !/AUTH[^\n]*LOGIN/i.test(ehlo.text)) {
        await session.command(`AUTH PLAIN ${b64(`\0${o.username}\0${password}`)}`, [235], true);
      } else {
        await session.command('AUTH LOGIN', [334], true);
        await session.command(b64(o.username), [334], true);
        await session.command(b64(password), [235], true);
      }
    }
    await session.command(`MAIL FROM:<${from}>`, [250]);
    for (const a of to) await session.command(`RCPT TO:<${a}>`, [250, 251]);
    await session.command('DATA', [354]);
    session.socket.write(buildMessage({ ...o, from: o.from, to: o.to }) + '.\r\n');
    const done = await session.reply();
    if (done.code !== 250)
      throw new Error(
        tr('SMTP : message refusé — ', 'SMTP: message rejected — ') + done.text.slice(0, 200),
      );
    await session.command('QUIT', [221]).catch(() => {});
  } finally {
    session.socket.destroy();
  }
}
