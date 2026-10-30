'use client';

import { useEffect, useRef, useState } from 'react';

const value = input => input === null || input === undefined || input === '' ? 'Not specified' : String(input);
const duration = seconds => seconds === -1 ? 'Not specified by device (-1)' : seconds == null ? 'Not specified' : `${seconds} seconds`;
function localDate(input) {
  if (input === null || input === undefined || input === '' || input === -1) return 'Not set';
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? String(input) : date.toLocaleString();
}
function days(mask) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 127) return value(mask);
  return `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].filter((_, index) => mask & (1 << index)).join(', ') || 'None'} (weekMask: ${mask})`;
}

export function ScheduleDetails({ schedule, checkedAt }) {
  return <>
    <p><small>Dates and times are displayed in browser local time. Device timezone is unknown. Schedule rules do not indicate current playback. Start/end fields are preserved as raw device values because their encoding is unverified.</small></p>
    {checkedAt && <p><small>Last checked: {localDate(checkedAt)} (browser local time)</small></p>}
    {!schedule ? <p>No device schedule.</p> : <>
      <h4>{schedule.name === '_Delete_Schedule_' && !schedule.alarms.length ? 'Schedule cleared' : schedule.name || 'Unnamed schedule'}</h4>
      <p>{schedule.description || 'No schedule description.'}</p>
      <p>Default playlist: {schedule.defaultPlaylist || 'None'}</p>
      {!schedule.alarms.length ? <p>No schedule entries.</p> : <ol>{schedule.alarms.map((alarm, index) => <li key={`${alarm.id}:${index}`}>
        <h5>Entry {index + 1}{alarm.id ? ` (${alarm.id})` : ''}: {alarm.enabled ? 'Enabled' : 'Disabled'}</h5>
        <p>{alarm.description || 'No entry description.'}</p>
        <dl>
          <dt>Type</dt><dd>{({0:'One-time',1:'Hourly',2:'Daily',3:'Weekly',4:'Monthly'})[alarm.type] || value(alarm.type)}</dd>
          <dt>Date/time (browser local time)</dt><dd>{localDate(alarm.dateTime)}</dd>
          <dt>Start bound</dt><dd>{alarm.startTime === -1 ? 'No bound' : value(alarm.startTime)}</dd>
          <dt>End bound</dt><dd>{alarm.endTime === -1 ? 'No bound' : value(alarm.endTime)}</dd>
          <dt>Duration</dt><dd>{duration(alarm.duration)}</dd>
          <dt>Days</dt><dd>{days(alarm.weekMask)}</dd>
        </dl>
        {!alarm.playlists.length ? <p>No playlists in this entry.</p> : <ul aria-label={`Playlists for entry ${index + 1}`}>{alarm.playlists.map((playlist, item) => <li key={item}>{playlist.name || 'Unnamed playlist'} · Duration: {duration(playlist.duration)} · Repeat: {playlist.repeat ? 'Yes' : 'No'}</li>)}</ul>}
      </li>)}</ol>}
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
  const pending = useRef(null);
  const url = `/api/devices/schedule?deviceId=${encodeURIComponent(device.id)}`;
  useEffect(() => () => pending.current?.abort(), []);

  async function act(action) {
    if (pending.current) return;
    if (action === 'delete' && (!data?.revision || !window.confirm(`Clear only the device schedule on ${device.name}? Device playlists and local studio content will not be deleted. This may affect playback. This cannot be undone here.`))) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(action); setError(''); setMessage('');
    try {
      const response = await fetch(action === 'delete' ? '/api/devices/schedule' : `${url}${action === 'xml' ? '&format=xml' : ''}`, {
        cache: 'no-store', signal: controller.signal,
        ...(action === 'delete' ? { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: device.id, confirmed: true, revision: data.revision }) } : {}),
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
      setData(result);
      if (action === 'delete') {
        if (result.verified === true) setMessage(result.message || 'Device schedule cleared and readback verified.');
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

  return <section className="remote-controls" aria-label={`Device schedule for ${device.name}`} aria-busy={!!busy}>
    <h3>Device schedule: {device.name}</h3>
    <button type="button" disabled={!!busy} onClick={() => act('read')}>{data ? 'Refresh device schedule' : 'View device schedule'}</button>
    <p role="status" aria-live="polite">{busy ? (busy === 'delete' ? 'Clearing device schedule…' : 'Reading device schedule…') : message}</p>
    {error && <p role="alert">{error}</p>}
    {data && <>
      {data.verified === false && data.schedule === null ? <p>Schedule readback is unavailable. Refresh to check the device.</p> : <ScheduleDetails schedule={data.schedule} checkedAt={data.checkedAt}/>}
      <button type="button" disabled={!!busy} onClick={() => act('xml')}>Download schedule XML</button>{' '}
      <button type="button" disabled={!!busy || !data.revision || !data.schedule} onClick={() => act('delete')}>Delete device schedule…</button>
      <p><small>Clears only this device’s schedule, not device playlists or local studio content. Playback may be affected.</small></p>
    </>}
  </section>;
}
