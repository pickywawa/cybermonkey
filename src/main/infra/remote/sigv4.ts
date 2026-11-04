import { createHash, createHmac } from 'node:crypto';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();
const encode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );

/**
 * AWS Signature Version 4 for a request with a JSON / form body. Returns the headers to add (Authorization,
 * X-Amz-Date, X-Amz-Security-Token when there is a session token). No SDK to ship, and the algorithm is checked
 * against AWS's published example in the tests.
 */
export function signV4(o: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string | Buffer;
  region: string;
  service: string;
  credentials: AwsCredentials;
  now?: Date;
}): Record<string, string> {
  const now = o.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...o.headers, 'x-amz-date': amzDate };
  if (o.credentials.sessionToken) headers['x-amz-security-token'] = o.credentials.sessionToken;
  // A request always carries its own Host: it is part of what is signed.
  const lower = Object.fromEntries(
    Object.entries({ host: o.url.host, ...headers }).map(([k, v]) => [
      k.toLowerCase(),
      String(v).trim().replace(/\s+/g, ' '),
    ]),
  );
  const names = Object.keys(lower).sort();
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  // Services other than S3 encode each path segment twice.
  const path =
    o.url.pathname
      .split('/')
      .map((segment) => encode(encode(decodeURIComponent(segment))))
      .join('/') || '/';
  const query = [...o.url.searchParams.entries()]
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonical = [
    o.method.toUpperCase(),
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    sha256(o.body),
  ].join('\n');
  const scope = `${day}/${o.region}/${o.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(
    hmac(hmac(hmac('AWS4' + o.credentials.secretAccessKey, day), o.region), o.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${o.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
