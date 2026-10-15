'use client';

import { useEffect, useState } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';

interface MoveToPositionModalProps {
  show: boolean;
  count: number;
  currentPosition: number;
  onHide: () => void;
  onMove: (zeroBasedIndex: number) => Promise<void> | void;
}

export default function MoveToPositionModal({ show, count, currentPosition, onHide, onMove }: MoveToPositionModalProps) {
  const [position, setPosition] = useState(String(currentPosition));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (show) setPosition(String(currentPosition)); }, [currentPosition, show]);
  const numericPosition = Number(position);
  const valid = Number.isInteger(numericPosition) && numericPosition >= 1 && numericPosition <= count;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try { await onMove(numericPosition - 1); onHide(); } finally { setBusy(false); }
  };
  return (
    <Modal show={show} onHide={onHide} centered aria-labelledby="move-position-title">
      <Form onSubmit={(event) => void submit(event)}>
        <Modal.Header closeButton><Modal.Title id="move-position-title">Move to position</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Label htmlFor="move-position-number">Position (1–{count})</Form.Label>
          <Form.Control id="move-position-number" type="number" min={1} max={count} step={1} value={position} onChange={(event) => setPosition(event.target.value)} aria-invalid={!valid} />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={!valid || busy}>Move</Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
