import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Config } from '../config';

/**
 * Where files live (spec 12.2): import files now, photos, receipts and exports later. Keys start
 * with the tenant, `t/<tenant>/...`, so a lifecycle rule or a tenant's deletion can find them.
 */
export abstract class ObjectStore {
  abstract put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  abstract get(key: string): Promise<Uint8Array>;
  abstract delete(key: string): Promise<void>;
}

/** Amazon S3, or MinIO standing in for it locally. */
export class S3ObjectStore extends ObjectStore implements OnModuleInit {
  private readonly logger = new Logger(S3ObjectStore.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: Config) {
    super();
    this.bucket = config.S3_BUCKET!;
    this.client = new S3Client({
      region: config.S3_REGION,
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT, forcePathStyle: true } : {}),
      ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: config.S3_ACCESS_KEY_ID,
              secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }

  /** Locally the bucket may not exist yet; in AWS, infrastructure creates it. */
  async onModuleInit(): Promise<void> {
    if (!this.config.S3_ENDPOINT) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (error) {
        // Imports fail until it can; the rest of the API carries on.
        this.logger.warn(`Could not create bucket ${this.bucket}: ${(error as Error).message}`);
      }
    }
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!object.Body) throw new Error(`${key} has no body.`);
    return object.Body.transformToByteArray();
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** Files kept in memory, for tests. */
export class MemoryObjectStore extends ObjectStore {
  private readonly files = new Map<string, Uint8Array>();

  async put(key: string, body: Uint8Array): Promise<void> {
    this.files.set(key, body);
  }

  async get(key: string): Promise<Uint8Array> {
    const body = this.files.get(key);
    if (!body) throw new Error(`There is no ${key}.`);
    return body;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
}

export function createObjectStore(config: Config): ObjectStore {
  return config.OBJECT_STORE === 'memory' ? new MemoryObjectStore() : new S3ObjectStore(config);
}
