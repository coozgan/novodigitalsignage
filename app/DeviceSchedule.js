'use client';

import { useEffect, useId, useRef, useState } from 'react';
import './schedule.css';

const value = input => input === null || input === undefined || input === '' ? 'Not specified' : String(input);
const duration = seconds => seconds === -1 ? 'Not specified by device (-1)' : seconds == null ? 'Not specified' : `${seconds} seconds`;
function localDate(input) {
  if (input === null || input === undefined || input === '' || input === -1) return 'Not set';
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? String(input) : date.toLocaleString();
}
function DayPattern({ mask }) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 127) return <span>{value(mask)}</span>;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return <div className="week-pattern" aria-label={`${days.filter((_, index) => mask & (1 << index)).join(', ') || 'None'} (weekMask: ${mask})`}>{days.map((day, index) => <span key={day} className={mask & (1 << index) ? 'is-active' : ''} aria-hidden="true">{day}</span>)}</div>;
}

export function ScheduleDetails({ schedule, checkedAt, selectedIndex, onSelect, onDelete, disabled }) {
  const radioGroup = useId();
  return <>
    <div className="schedule-context"><p>Times use your browser’s local timezone. The device timezone is unknown. These rules do not indicate current playback.</p>{checkedAt && <span>Last checked {localDate(checkedAt)}</span>}</div>
    {!schedule ? <div className="schedule-empty"><h3>No device schedule</h3><p>This device has no schedule to display. You can publish one from your studio.</p></div> : <>
      <div className="schedule-overview"><div><h3>{schedule.name === '_Delete_Schedule_' && !schedule.alarms.length ? 'Schedule cleared' : schedule.name || 'Unnamed schedule'}</h3><p>{schedule.description || 'No schedule description.'}</p></div><span className="badge">{schedule.alarms.length} {schedule.alarms.length === 1 ? 'entry' : 'entries'}</span></div>
      <p className="schedule-default">Default playlist <strong>{schedule.defaultPlaylist || 'None'}</strong></p>
      {!schedule.alarms.length ? <div className="schedule-empty"><h3>No schedule entries</h3><p>There are no playback rules in this device schedule.</p></div> : <div className="device-schedule-scroll" role="region" aria-label="Schedule entries" tabIndex={0}>
        <table className="device-schedule-table">
          <caption>Select an entry to manage it. Expand device details to inspect raw values.</caption>
          <thead><tr>{['Schedule entry', 'When it runs', 'Playlists', ''].map((column, index) => <th scope="col" key={index}>{column || <span className="sr-only">Actions</span>}</th>)}</tr></thead>
          <tbody>{schedule.alarms.map((alarm, index) => <tr key={index} className={selectedIndex === index ? 'is-selected' : ''}>
            <th scope="row"><div className="schedule-entry-title"><input type="radio" name={radioGroup} aria-label={`Select entry ${index + 1}: ${alarm.description || alarm.id || 'Unnamed entry'}`} checked={selectedIndex === index} disabled={disabled || !onSelect} onChange={() => onSelect?.(index)}/><div><strong>{alarm.description || `Entry ${index + 1}`}</strong><span className={`entry-state ${alarm.enabled ? 'enabled' : ''}`}><span className="status-dot"/>{alarm.enabled ? 'Enabled' : 'Disabled'}</span></div></div><details className="entry-details"><summary>Device details</summary><dl><div><dt>Entry</dt><dd>{index + 1}</dd></div><div><dt>ID</dt><dd>{value(alarm.id)}</dd></div><div><dt>Start bound</dt><dd>{alarm.startTime === -1 ? 'No bound' : value(alarm.startTime)}</dd></div><div><dt>End bound</dt><dd>{alarm.endTime === -1 ? 'No bound' : value(alarm.endTime)}</dd></div><div><dt>Week mask</dt><dd>{value(alarm.weekMask)}</dd></div></dl><p>Start/end values are preserved as reported. Their device encoding is unverified.</p></details></th>
            <td data-label="When it runs"><strong className="recurrence-label">{({0:'One-time',1:'Hourly',2:'Daily',3:'Weekly',4:'Monthly'})[alarm.type] || value(alarm.type)}</strong>{alarm.type === 3 && <DayPattern mask={alarm.weekMask}/>}<span className="schedule-date">Start: {localDate(alarm.dateTime)}</span>{alarm.dateTime != null && alarm.duration > 0 && <span className="schedule-date">End: {localDate(alarm.dateTime + alarm.duration * 1000)}</span>}<span className="schedule-duration">Duration: {duration(alarm.duration)}</span></td>
            <td data-label="Playlists">{!alarm.playlists.length ? <span className="muted">No playlists in this entry.</span> : <ul className="entry-playlists" aria-label={`Playlists for entry ${index + 1}`}>{alarm.playlists.map((playlist, item) => <li key={item}><strong>{playlist.name || 'Unnamed playlist'}</strong><span>{duration(playlist.duration)} · {playlist.repeat ? 'Repeats' : 'No repeat'}</span></li>)}</ul>}</td>
            <td className="entry-action"><button className="danger-quiet" type="button" disabled={disabled || !onDelete} aria-label={`Delete entry ${index + 1}: ${alarm.description || alarm.id || 'Unnamed entry'}`} onClick={() => onDelete?.(index)}>Delete entry</button></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </>}
  </>;
}

// A keyed child discards old device state immediately, including pending requests.
export default function DeviceSchedule({ device, onChanged }) {
  return <SchedulePanel key={`${device.id}:${device.ip}`} device={device} onChanged={onChanged}/>;
}

function SchedulePanel({ device, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [open, setOpen] = useState(false);
  const dialog = useRef(null);
  const titleId = useId();
  const pending = useRef(null);
  const url = `/api/devices/schedule?deviceId=${encodeURIComponent(device.id)}`;
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  async function act(action, entryIndex = selectedIndex) {
    if (pending.current) return;
    if (action === 'delete') {
      const alarm = Number.isInteger(entryIndex) && data?.schedule?.alarms[entryIndex];
      if (!data?.revision || !alarm || !window.confirm(`Delete entry ${entryIndex + 1}: ${alarm.description || alarm.id || 'Unnamed entry'} from ${device.name}? Only this entry will be removed. Other schedule entries, device playlists and local studio content will remain untouched. Playback may be affected. This cannot be undone here.`)) return;
    }
    if (action !== 'xml') setSelectedIndex(null);
    const controller = new AbortController();
    pending.current = controller;
    setBusy(action); setError(''); setMessage('');
    try {
      const response = await fetch(action === 'delete' ? '/api/devices/schedule' : `${url}${action === 'xml' ? '&format=xml' : ''}`, {
        cache: 'no-store', signal: controller.signal,
        ...(action === 'delete' ? { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: device.id, confirmed: true, revision: data.revision, entryIndex }) } : {}),
      });
      if (controller.signal.aborted) return;
      if (action === 'xml' && response.ok) {
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href; link.download = 'device-schedule.xml';
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
        setMessage('Schedule XML downloaded.');
        return;
      }
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || result.error) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || result.message || `Request failed (${response.status}).`);
      if (!Object.hasOwn(result, 'schedule') || (result.schedule !== null && (!Array.isArray(result.schedule?.alarms) || result.schedule.alarms.some(alarm => !alarm || !Array.isArray(alarm.playlists))))) throw new Error('Invalid schedule response. Refresh before deleting.');
      setSelectedIndex(null);
      setData(result);
      if (action === 'delete') {
        if (result.verified === true) setMessage(result.message || 'Schedule entry deleted and readback verified.');
        else setError(result.message || 'Schedule deletion is not verified. Refresh to check the device.');
        onChanged?.();
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(`${err.message} Refresh the device schedule before trying again.`);
        if (action !== 'xml') setData(null);
      }
    } finally {
      if (!controller.signal.aborted) { pending.current = null; setBusy(''); }
    }
  }

  return <section className="device-schedule" aria-label={`Device schedule for ${device.name}`}>
    <button type="button" className="schedule-launch" aria-haspopup="dialog" onClick={() => { setOpen(true); act('read'); }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3"/></svg><span>View device schedule</span><svg className="schedule-launch-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>
    <dialog ref={dialog} className="schedule-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (busy !== 'delete') setOpen(false); }} onClose={() => setOpen(false)}>
      <div className="schedule-dialog-head"><div><h2 id={titleId}>Device schedule</h2><p>{device.name} <span>·</span> <code>{device.ip}</code></p></div><button type="button" className="icon-button" aria-label="Close device schedule" disabled={busy === 'delete'} onClick={() => setOpen(false)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div>
      <div className="schedule-dialog-body" aria-busy={!!busy}>
        <div className="schedule-toolbar"><p>Playback rules stored on this device</p><button type="button" disabled={!!busy} onClick={() => act('read')}>{busy === 'read' ? 'Refreshing…' : 'Refresh device schedule'}</button></div>
        <p className="schedule-feedback" role="status" aria-live="polite">{busy ? (busy === 'delete' ? 'Deleting schedule entry…' : busy === 'xml' ? 'Downloading schedule XML…' : 'Reading device schedule…') : message}</p>
        {error && <p className="message error" role="alert">{error}</p>}
        {!data && !busy && !error && <div className="schedule-empty"><h3>Ready to read the schedule</h3><p>Refresh to read the current playback rules from this device.</p></div>}
        {!data && busy && <div className="schedule-loading" aria-hidden="true"><span/><span/><span/></div>}
        {data && (data.verified === false && data.schedule === null ? <p className="message">Schedule readback is unavailable. Refresh to check the device.</p> : <ScheduleDetails schedule={data.schedule} checkedAt={data.checkedAt} selectedIndex={selectedIndex} onSelect={setSelectedIndex} onDelete={index => act('delete', index)} disabled={!!busy || !data.revision}/>)}
      </div>
      <div className="schedule-dialog-footer"><p>Deletion affects only the selected entry. Playback may be affected. Other entries, device playlists and local content stay untouched.</p><div><button type="button" disabled={!!busy || !data} onClick={() => act('xml')}>Download schedule XML</button><button className="danger" type="button" disabled={!!busy || !data?.revision || selectedIndex === null} onClick={() => act('delete')}>Delete selected entry…</button></div></div>
    </dialog>
  </section>;
}
