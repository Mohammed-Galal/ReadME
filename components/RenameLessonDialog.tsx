'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';

export default function RenameLessonDialog({
  show,
  title,
  onHide,
  onSave,
}: {
  show: boolean;
  title: string;
  onHide: () => void;
  onSave: (title: string) => Promise<void>;
}) {
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (show) { setValue(title); setError(''); } }, [show, title]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) { setError('Enter a lesson title.'); return; }
    setBusy(true);
    try { await onSave(trimmed); onHide(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not rename this lesson.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal show={show} onHide={onHide} centered aria-labelledby="rename-lesson-title">
      <Form onSubmit={(event) => void submit(event)}>
        <Modal.Header closeButton><Modal.Title id="rename-lesson-title">Rename lesson</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Label htmlFor="rename-lesson-input">Title</Form.Label>
          <Form.Control id="rename-lesson-input" autoFocus value={value} onChange={(event) => setValue(event.target.value)} maxLength={240} />
          {error && <p className="text-danger mt-2 mb-0" role="alert">{error}</p>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
