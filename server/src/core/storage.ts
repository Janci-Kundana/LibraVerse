import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env';
import { AppError } from './errors';

// Files arrive as data URLs in JSON bodies (no multipart dependency). Public
// files (logos, covers) get a URL; private ones (ID proofs) only a key, and are
// served through an authorised route.

export type Access = 'public' | 'private';

export interface StoredFile {
  key: string;
  url: string | null;
}

const SIGNATURES: { mime: string; bytes: number[] }[] = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export interface DecodedFile {
  data: Buffer;
  mime: string;
}

/** Decodes a base64 data URL and checks its real type (by magic bytes) and size. */
export function decodeDataUrl(
  dataUrl: string,
  opts: { allowed: string[]; maxBytes: number },
): DecodedFile {
  const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new AppError(400, 'INVALID_FILE', 'File must be a base64 data URL');
  const data = Buffer.from(match[2]!, 'base64');
  if (data.length === 0) throw new AppError(400, 'INVALID_FILE', 'File is empty');
  if (data.length > opts.maxBytes) {
    throw new AppError(
      413,
      'FILE_TOO_LARGE',
      `File must be under ${Math.round(opts.maxBytes / 1_048_576)} MB`,
    );
  }
  const sniffed = SIGNATURES.find((s) => s.bytes.every((b, i) => data[i] === b))?.mime;
  if (!sniffed || !opts.allowed.includes(sniffed)) {
    throw new AppError(
      400,
      'INVALID_FILE',
      `Allowed file types: ${opts.allowed.map((m) => EXTENSIONS[m]).join(', ')}`,
    );
  }
  return { data, mime: sniffed };
}

interface Driver {
  put(file: DecodedFile, folder: string, access: Access): Promise<StoredFile>;
  /** For private files: bytes to stream (local) or a short-lived URL to redirect to. */
  open(key: string): Promise<{ data: Buffer; mime: string } | { redirect: string }>;
}

const memory = new Map<string, DecodedFile>();

const memoryDriver: Driver = {
  async put(file, folder, access) {
    const key = `${access}/${folder}/${randomUUID()}.${EXTENSIONS[file.mime]}`;
    memory.set(key, file);
    return { key, url: access === 'public' ? `/api/files/${key}` : null };
  },
  async open(key) {
    const file = memory.get(key);
    if (!file) throw new AppError(404, 'NOT_FOUND', 'File not found');
    return file;
  },
};

const MIME_BY_EXT = Object.fromEntries(Object.entries(EXTENSIONS).map(([m, e]) => [e, m]));
const root = () => path.resolve(env.UPLOAD_DIR);

const diskDriver: Driver = {
  async put(file, folder, access) {
    const key = `${access}/${folder}/${randomUUID()}.${EXTENSIONS[file.mime]}`;
    const target = path.join(root(), key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.data);
    return { key, url: access === 'public' ? `/api/files/${key}` : null };
  },
  async open(key) {
    const target = path.resolve(root(), key);
    if (!target.startsWith(root() + path.sep))
      throw new AppError(404, 'NOT_FOUND', 'File not found');
    try {
      const data = await readFile(target);
      return { data, mime: MIME_BY_EXT[path.extname(key).slice(1)] ?? 'application/octet-stream' };
    } catch {
      throw new AppError(404, 'NOT_FOUND', 'File not found');
    }
  },
};

const cloudinaryDriver: Driver = {
  async put(file, folder, access) {
    const result = await new Promise<{ public_id: string; secure_url: string; format: string }>(
      (resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              folder: `libraverse/${folder}`,
              type: access === 'private' ? 'private' : 'upload',
              resource_type: 'image',
            },
            (err, res) => (err || !res ? reject(err) : resolve(res)),
          )
          .end(file.data);
      },
    );
    return {
      key: `${result.public_id}.${result.format}`,
      url: access === 'public' ? result.secure_url : null,
    };
  },
  async open(key) {
    const dot = key.lastIndexOf('.');
    return {
      redirect: cloudinary.utils.private_download_url(key.slice(0, dot), key.slice(dot + 1), {
        resource_type: 'image',
        expires_at: Math.floor(Date.now() / 1000) + 300,
      }),
    };
  },
};

function driver(): Driver {
  if (env.NODE_ENV === 'test') return memoryDriver;
  if (env.CLOUDINARY_URL) {
    cloudinary.config({ secure: true }); // reads CLOUDINARY_URL from the environment
    return cloudinaryDriver;
  }
  return diskDriver;
}

export const putFile = (file: DecodedFile, folder: string, access: Access) =>
  driver().put(file, folder, access);

export const openFile = (key: string) => driver().open(key);

/** Local-disk public files only; Cloudinary serves its own. */
export const isLocalPublicKey = (key: string) => key.startsWith('public/');
