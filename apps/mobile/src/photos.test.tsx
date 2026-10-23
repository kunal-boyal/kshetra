import { describe, expect, it, jest } from '@jest/globals';
import { ApiError, NetworkError, type SessionState } from '@kshetra/api-client';
import { nodeSqlite } from '@kshetra/api-client/node-sqlite';
import { migrate, Outbox } from '@kshetra/api-client/sync';
import { SETTING_DEFAULTS } from '@kshetra/shared';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppProvider, useApp } from './app-state';
import { takeResults } from './capture-results';
import type { MobileClient } from './client';
import { LanguageProvider } from './i18n';
import { Look } from './look';
import { photoSender, type PhotoUpload } from './photos';
import { CameraScreen } from './screens/camera';
import { SyncProvider } from './sync';

const mockFiles = new Map<string, Uint8Array>();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-battery', () => ({ isBatteryOptimizationEnabledAsync: async () => false }));
jest.mock('expo-location', () => ({
  Accuracy: { Highest: 6 },
  requestForegroundPermissionsAsync: async () => ({ granted: true }),
  getCurrentPositionAsync: async () => ({
    coords: { latitude: 28.6315, longitude: 77.2167, accuracy: 9 },
    timestamp: Date.now(),
  }),
}));
// Files live in memory: a path names some bytes.
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    // As in expo-file-system 57, a move finishes later: reading the destination before awaiting it
    // finds nothing, as it did on a phone (decision D68).
    async move(to: File) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      mockFiles.set(to.uri, mockFiles.get(this.uri)!);
      mockFiles.delete(this.uri);
      this.uri = to.uri;
    }
    async bytes() {
      const bytes = mockFiles.get(this.uri);
      if (!bytes) throw new Error(`ENOENT: ${this.uri}`);
      return bytes;
    }
    delete() {
      mockFiles.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    exists = true;
    create() {}
  }
  return { File, Directory, Paths: { document: { uri: 'app' } } };
});
// Resizing hands back a smaller JPEG.
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: jest.fn(),
      renderAsync: async () => ({
        saveAsync: async () => {
          mockFiles.set('cache/resized.jpg', new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
          return { uri: 'cache/resized.jpg', width: 1600, height: 1200 };
        },
      }),
    }),
  },
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async () => new Uint8Array(32).fill(0xab).buffer,
  getRandomBytes: (count: number) => new Uint8Array(count).fill(7),
}));
const mockUploads: { url: string; init: { headers: Record<string, string> } }[] = [];
const mockStorage = { status: 200 };
jest.mock('expo/fetch', () => ({
  fetch: async (url: string, init: { headers: Record<string, string> }) => {
    mockUploads.push({ url, init });
    return { ok: mockStorage.status < 300, status: mockStorage.status };
  },
}));
jest.mock('expo-camera', () => {
  const { forwardRef: forward, useImperativeHandle: handle } =
    jest.requireActual<typeof import('react')>('react');
  const { View: Box } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
    CameraView: forward((props: object, ref) => {
      handle(ref, () => ({
        takePictureAsync: async () => {
          mockFiles.set('camera/shot.jpg', new Uint8Array([0xff, 0xd8, 0xff, 9]));
          return { uri: 'camera/shot.jpg', width: 4000, height: 3000 };
        },
      }));
      return <Box {...props} />;
    }),
  };
});

const PHOTO: PhotoUpload = {
  id: '01a10000-0000-7000-8000-000000000099',
  uri: 'app/photos/p.jpg',
  size: 6,
  sha256: 'ab'.repeat(32),
  kind: 'evidence',
  capturedAt: '2026-10-12T10:00:00.000Z',
  source: 'camera',
  fix: { lat: 28.6, lng: 77.2, accuracy: 9, capturedAt: '2026-10-12T10:00:00.000Z', mocked: false },
};

function fakeApi(upload: object | null) {
  return {
    request: jest.fn(async (_method: unknown, path: unknown) =>
      String(path).endsWith('/presign')
        ? {
            id: PHOTO.id,
            status: upload ? 'pending' : 'uploaded',
            upload: upload
              ? {
                  url: 'https://store.test/put',
                  method: 'PUT',
                  headers: {
                    'content-type': 'image/jpeg',
                    'content-length': '6',
                    'x-amz-checksum-sha256': 'q83v',
                  },
                  expiresAt: '2026-10-12T10:10:00.000Z',
                }
              : null,
          }
        : { id: PHOTO.id, status: 'uploaded' },
    ),
  };
}

