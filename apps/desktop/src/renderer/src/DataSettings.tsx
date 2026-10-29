import { useState } from 'react';
import { Database, Bell, Download, RefreshCw, Upload } from 'lucide-react';
import type { Snapshot, Command } from '@dock/contracts';
import { Button } from '@/components/ui/button';
import { errorMessage, type Dispatch } from './state';
export function DataSettings({ snapshot, dispatch, section }: { snapshot: Snapshot; dispatch: Dispatch; section: "backups" | "reminders"; }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  async function run(command: Command) {
    setBusy(true);
    setFailure('');
    try { await dispatch(command); } catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); }
  }
  const services = snapshot.localServices;
  return <>
    {section === "backups" && <section>
      <h2><Database size="1.0625rem" />Backup &amp; import</h2>
      <p>Automatic daily backups stay on this computer. Restoring recovers missing or deleted records and preserves current items. Keep an exported copy somewhere safe.</p>
      <div className="settings-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void run({ type: 'backup.create' })}>
          <Download size="0.9375rem" />Back up now
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void run({ type: 'backup.import', format: 'json' })}>
          <Upload size="0.9375rem" />Import JSON
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void run({ type: 'backup.import', format: 'todoist' })}>
          <Upload size="0.9375rem" />Import Todoist CSV
        </Button>
      </div>
      <div className="backup-list">
        {services.backups.length ? services.backups.map(backup => <div className="deleted-row" key={backup.name}>
          <div>
            <strong>{new Date(backup.createdAt).toLocaleString()}</strong>
            <small>{Math.ceil(backup.size / 1024)} KB · {backup.name}</small>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run({ type: 'backup.restore', name: backup.name })}>Restore missing items</Button>
        </div>) : <p className="muted">Your first backup will appear here.</p>}
      </div>
      {services.message && <p role="status">{services.message}</p>}
    </section>}
    {section === "reminders" && <section>
      <h2><Bell size="1.0625rem" />Reminder activity</h2>
      <p>“Shown” means the operating system acknowledged displaying the notification. It does not confirm you read it. Failed attempts retry up to three times; quiet hours pause delivery.</p>
      <div className="reminder-log">
        {services.reminderLog.length ? services.reminderLog.slice(0, 30).map(entry => <div className="reminder-log-row" key={entry.key}>
          <div>
            <strong>{entry.title}</strong>
            <small>{new Date(entry.dueAt).toLocaleString()} · {entry.attempts} attempts{entry.error && ` · ${entry.error}`}</small>
          </div>
          <span className={`reminder-status ${entry.status}`}>
            {entry.status === 'shown' ? 'Shown' : entry.status === 'pending' ? 'Retry pending' : 'Failed'}
          </span>
          {entry.status === 'failed' && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run({ type: 'reminder.retry', key: entry.key })}>
            <RefreshCw size="0.875rem" />Retry
          </Button>}
        </div>) : <p className="muted">Reminder attempts will appear here when tasks become due.</p>}
      </div>
    </section>}
    {failure && <p className="note-error" role="alert">{failure}</p>}
  </>;
}
