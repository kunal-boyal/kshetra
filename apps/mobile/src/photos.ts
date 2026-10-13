import { ApiError, NetworkError } from '@kshetra/api-client';
import type { Outbox, OutboxSender, SqlDatabase, SyncRunner } from '@kshetra/api-client/sync';
import {
  type MediaFix,
  MediaResult,
  type MediaSource,
  newId,
  type PhotoKind,
  PresignMediaResult,
} from '@kshetra/shared';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { fetch } from 'expo/fetch';
import type { MobileClient } from './client';

/** Photos are sent at most this many pixels on the long side, as JPEG at 0.7 (spec 12.2). */
const LONG_SIDE_PX = 1600;
const JPEG_QUALITY = 0.7;

/** A photo ready to upload, kept in the app's own storage until it has. */
export interface PreparedPhoto {
  id: string;
  uri: string;
  size: number;
  sha256: string;
}

/** What a photo's upload carries in the outbox. */
export interface PhotoUpload extends PreparedPhoto {
  kind: PhotoKind;
  capturedAt: string;
  source: MediaSource;
  fix: MediaFix | null;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The app's folder for photos waiting to upload; nothing else reads it. */
function folder(): Directory {
  const directory = new Directory(Paths.document, 'photos');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/**
 * Step 1 of spec 12.2: the camera's photo resized to 1,600 px on the long side, saved as JPEG at
 * 0.7, moved into app storage, with its size and SHA-256.
 */
export async function preparePhoto(photo: {
  uri: string;
  width: number;
  height: number;
}): Promise<PreparedPhoto> {
  const id = newId();
  const context = ImageManipulator.manipulate(photo.uri);
  if (Math.max(photo.width, photo.height) > LONG_SIDE_PX) {
    context.resize(
      photo.width >= photo.height ? { width: LONG_SIDE_PX } : { height: LONG_SIDE_PX },
    );
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  const file = new File(saved.uri);
  const kept = new File(folder(), `${id}.jpg`);
  file.move(kept);
  const bytes = await kept.bytes();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return { id, uri: kept.uri, size: bytes.byteLength, sha256: hex(digest) };
}

/** Queues a prepared photo's upload; the outbox sends it when there is signal (spec 11.3). */
export async function queuePhoto(
  sync: { db: SqlDatabase; outbox: Outbox; runner: SyncRunner },
  owner: string,
  upload: PhotoUpload,
): Promise<void> {
  await sync.db.transaction((tx) =>
    sync.outbox.enqueue(tx, { id: upload.id, owner, kind: 'media.upload', payload: upload }),
  );
  await sync.runner.refresh();
  void sync.runner.sync();
}

/**
 * Steps 2 and 3: register, upload straight to storage unless it is there already, confirm. The
 * phone's copy goes once the server has the photo. Storage refusing the bytes (400) means the
 * file no longer matches its checksum, which no retry mends; anything else is tried again, with a
 * fresh link.
 */
export function photoSender(client: Pick<MobileClient, 'request'>): OutboxSender {
  return {
    async send(payload) {
      const photo = payload as PhotoUpload;
      const presigned = await client.request('POST', '/v1/media/presign', PresignMediaResult, {
        body: {
          id: photo.id,
          kind: photo.kind,
          contentType: 'image/jpeg',
          size: photo.size,
          sha256: photo.sha256,
        },
      });
      if (presigned?.upload) {
        // The platform sets the length itself, to the file's, which is the one signed for.
        const headers = Object.fromEntries(
          Object.entries(presigned.upload.headers).filter(([name]) => name !== 'content-length'),
        );
        let response: Response;
        try {
          response = (await fetch(presigned.upload.url, {
            method: 'PUT',
            headers,
            body: new File(photo.uri),
          })) as unknown as Response;
        } catch (error) {
          throw new NetworkError(error);
        }
        if (response.status === 400) {
          throw new ApiError(400, 'VALIDATION', "Storage refused the photo's bytes.");
        }
        if (!response.ok) throw new NetworkError(new Error(`Storage answered ${response.status}.`));
      }
      await client.request('POST', `/v1/media/${photo.id}/confirm`, MediaResult, {
        body: { capturedAt: photo.capturedAt, source: photo.source, fix: photo.fix },
      });
      removeFile(photo.uri);
    },
    async discard(payload) {
      removeFile((payload as PhotoUpload).uri);
    },
  };
}

function removeFile(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}