describe('sending a photo (spec 12.2)', () => {
  it('registers, uploads to storage with the signed headers, confirms, then lets the file go', async () => {
    mockFiles.set(PHOTO.uri, new Uint8Array([1, 2, 3, 4, 5, 6]));
    mockUploads.length = 0;
    mockStorage.status = 200;
    const api = fakeApi({});
    await photoSender(api as never).send(PHOTO, {} as never);
    expect(
      api.request.mock.calls.map(([method, path]) => `${String(method)} ${String(path)}`),
    ).toEqual(['POST /v1/media/presign', `POST /v1/media/${PHOTO.id}/confirm`]);
    expect(mockUploads).toEqual([
      {
        url: 'https://store.test/put',
        init: expect.objectContaining({
          method: 'PUT',
          headers: { 'content-type': 'image/jpeg', 'x-amz-checksum-sha256': 'q83v' },
        }),
      },
    ]);
    expect(mockFiles.has(PHOTO.uri)).toBe(false);
  });

  it('skips the upload when storage has it, and retries what storage turns away', async () => {
    mockFiles.set(PHOTO.uri, new Uint8Array([1, 2, 3, 4, 5, 6]));
    mockUploads.length = 0;
    await photoSender(fakeApi(null) as never).send(PHOTO, {} as never);
    expect(mockUploads).toEqual([]);

    mockFiles.set(PHOTO.uri, new Uint8Array([1, 2, 3, 4, 5, 6]));
    mockStorage.status = 403;
    await expect(photoSender(fakeApi({}) as never).send(PHOTO, {} as never)).rejects.toBeInstanceOf(
      NetworkError,
    );
    mockStorage.status = 400;
    await expect(photoSender(fakeApi({}) as never).send(PHOTO, {} as never)).rejects.toBeInstanceOf(
      ApiError,
    );
    // Still on the phone, to be tried again or discarded.
    expect(mockFiles.has(PHOTO.uri)).toBe(true);
    mockStorage.status = 200;
  });
});

describe('the camera', () => {
  it('takes a photo, keeps it with the time and the fix, and queues its upload', async () => {
    const db = nodeSqlite();
    await migrate(db);
    const session: SessionState = {
      tenant: { id: '01a10000-0000-7000-8000-000000000001', name: 'Sunrise Traders', cellUrl: '' },
      accessToken: 'a1',
      accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
    const owner = `${session.tenant.id}:01a10000-0000-7000-8000-000000000004`;
    const client = {
      session,
      owner,
      restore: jest.fn(async () => session),
      signOut: jest.fn(async () => undefined),
      // Offline: everything stays in the queue.
      syncPull: jest.fn(async () => {
        throw new NetworkError(new TypeError('offline'));
      }),
      heartbeat: jest.fn(async () => undefined),
      request: jest.fn(async () => {
        throw new NetworkError(new TypeError('offline'));
      }),
      config: jest.fn(async () => ({
        status: 'fresh',
        etag: '"1"',
        bundle: {
          version: 1,
          settings: SETTING_DEFAULTS,
          terminology: {},
          designations: [],
          accountTypes: [],
          access: { role: 'field_user', scope: 'self', permissions: [] },
        },
      })),
    };
    function Shown() {
      const { session: signedIn, restored } = useApp();
      if (!restored || !signedIn) return null;
      return <CameraScreen kind="evidence" request="form-1" />;
    }
    await render(
      <LanguageProvider initial="en">
        <AppProvider
          createClient={() => client as unknown as MobileClient}
          queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <SyncProvider openDatabase={async () => db}>
            <Look>
              <Shown />
            </Look>
          </SyncProvider>
        </AppProvider>
      </LanguageProvider>,
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Take photo' }));
    expect(await screen.findByLabelText('The photo you took')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Use photo' }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());

    const [id] = takeResults('form-1');
    const [item] = await new Outbox(db, {}).items(owner);
    expect(item).toMatchObject({
      id,
      kind: 'media.upload',
      payload: {
        id,
        kind: 'evidence',
        source: 'camera',
        size: 6,
        sha256: 'ab'.repeat(32),
        fix: { lat: 28.6315, lng: 77.2167, accuracy: 9, mocked: false },
      },
    });
    expect(mockFiles.has((item!.payload as PhotoUpload).uri)).toBe(true);
  });
});
