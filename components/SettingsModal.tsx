'use client';

// Settings modal: voice, speed, pitch, speech toggles, auto-scroll,
// auto-advance, language override. Changes apply live and persist.

import { Form, Modal } from 'react-bootstrap';
import { LANGUAGE_OPTIONS } from '@/lib/speech/language';
import { useVoices } from '@/lib/speech/voices';
import { useStore } from '@/lib/store';

export default function SettingsModal() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const docLang = useStore((s) => s.docLang);
  const detectedLang = useStore((s) => s.detectedLang);
  const voices = useVoices();

  const effectiveLang = docLang ?? detectedLang ?? 'browser default';
  const sortedVoices = [...voices].sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));

  return (
    <Modal show={open} onHide={() => setOpen(false)} size="lg" centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title>Settings</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="settings-voice">Voice</Form.Label>
            <Form.Select
              id="settings-voice"
              value={settings.voiceURI ?? ''}
              onChange={(e) => void updateSettings({ voiceURI: e.target.value || null })}
            >
              <option value="">Browser default</option>
              {sortedVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="settings-rate">
              Speed <span className="setting-value">{settings.rate.toFixed(1)}×</span>
            </Form.Label>
            <Form.Range
              id="settings-rate"
              min={0.5}
              max={2}
              step={0.1}
              value={settings.rate}
              onChange={(e) => void updateSettings({ rate: Number(e.target.value) })}
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="settings-pitch">
              Pitch <span className="setting-value">{settings.pitch.toFixed(1)}</span>
            </Form.Label>
            <Form.Range
              id="settings-pitch"
              min={0}
              max={2}
              step={0.1}
              value={settings.pitch}
              onChange={(e) => void updateSettings({ pitch: Number(e.target.value) })}
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="settings-lang">
              Language override{' '}
              <span className="text-secondary small">(auto: {effectiveLang})</span>
            </Form.Label>
            <Form.Select
              id="settings-lang"
              value={settings.langOverride}
              onChange={(e) => void updateSettings({ langOverride: e.target.value })}
            >
              <option value="">Auto (front matter or detection)</option>
              {LANGUAGE_OPTIONS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.code})
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <hr />

          <Form.Switch
            id="settings-inline-code"
            className="mb-2"
            label="Read inline code"
            checked={settings.readInlineCode}
            onChange={(e) => void updateSettings({ readInlineCode: e.target.checked })}
          />
          <Form.Switch
            id="settings-tables"
            className="mb-2"
            label="Read tables"
            checked={settings.readTables}
            onChange={(e) => void updateSettings({ readTables: e.target.checked })}
          />
          <Form.Switch
            id="settings-images"
            className="mb-2"
            label="Read image alt text"
            checked={settings.readImageAlt}
            onChange={(e) => void updateSettings({ readImageAlt: e.target.checked })}
          />
          <Form.Switch
            id="settings-autoscroll"
            className="mb-2"
            label="Auto-scroll to the current block"
            checked={settings.autoScroll}
            onChange={(e) => void updateSettings({ autoScroll: e.target.checked })}
          />
          <Form.Switch
            id="settings-advance"
            label="Continue with the next file when one finishes"
            checked={settings.autoAdvanceFile}
            onChange={(e) => void updateSettings({ autoAdvanceFile: e.target.checked })}
          />
        </Form>
      </Modal.Body>
    </Modal>
  );
}
