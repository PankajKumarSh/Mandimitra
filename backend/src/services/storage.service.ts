import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { AttachmentPurpose, PrismaClient } from '@mandimitra/database';
import type { Env } from '../config/env.ts';

/**
 * File storage behind an Attachment row. Keys are generated server-side ({businessId}/{purpose}/{uuid})
 * so user input never becomes a path. Local disk for development / a single server; any S3-compatible
 * bucket (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces) in production. The bucket must be private —
 * files are only ever served through the API after a tenant check.
 */
export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export class LocalDiskStore implements BlobStore {
  private readonly root: string;
  constructor(dir: string) {
    this.root = path.resolve(dir);
  }
  private file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.file(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  get(key: string) {
    return readFile(this.file(key));
  }
}

export class S3Store implements BlobStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly sse: boolean;
  constructor(cfg: { bucket: string; region: string; accessKeyId: string; secretAccessKey: string; endpoint?: string; forcePathStyle?: boolean }) {
    this.bucket = cfg.bucket;
    // SSE-S3 is an AWS feature; other S3-compatible stores encrypt at rest by their own settings.
    this.sse = !cfg.endpoint;
    this.client = new S3Client({
      region: cfg.region,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      forcePathStyle: cfg.forcePathStyle ?? false,
    });
  }
  async put(key: string, data: Buffer) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ...(this.sse ? { ServerSideEncryption: 'AES256' as const } : {}) }));
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!r.Body) throw new Error('Empty object body');
    return Buffer.from(await r.Body.transformToByteArray());
  }
}

export function blobStoreFromEnv(env: Env): BlobStore {
  if (env.STORAGE_DRIVER === 's3') {
    return new S3Store({
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return new LocalDiskStore(env.UPLOAD_DIR);
}

export class StorageService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly store: BlobStore,
  ) {}

  async save(args: { businessId: string; uploadedById: string; purpose: AttachmentPurpose; data: Buffer; mimeType: string; fileName: string }) {
    const ext = (args.fileName.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? '').toLowerCase();
    const storageKey = `${args.businessId}/${args.purpose.toLowerCase()}/${randomUUID()}${ext}`;
    await this.store.put(storageKey, args.data);
    return this.prisma.attachment.create({
      data: {
        businessId: args.businessId,
        purpose: args.purpose,
        storageKey,
        fileName: args.fileName.slice(0, 200),
        mimeType: args.mimeType,
        sizeBytes: args.data.length,
        sha256: createHash('sha256').update(args.data).digest('hex'),
        uploadedById: args.uploadedById,
      },
    });
  }

  read(storageKey: string) {
    return this.store.get(storageKey);
  }
}
