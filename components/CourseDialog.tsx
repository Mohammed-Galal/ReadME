'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import type { Course } from '@/lib/db/schema';

interface CourseDialogProps {
  show: boolean;
  course?: Course | null;
  onHide: () => void;
  onSave: (data: { name: string; description: string }) => Promise<void>;
}

export default function CourseDialog({ show, course, onHide, onSave }: CourseDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (show) {
      setName(course?.name ?? '');
      setDescription(course?.description ?? '');
      setError('');
    }
  }, [course, show]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) { setError('Enter a course name.'); return; }
    setBusy(true);
    try {
      await onSave({ name: trimmedName, description: description.trim() });
      onHide();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this course.');
    } finally { setBusy(false); }
  };
  return (
    <Modal show={show} onHide={onHide} centered aria-labelledby="course-dialog-title">
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title id="course-dialog-title">{course ? 'Edit course' : 'Add course'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3" controlId="course-name">
            <Form.Label>Name</Form.Label>
            <Form.Control autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </Form.Group>
          <Form.Group controlId="course-description">
            <Form.Label>Description <span className="text-secondary">(optional)</span></Form.Label>
            <Form.Control as="textarea" rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Form.Group>
          {error && <p className="text-danger mt-3 mb-0" role="alert">{error}</p>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
