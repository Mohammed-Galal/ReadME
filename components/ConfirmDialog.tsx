'use client';

import { useState } from 'react';
import { Button, Modal } from 'react-bootstrap';

interface ConfirmDialogProps {
  show: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onHide: () => void;
  onConfirm: () => Promise<void> | void;
}

export default function ConfirmDialog({
  show,
  title,
  message,
  confirmLabel = 'Delete',
  danger = true,
  onHide,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };
  return (
    <Modal show={show} onHide={busy ? () => undefined : onHide} centered aria-labelledby="confirm-dialog-title">
      <Modal.Header closeButton={!busy}>
        <Modal.Title id="confirm-dialog-title">{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{message}</Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => void confirm()} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
