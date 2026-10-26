import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Config } from '../config';

/**
 * Where files live (spec 12.2): import files now, photos, receipts and exports later. Keys start
 * with the tenant, `t/<tenant>/...`, so a lifecycle rule or a tenant's deletion can find them.
 */
export abstract class ObjectStore {
  abstract put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Stores a file from disk without reading it into memory, such as a tenant's archive. */
  abstract putFile(key: string, path: string, contentType: string): Promise<void>;
  abstract get(key: string): Promise<Uint8Array>;
  abstract delete(key: string): Promise<void>;
  /** The object's size, or null when there is none. */
  abstract size(key: string): Promise<number | null>;
  /**
   * A URL a phone can PUT the bytes to, for `seconds`, pinning their type, length and SHA-256,
   * so storage refuses anything else (spec 12.2). The upload must send `headers`.
   */
  abstract presignPut(key: string, file: PresignedFile, seconds: number): Promise<PresignedPut>;
  /** A URL that reads the object for `seconds`. */
  abstract presignGet(key: string, seconds: number): Promise<string>;
}

export interface PresignedFile {
  contentType: string;
  size: number;
  /** Lowercase hexadecimal, as the phone computes it. */
  sha256: string;
  /** The tags lifecycle rules delete it by, such as `retention=evidence-12m`. */
  tagging: string;
}

export interface PresignedPut {
  url: string;
  headers: Record<string, string>;
}

/** S3's checksum header carries base64; phones and the API speak hexadecimal. */
export function base64Checksum(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64');
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

  async putFile(key: string, path: string, contentType: string): Promise<void> {
    const { size } = await stat(path);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(path),
        ContentLength: size,
        ContentType: contentType,
      }),
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

  async size(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? null;
    } catch (error) {
      if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound')
        return null;
      throw error;
    }
  }

  async presignPut(key: string, file: PresignedFile, seconds: number): Promise<PresignedPut> {
    const checksum = base64Checksum(file.sha256);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: file.contentType,
      ContentLength: file.size,
      ChecksumSHA256: checksum,
      Tagging: file.tagging,
    });
    const headers = {
      'content-type': file.contentType,
      'content-length': String(file.size),
      'x-amz-checksum-sha256': checksum,
      'x-amz-tagging': file.tagging,
    };
    // Every pinned header is signed, so an upload that changes one is refused.
    const url = await getSignedUrl(this.client, command, {
      expiresIn: seconds,
      signableHeaders: new Set(Object.keys(headers)),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256', 'x-amz-tagging']),
    });
    return { url, headers };
  }

  async presignGet(key: string, seconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: seconds,
    });
  }
}

/** Files kept in memory, for tests. */
export class MemoryObjectStore extends ObjectStore {
  private readonly files = new Map<string, Uint8Array>();

  async put(key: string, body: Uint8Array): Promise<void> {
    this.files.set(key, body);
  }

  async putFile(key: string, path: string): Promise<void> {
    this.files.set(key, new Uint8Array(await readFile(path)));
  }

  async get(key: string): Promise<Uint8Array> {
    const body = this.files.get(key);
    if (!body) throw new Error(`There is no ${key}.`);
    return body;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  async size(key: string): Promise<number | null> {
    return this.files.get(key)?.byteLength ?? null;
  }

  private readonly expected = new Map<string, PresignedFile>();

  async presignPut(key: string, file: PresignedFile): Promise<PresignedPut> {
    this.expected.set(key, file);
    return {
      url: `https://memory.store.test/${key}`,
      headers: {
        'content-type': file.contentType,
        'content-length': String(file.size),
        'x-amz-checksum-sha256': base64Checksum(file.sha256),
      },
    };
  }

  async presignGet(key: string): Promise<string> {
    return `https://memory.store.test/${key}?signed=1`;
  }

  /**
   * What a phone's upload to a presigned URL does, as S3 would: refused unless its length and
   * checksum are the ones signed for. For tests.
   */
  receive(url: string, body: Uint8Array): void {
    const key = new URL(url).pathname.slice(1);
    const file = this.expected.get(key);
    if (!file) throw new Error(`Nothing may be sent to ${key}.`);
    const sha256 = createHash('sha256').update(body).digest('hex');
    if (body.byteLength !== file.size || sha256 !== file.sha256) {
      throw new Error('Storage refuses bytes that are not the ones signed for.');
    }
    this.files.set(key, body);
  }
}

export function createObjectStore(config: Config): ObjectStore {
  return config.OBJECT_STORE === 'memory' ? new MemoryObjectStore() : new S3ObjectStore(config);
}
