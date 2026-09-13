import fs from 'node:fs/promises';
import path from 'node:path';
import { ConsoleError } from './errors.js';

const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

// Hand-built showcase items live outside runs/. They are static galleries with a
// manifest and screenshots only: no pipeline status, report, or preview is implied.
export function createShowcaseStore(showcaseRoot) {
  const root = path.resolve(showcaseRoot);

  async function listItems() {
    let entries = [];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const items = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => readItem(entry.name)),
    );
    return items
      .filter(Boolean)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  async function readItem(id) {
    const dir = resolveItemDir(id);
    let manifest = {};
    try {
      manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')) || {};
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    let files = [];
    try {
      files = (await fs.readdir(path.join(dir, 'screenshots')))
        .filter((name) => IMAGE_TYPES.has(path.extname(name).toLowerCase()))
        .sort();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!files.length) return null;
    const preferred = Array.isArray(manifest.screenshots)
      ? manifest.screenshots.map(String).filter((name) => files.includes(name))
      : [];
    const ordered = [...preferred, ...files.filter((name) => !preferred.includes(name))];
    const labels = manifest.labels && typeof manifest.labels === 'object' ? manifest.labels : {};
    return {
      id,
      kind: 'showcase',
      title: text(manifest.title, 120) || id,
      date: text(manifest.date, 40),
      origin: text(manifest.origin, 200),
      summary: text(manifest.summary, 1000),
      pages: ordered.map((name) => ({
        name,
        label: text(labels[name], 80) || name.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' '),
      })),
    };
  }

  async function readScreenshot(id, name) {
    const file = jailed(resolveItemDir(id), 'screenshots', String(name));
    const type = IMAGE_TYPES.get(path.extname(file).toLowerCase());
    if (!type) throw new ConsoleError('SCREENSHOT_INVALID', 'Only image screenshots are available.', 400);
    try {
      return { data: await fs.readFile(file), type };
    } catch (error) {
      if (error.code === 'ENOENT') throw new ConsoleError('SCREENSHOT_NOT_FOUND', 'Screenshot not found.', 404);
      throw error;
    }
  }

  function resolveItemDir(id) {
    const value = String(id ?? '');
    if (!value || value.startsWith('.')) throw new ConsoleError('RUN_INVALID', 'Showcase id is invalid.', 400);
    return jailed(root, value);
  }

  return { listItems, readScreenshot };
}

function jailed(root, ...parts) {
  const base = path.resolve(root);
  const resolved = path.resolve(base, ...parts);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new ConsoleError('PATH_OUTSIDE_RUNS', 'Requested artifact is outside the showcase directory.', 400);
  }
  return resolved;
}

function text(value, maxLength) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
