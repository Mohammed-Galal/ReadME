import { openDB, type IDBPDatabase } from 'idb';
import type { ReadmeDB, LegacyFile, LegacyPosition, MetaRecord } from './schema';
import { uid } from '../utils';

export * from './schema';

const DB_NAME = 'readme-reader';
const DB_VERSION = 2;
let dbPromise: Promise<IDBPDatabase<ReadmeDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<ReadmeDB>> {
  if (!dbPromise) {
    dbPromise = openReadmeDatabase();
  }
  return dbPromise;
}

export function openReadmeDatabase(name = DB_NAME): Promise<IDBPDatabase<ReadmeDB>> {
  return openDB<ReadmeDB>(name, DB_VERSION, {
      upgrade: async (db, oldVersion, _newVersion, tx) => {
        // New stores use fresh names where v1 stores already exist. Legacy
        // stores are retained unchanged and are only read during this upgrade.
        const courses = db.createObjectStore('courses', { keyPath: 'id' });
        courses.createIndex('by-createdAt', 'createdAt');
        const lessons = db.createObjectStore('lessons', { keyPath: 'id' });
        lessons.createIndex('by-courseId', 'courseId');
        const comments = db.createObjectStore('comments', { keyPath: 'id' });
        comments.createIndex('by-courseId', 'courseId');
        comments.createIndex('by-lessonId', 'lessonId');
        db.createObjectStore('positions_v2', { keyPath: 'lessonId' });
        db.createObjectStore('meta_v2', { keyPath: 'key' });

        if (oldVersion < 1) return;
        const names = db.objectStoreNames;
        if (!names.contains('files') || !names.contains('positions') || !names.contains('meta')) return;

        // Only await IndexedDB requests here; other async work would let the
        // browser auto-commit the versionchange transaction.
        const [legacyFiles, legacyPositions, lastActive, sidebarCollapsed] = await Promise.all([
          tx.objectStore('files').getAll() as Promise<LegacyFile[]>,
          tx.objectStore('positions').getAll() as Promise<LegacyPosition[]>,
          tx.objectStore('meta').get('lastActive') as Promise<MetaRecord<string> | undefined>,
          tx.objectStore('meta').get('sidebarCollapsed') as Promise<MetaRecord<boolean> | undefined>,
        ]);
        if (legacyFiles.length === 0) return;

        const now = Date.now();
        const courseId = uid();
        const course = { id: courseId, name: 'My lessons', description: '', createdAt: now, updatedAt: now };
        await tx.objectStore('courses').put(course);

        legacyFiles.sort((a, b) => a.name.localeCompare(b.name));
        const idMap = new Map<string | number, string>();
        const lessonIds: string[] = [];
        for (const [order, file] of legacyFiles.entries()) {
          const id = typeof file.id === 'string' ? file.id : uid();
          idMap.set(file.id, id);
          lessonIds.push(id);
          const timestamp = Number.isFinite(file.date) ? file.date : now;
          await tx.objectStore('lessons').put({
            id,
            courseId,
            title: file.name,
            content: file.content,
            contentHash: file.hash,
            order,
            source: 'file',
            originalFileName: file.name,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
        for (const position of legacyPositions) {
          const lessonId = idMap.get(position.fileId);
          if (lessonId) {
            await tx.objectStore('positions_v2').put({
              lessonId,
              blockId: position.blockId,
              charOffset: position.charOffset,
              updatedAt: position.updatedAt,
            });
          }
        }
        const oldActiveId = lastActive?.value;
        const activeLessonId = oldActiveId == null ? undefined : idMap.get(oldActiveId);
        if (activeLessonId) {
          await tx.objectStore('meta_v2').put({
            key: 'lastOpened',
            value: { courseId, lessonId: activeLessonId },
          });
        }
        await tx.objectStore('meta_v2').put({ key: 'defaultCourseId', value: courseId });
        if (sidebarCollapsed?.value !== undefined) {
          await tx.objectStore('meta_v2').put({ key: 'sidebarCollapsed', value: sidebarCollapsed.value });
        }
      },
      blocked() {
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('readme-db-blocked'));
      },
      blocking() {
        void dbPromise?.then((connection) => connection.close());
        dbPromise = null;
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('readme-db-blocked'));
      },
    });
}

