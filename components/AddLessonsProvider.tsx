'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Button, Form, Modal, Spinner, Tab, Tabs } from 'react-bootstrap';
import { AddLessonsContext, type OpenAddLessonsOptions } from '@/lib/addLessonsContext';
import { addLessonsStagingReducer, derivePasteTitle, MAX_LESSON_SIZE, uniquePasteTitle, type ExistingLessonKey, type StagedLesson, type StagedStatus, type StagingAction } from '@/lib/addLessonsStaging';
import { notifyCourseDataChanged } from '@/lib/dataEvents';
import { addLessons as saveLessons, listLessons } from '@/lib/db/repositories';
import type { LessonInput } from '@/lib/db/schema';
import { hashText, isAcceptedFile, uid } from '@/lib/utils';
import { useStore } from '@/lib/store';
import ConfirmDialog from './ConfirmDialog';
import Toasts from './Toasts';

function getBaseStatus(content: string, size: number, supported: boolean): StagedStatus {
  if (!supported) return 'Unsupported type';
  if (size > MAX_LESSON_SIZE) return 'Too large';
  if (!content.trim()) return 'Empty';
  return 'Ready';
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function StagedRow({ lesson, onRemove }: { lesson: StagedLesson; onRemove: (id: string) => void }) {
  return (
    <li className="add-lessons-row">
      <i className={`bi ${lesson.source === 'file' ? 'bi-file-earmark-text' : 'bi-clipboard'} add-lessons-row-icon`} aria-hidden="true" />
      <div className="add-lessons-row-copy">
        <strong title={lesson.title}>{lesson.title}</strong>
        <span>{formatSize(lesson.size)} · {lesson.status}</span>
      </div>
      <Button type="button" variant="light" className="tap-target add-lessons-remove" aria-label={`Remove ${lesson.title}`} onClick={() => onRemove(lesson.id)}>
        <i className="bi bi-x-lg" aria-hidden="true" />
      </Button>
    </li>
  );
}

function AddLessonsModal({
  courseId,
  show,
  initialTab,
  initialFiles,
  onClose,
}: {
  courseId: string;
  show: boolean;
  initialTab: 'upload' | 'paste';
  initialFiles: File[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'upload' | 'paste'>(initialTab);
  const [staged, dispatch] = useReducer(addLessonsStagingReducer, [] as StagedLesson[]);
  const [existing, setExisting] = useState<ExistingLessonKey[]>([]);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [pendingFiles, setPendingFiles] = useState(0);
  const [title, setTitle] = useState('');
  const [paste, setPaste] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const stagedRef = useRef(staged);
  const inputRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef(0);
  const stagedInitialFiles = useRef<File[] | null>(null);
  const stagingVersion = useRef(0);
  const stagingQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingFilesRef = useRef(0);
  const toast = useStore((state) => state.toast);

  const stage = useCallback((action: StagingAction) => {
    const next = addLessonsStagingReducer(stagedRef.current, action);
    stagedRef.current = next;
    dispatch({ type: 'replace', items: next });
  }, []);

  const queueFiles = useCallback(async (files: File[]) => {
    const version = stagingVersion.current;
    pendingFilesRef.current++;
    setPendingFiles(pendingFilesRef.current);
    const task = stagingQueue.current.then(async () => {
      if (version !== stagingVersion.current) return;
      const prepared = await Promise.all(files.map(async (file): Promise<StagedLesson> => {
        const supported = isAcceptedFile(file.name);
        let content = '';
        if (supported && file.size <= MAX_LESSON_SIZE) {
          try { content = await file.text(); }
          catch {
            return {
              id: uid(), title: file.name, content: '', contentHash: await hashText(''), source: 'file',
              originalFileName: file.name, size: file.size, baseStatus: 'Unsupported type', status: 'Unsupported type',
            };
          }
        }
        const baseStatus = getBaseStatus(content, file.size, supported);
        return {
          id: uid(), title: file.name, content, contentHash: await hashText(content), source: 'file',
          originalFileName: file.name, size: file.size, baseStatus, status: baseStatus,
        };
      }));
      if (version === stagingVersion.current) stage({ type: 'addFiles', files: prepared });
    });
    stagingQueue.current = task.then(() => undefined, () => undefined);
    try {
      await task;
    } catch (error) {
      if (version === stagingVersion.current) toast(error instanceof Error ? error.message : 'Could not read the selected files.', 'danger');
    } finally {
      if (version === stagingVersion.current) {
        pendingFilesRef.current = Math.max(0, pendingFilesRef.current - 1);
        setPendingFiles(pendingFilesRef.current);
      }
    }
  }, [stage, toast]);

  const reset = useCallback(() => {
    requestRef.current++;
    stagingVersion.current++;
    stagingQueue.current = Promise.resolve();
    pendingFilesRef.current = 0;
    setPendingFiles(0);
    stage({ type: 'clear' });
    setExisting([]);
    setLoadingExisting(false);
    setTitle('');
    setPaste('');
    setPasteBusy(false);
    setConfirmDiscard(false);
  }, [stage]);

  useEffect(() => {
    if (!show) return;
    let active = true;
    if (initialFiles.length > 0 && stagedInitialFiles.current !== initialFiles) {
      stagedInitialFiles.current = initialFiles;
      void queueFiles(initialFiles);
    }
    const request = ++requestRef.current;
    setLoadingExisting(true);
    void listLessons(courseId).then((lessons) => {
      if (!active || request !== requestRef.current) return;
      setExisting(lessons.map(({ title: lessonTitle, contentHash }) => ({ title: lessonTitle, contentHash })));
    }).catch((error: unknown) => {
      if (active && request === requestRef.current) toast(error instanceof Error ? error.message : 'Could not check for existing lessons.', 'danger');
    }).finally(() => {
      if (active && request === requestRef.current) setLoadingExisting(false);
    });
    return () => { active = false; };
  }, [courseId, initialFiles, queueFiles, show, toast]);

  useEffect(() => {
    stage({ type: 'markDuplicates', existing });
  }, [existing, stage, staged]);

  useEffect(() => {
    if (show && tab === 'paste') pasteRef.current?.focus();
  }, [show, tab]);

  const readyCount = staged.filter((item) => item.status === 'Ready').length;
  const initialFilesPending = initialFiles.length > 0 && stagedInitialFiles.current !== initialFiles;
  const dirty = staged.length > 0 || title.length > 0 || paste.length > 0 || pendingFiles > 0 || pasteBusy || initialFilesPending;
  const liveStatus = useMemo(() => {
    const statuses = staged.reduce<Record<string, number>>((counts, item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
      return counts;
    }, {});
    return `${staged.length} staged. ${pendingFiles} files processing. ${Object.entries(statuses).map(([name, count]) => `${count} ${name}`).join(', ')}`;
  }, [pendingFiles, staged]);

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else { reset(); onClose(); }
  };
  const discard = () => { reset(); onClose(); };

  const addPaste = async () => {
    if (pasteBusy) return;
    const content = paste;
    const requestedTitle = title.trim();
    const version = stagingVersion.current;
    setPasteBusy(true);
    const task = stagingQueue.current.then(async () => {
      if (version !== stagingVersion.current) return;
      let lessonTitle = requestedTitle || derivePasteTitle(content);
      if (!requestedTitle) {
        const usedTitles = [...existing.map((item) => item.title), ...stagedRef.current.map((item) => item.title)];
        lessonTitle = uniquePasteTitle(lessonTitle, usedTitles);
      }
      const size = new Blob([content]).size;
      const contentHash = await hashText(content);
      if (version !== stagingVersion.current) return;
      const baseStatus = getBaseStatus(content, size, true);
      stage({ type: 'addPaste', lesson: {
        id: uid(), title: lessonTitle, content, contentHash, source: 'paste', size, baseStatus, status: baseStatus,
      } });
      setTitle('');
      setPaste('');
    });
    stagingQueue.current = task.then(() => undefined, () => undefined);
    try { await task; }
    catch (error) { if (version === stagingVersion.current) toast(error instanceof Error ? error.message : 'Could not stage pasted text.', 'danger'); }
    finally { if (version === stagingVersion.current) setPasteBusy(false); }
  };

  const submit = async () => {
    if (!readyCount || loadingExisting || pendingFiles || saving) return;
    setSaving(true);
    try {
      const ready = staged.filter((item) => item.status === 'Ready');
      const inputs: LessonInput[] = ready.map(({ title: lessonTitle, content, contentHash, source, originalFileName }) => ({
        title: lessonTitle, content, contentHash, source, originalFileName,
      }));
      const result = await saveLessons(courseId, inputs, { preserveOrder: true });
      if (result.added.length > 0) notifyCourseDataChanged(courseId);
      const stagedDuplicates = staged.filter((item) => item.status === 'Already in this course' || item.status === 'Duplicate in list').length;
      toast(`${result.added.length} added, ${stagedDuplicates + result.skippedDuplicates} duplicates skipped`, 'success');
      reset();
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not add lessons.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        show={show}
        onHide={requestClose}
        onExited={() => { if (inputRef.current) inputRef.current.value = ''; }}
        centered
        fullscreen="sm-down"
        scrollable
        backdrop={dirty ? 'static' : true}
        keyboard={!dirty}
        aria-labelledby="add-lessons-title"
        className="add-lessons-modal"
      >
        <Modal.Header closeButton={!saving}>
          <Modal.Title id="add-lessons-title">Add lessons</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Tabs activeKey={tab} onSelect={(key) => key && setTab(key as 'upload' | 'paste')} id="add-lessons-tabs" className="add-lessons-tabs">
            <Tab eventKey="upload" title="Upload files">
              <div
                className="add-lessons-dropzone"
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files.length) void queueFiles(Array.from(event.dataTransfer.files)); }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".md,.markdown,.txt"
                  className="visually-hidden"
                  aria-label="Choose Markdown lesson files"
                  onChange={(event) => {
                    if (event.currentTarget.files?.length) void queueFiles(Array.from(event.currentTarget.files));
                    event.currentTarget.value = '';
                  }}
                />
                <i className="bi bi-cloud-arrow-up" aria-hidden="true" />
                <strong>Drop files here or browse</strong>
                <span>Markdown and text files · up to 2 MB each</span>
                <Button type="button" variant="outline-primary" className="tap-target" onClick={() => inputRef.current?.click()}>
                  Choose files
                </Button>
              </div>
            </Tab>
            <Tab eventKey="paste" title="Paste text">
              <Form.Group className="mb-3" controlId="paste-lesson-title">
                <Form.Label>Title <span className="text-body-secondary">(optional)</span></Form.Label>
                <Form.Control value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Lesson title" aria-label="Pasted lesson title" disabled={pasteBusy} />
              </Form.Group>
              <Form.Group controlId="paste-lesson-content">
                <Form.Label>Markdown text</Form.Label>
                <Form.Control
                  as="textarea"
                  ref={pasteRef}
                  className="add-lessons-paste"
                  value={paste}
                  disabled={pasteBusy}
                  onChange={(event) => setPaste(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void addPaste(); }
                  }}
                  placeholder="Paste Markdown here…"
                  aria-label="Paste Markdown lesson text"
                  dir="auto"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoFocus={show && tab === 'paste'}
                />
                <Form.Text>Ctrl/Cmd + Enter adds this lesson to the list.</Form.Text>
              </Form.Group>
              <Button type="button" variant="outline-primary" className="tap-target mt-3" onClick={() => void addPaste()} disabled={pasteBusy}>
                {pasteBusy ? 'Adding…' : 'Add to list'}
              </Button>
            </Tab>
          </Tabs>
          <div className="add-lessons-staged-heading">
            <h2>Staged lessons</h2>
            {(loadingExisting || pendingFiles > 0) && <span><Spinner animation="border" size="sm" aria-hidden="true" /> {pendingFiles > 0 ? 'Reading files…' : 'Checking course…'}</span>}
          </div>
          <div className="visually-hidden" aria-live="polite" aria-atomic="true">{liveStatus}</div>
          {staged.length ? (
            <ul className="add-lessons-list" aria-label="Staged lessons">
              {staged.map((lesson) => <StagedRow key={lesson.id} lesson={lesson} onRemove={(id) => stage({ type: 'remove', id })} />)}
            </ul>
          ) : (
            <p className="add-lessons-empty">Files and pasted lessons will appear here.</p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="secondary" className="tap-target" onClick={requestClose} disabled={saving}>Cancel</Button>
          <Button type="button" className="tap-target add-lessons-submit" onClick={() => void submit()} disabled={!readyCount || loadingExisting || pendingFiles > 0 || saving}>
            {saving && <Spinner animation="border" size="sm" className="me-2" aria-hidden="true" />}
            {saving ? 'Adding lessons…' : `Add ${readyCount} lessons`}
          </Button>
        </Modal.Footer>
      </Modal>
      <ConfirmDialog
        show={confirmDiscard}
        title="Discard staged lessons?"
        message="Your staged lessons and typed text will be discarded."
        confirmLabel="Discard"
        onHide={() => setConfirmDiscard(false)}
        onConfirm={discard}
      />
    </>
  );
}

export default function AddLessonsProvider({ children }: { children: React.ReactNode }) {
  const [activeCourseId, setActiveCourseId] = useState('');
  const [show, setShow] = useState(false);
  const [initialTab, setInitialTab] = useState<'upload' | 'paste'>('upload');
  const [initialFiles, setInitialFiles] = useState<File[]>([]);
  const requestRef = useRef(0);

  const open = useCallback((courseId: string, options: OpenAddLessonsOptions = {}) => {
    requestRef.current++;
    setActiveCourseId(courseId);
    setInitialTab(options.tab ?? 'upload');
    setInitialFiles(options.files ?? []);
    setShow(true);
  }, []);
  const contextValue = useMemo(() => ({ open }), [open]);

  return (
    <AddLessonsContext.Provider value={contextValue}>
      {children}
      <Toasts />
      {activeCourseId && (
        <AddLessonsModal
          key={requestRef.current}
          courseId={activeCourseId}
          show={show}
          initialTab={initialTab}
          initialFiles={initialFiles}
          onClose={() => setShow(false)}
        />
      )}
    </AddLessonsContext.Provider>
  );
}
