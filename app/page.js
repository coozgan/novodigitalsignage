'use client';

import { useEffect, useRef, useState } from 'react';
import DeviceControls from './DeviceControls';
import DeviceSnapshot from './DeviceSnapshot';

const tabs = ['Devices', 'Library', 'Playlists', 'Schedules', 'Settings'];
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const emptyStudio = { media: [], playlists: [], schedules: [] };
const uid = () => crypto.randomUUID();
const bytes = (size) => size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.ceil((size || 0) / 1024)} KB`;

async function request(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`${url}: invalid server response (${response.status}).`); }
  if (!response.ok || data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || `Request failed (${response.status}).`);
  return data;
}
const json = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function Icon({ name, size = 20 }) {
  const paths = {
    Devices: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></>,
    Library: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 3-3 5 5"/></>,
    Playlists: <><path d="M4 5h12M4 10h12M4 15h6M4 20h6"/><path d="m15 14 6 4-6 4z"/></>,
    Schedules: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3"/></>,
    Settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM12 8v5m0 3v1"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.Devices}</svg>;
}

function Modal({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="dialog-title"><div className="modal-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}>×</button></div>{children}</dialog>;
}
function Preview({ media, controls = false }) {
  if (media.type === 'image' || media.type?.startsWith('image/')) return <img src={media.url} alt={media.name} loading="lazy"/>;
  if (media.type === 'video' || media.type?.startsWith('video/')) return <video src={media.url} controls={controls} preload="metadata" playsInline aria-label={media.name}/>;
  return <div className="file-placeholder"><Icon name="Library" size={34}/><span>{media.type || 'Media file'}</span></div>;
}

export default function Studio() {
  // ponytail: component state covers this local workspace; add multi-user sync only when needed.
  const [tab, setTab] = useState('Devices');
  const [developerMode, setDeveloperMode] = useState(false);
  useEffect(() => { try { setDeveloperMode(localStorage.getItem('novods-developer-mode') === 'true'); } catch {} }, []);
  function toggleDeveloperMode(enabled) { setDeveloperMode(enabled); try { localStorage.setItem('novods-developer-mode', String(enabled)); } catch { setNotice('Setting changed for this session. Browser storage is unavailable.'); } }
  const [studio, setStudio] = useState(emptyStudio);
  const [loaded, setLoaded] = useState(false);
  const [devices, setDevices] = useState([]);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [snapshotRefresh, setSnapshotRefresh] = useState(0);
  const [addingDevice, setAddingDevice] = useState(false);
  const [newDevice, setNewDevice] = useState({name:'',ip:''});
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState(null);
  const [preview, setPreview] = useState(null);
  const [deploy, setDeploy] = useState(null);
  const [reading, setReading] = useState(null);
  const [removingDevice, setRemovingDevice] = useState(null);
  const [deletingItem, setDeletingItem] = useState(null);
  const fileInput = useRef(null);

  async function loadStudio() {
    try {
      const data = await request('/api/studio');
      if (!['media', 'playlists', 'schedules'].every(key => Array.isArray(data[key]))) throw new Error('Studio response is missing media, playlists, or schedules.');
      setStudio(data); setLoaded(true);
    } catch (err) { setError(`Could not load studio: ${err.message}`); }
  }
  async function loadDevices() {
    try {
      const data = await request('/api/devices');
      if (!Array.isArray(data.devices)) throw new Error('Device response is missing the devices list.');
      setDevices(data.devices); setDeviceLoaded(true); setSnapshotRefresh(value => value + 1);
      setSelected(current => current.filter(id => data.devices.some(device => device.id === id)));
    } catch (err) { setError(`Could not discover devices: ${err.message}`); }
  }
  useEffect(() => { loadStudio(); loadDevices(); }, []);
  async function run(label, task) {
    if (busy) return;
    setBusy(label); setError(''); setNotice('');
    try { await task(); } catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  async function persist(next) {
    if (!loaded) throw new Error('Load studio data successfully before saving changes.');
    const saved = await request('/api/studio', json({ ...next, revision: studio.revision }, 'PUT'));
    setStudio(saved);
  }
  function newEditor(kind, value) {
    setError('');
    setEditor({ kind, value: value ? structuredClone(value) : kind === 'playlist' ? { id: uid(), name: '', items: [], width: 1920, height: 1080 } : { id: uid(), name: '', playlistId: studio.playlists[0]?.id || '', start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] } });
  }
  function patch(value) { setEditor(current => ({ ...current, value: { ...current.value, ...value } })); }
  function saveEditor(event) {
    event.preventDefault();
    run('Saving', async () => {
      const { kind, value } = editor;
      const item = { ...value, name: value.name.trim() };
      if (!item.name) throw new Error('Enter a name.');
      if (kind === 'playlist') {
        if (!Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width < 1 || item.height < 1) throw new Error('Canvas dimensions must be positive whole numbers.');
        if (!item.items.length) throw new Error('Add at least one media item.');
        if (item.items.some(entry => !studio.media.some(media => media.id === entry.mediaId) || !Number.isFinite(entry.duration) || entry.duration < 1)) throw new Error('Each item needs existing media and a duration of at least one second.');
      } else {
        if (!studio.playlists.some(list => list.id === item.playlistId)) throw new Error('Select an existing playlist.');
        if (!item.days.length) throw new Error('Select at least one day.');
        if (!item.start || !item.end || item.start >= item.end) throw new Error('End time must be later than start time. Split overnight playback into two schedules.');
      }
      const key = kind === 'playlist' ? 'playlists' : 'schedules';
      const collection = studio[key].some(entry => entry.id === item.id) ? studio[key].map(entry => entry.id === item.id ? item : entry) : [...studio[key], item];
      await persist({ ...studio, [key]: collection });
      setEditor(null); setNotice(`${kind === 'playlist' ? 'Playlist' : 'Schedule'} saved to studio.`);
    });
  }
  function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    run('Uploading', async () => {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) throw new Error('Choose an image or video file.');
      if (file.size > 1024 ** 3) throw new Error('Media must be 1 GiB or smaller.');
      const result = await request('/api/media', { method: 'POST', headers: {'Content-Type':file.type || 'application/octet-stream','X-File-Name':encodeURIComponent(file.name)}, body:file });
      const media = result.media || result;
      if (!media.id || !media.url || !media.name) throw new Error('Upload response is missing media details.');
      setStudio(current => ({ ...current, revision: result.revision ?? current.revision, media: [...current.media.filter(item => item.id !== media.id), media] }));
      setNotice(`${media.name} uploaded and saved to library.`);
    });
  }
  const verified = devices.length > 0 && devices.every(device => device.protocolVerified);
  const filteredMedia = studio.media.filter(media => media.name.toLowerCase().includes(search.toLowerCase()));
  const heading = { Devices: ['Your display network', 'Manage your signage players in one workspace.'], Library: ['A home for your content', 'Upload images and videos up to 1 GiB per file. Player limits depend on device support.'], Playlists: ['Make every frame count', 'Arrange your media into a precise playback sequence.'], Schedules: ['The right content, on time', 'Plan recurring playback for your display network.'], Settings: ['Settings', 'Choose how this browser displays your workspace.'] }[tab];

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="NovoDS Studio home"><span className="brand-mark"><i/><i/><i/></span><span>NovoDS<span className="brand-sub">Studio</span></span></a>
      <div className="workspace"><span className="workspace-icon">N</span><div>My workspace<small>DS200 signage studio</small></div><span className="workspace-chevron">⌄</span></div>
      <div className="nav-caption">Workspace</div>
      <nav aria-label="Studio sections">{tabs.map(name => <button key={name} className={`nav-item ${tab === name ? 'active' : ''}`} onClick={() => { setTab(name); setSearch(''); }} aria-current={tab === name ? 'page' : undefined}><Icon name={name}/><span>{name}</span>{name !== 'Settings' && <span className="nav-count">{name === 'Devices' ? devices.length : studio[name === 'Library' ? 'media' : name.toLowerCase()]?.length ?? 0}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="local-dot"/> Local workspace<small>Content stays in your studio.</small><div className="version">NovoDS Studio <span>DS200</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{tab}</strong></div>{developerMode && <span className={`badge ${verified ? 'green' : 'amber'}`}><Icon name="shield" size={14}/>{verified ? 'Control channel verified' : 'Control channel unverified'}</span>}</header>
      <main id="main-content">
        <section className="page-heading"><div><h1>{heading[0]}</h1><p>{heading[1]}</p></div><div className="heading-actions">{tab === 'Devices' ? <button disabled={!!busy} onClick={() => run('Refreshing', loadDevices)}><Icon name="refresh" size={16}/>{busy === 'Refreshing' ? 'Refreshing…' : 'Refresh devices'}</button> : tab === 'Library' ? <button className="primary" disabled={!!busy || !loaded} onClick={() => fileInput.current.click()}><Icon name="upload" size={16}/>{busy === 'Uploading' ? 'Uploading…' : 'Upload media'}</button> : tab !== 'Settings' && <button className="primary" disabled={!loaded || !!busy} onClick={() => newEditor(tab === 'Playlists' ? 'playlist' : 'schedule')}>+ New {tab === 'Playlists' ? 'playlist' : 'schedule'}</button>}</div></section>
        {tab === 'Settings' && <section className="remote-controls" aria-label="Developer settings"><label><input type="checkbox" checked={developerMode} onChange={event => { toggleDeveloperMode(event.target.checked); setReading(null); }}/> Developer mode</label><p>Show advanced device diagnostics. Off by default. This display preference is saved in this browser and does not change device access.</p></section>}
        {error && <div role="alert" className="message error"><strong>Action needs attention</strong><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        {notice && <div role="status" className="message success">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notification">×</button></div>}
        {!loaded && <div className="load-notice">Studio data is not loaded. Editing is unavailable until the API responds. <button disabled={!!busy} onClick={() => run('Loading', loadStudio)}>Retry studio</button></div>}
        {tab === 'Devices' && <>
          <div className="heading-actions"><button className="primary" disabled={!!busy} onClick={() => {setNewDevice({name:'',ip:''});setAddingDevice(true);}}>+ Add device</button><button disabled={!!busy || !devices.length} onClick={() => setSelected(devices.map(device => device.id))}>Select all</button><button disabled={!!busy || !selected.length} onClick={() => setSelected([])}>Clear selection</button><span className="muted">{selected.length} selected</span><button disabled={!!busy || !loaded} onClick={() => { setError(''); setDeploy({ kind: 'playlist', item: studio.playlists[0] || null }); }}>Publish content</button><button disabled={!!busy || !loaded} onClick={() => { setError(''); setDeploy({ kind: 'schedule', item: studio.schedules[0] || null }); }}>Publish schedule</button></div>
          <p className="load-notice">Publishing is currently unavailable while support for the player’s content format is completed. You can prepare playlists, schedules, and targets, but nothing will be sent.</p>
          <section className="fleet-summary" aria-label="Fleet summary"><div><span className="summary-icon"><Icon name="Devices" size={23}/></span><div><span>Display players</span><strong>{deviceLoaded ? devices.length : '…'} <small>configured</small></strong></div></div><div><span className="status-dot green-dot"/><div><span>Reachable</span><strong>{deviceLoaded ? devices.filter(device => device.reachable).length : '…'} <small>on the network</small></strong></div></div>{developerMode && <div><span className="status-dot amber-dot"/><div><span>Protocol verified</span><strong>{deviceLoaded ? devices.filter(device => device.protocolVerified).length : '…'} <small>responding to status queries</small></strong></div></div>}</section>
          <div className="section-heading"><h2>Connected devices <span>{devices.length}</span></h2><span className="muted">Live device discovery</span></div>
          <div className="device-grid">{devices.map((device, index) => <article className={`device-card ${selected.includes(device.id) ? 'selected' : ''}`} key={device.id}>
            <div className="device-card-top"><span className={`badge ${device.reachable ? 'green' : 'neutral'}`}><span className={`status-dot ${device.reachable ? 'green-dot' : ''}`}/>{device.reachable ? 'Reachable' : 'Unreachable'}</span><label className="select-device"><input type="checkbox" aria-label={`Select ${device.name}`} checked={selected.includes(device.id)} onChange={event => setSelected(current => event.target.checked ? [...current, device.id] : current.filter(id => id !== device.id))}/>Select</label></div>
            <DeviceSnapshot device={device} refresh={snapshotRefresh}/>
            <div className="device-info"><h3>{device.name}</h3><span className="device-model">{device.model || 'DS200'}</span></div><div className="device-address"><span>IP address</span><code>{device.ip || 'Not provided'}</code></div>{developerMode && <><div className="device-address"><span>Native protocol</span><span className={device.protocolVerified ? 'green-text' : 'amber-text'}>{device.protocolVerified ? 'Verified' : 'Unverified'}</span></div><p className="device-detail">{typeof device.detail === 'string' ? device.detail : device.detail ? JSON.stringify(device.detail) : 'Read-only queries are available. Deployment requires protocol verification.'}</p></>}
            <div className="device-actions"><a className="button" href={`/api/devices/screenshot?deviceId=${encodeURIComponent(device.id)}`} target="_blank" rel="noreferrer">Screenshot</a>{developerMode && ['status', 'playlists'].map(action => <button key={action} disabled={!!busy} onClick={() => run('Reading device', async () => { const data = await request('/api/devices', json({ deviceId: device.id, action })); setReading({ title: `${device.name}: ${action}`, data }); })}>{action === 'status' ? 'Read status' : 'Read playlists'}<Icon name="arrow" size={15}/></button>)}<button disabled={!!busy} onClick={() => { setError(''); setRemovingDevice(device); }}>Remove device</button></div>
            <DeviceControls device={device} developerMode={developerMode} onChanged={loadDevices}/>
          </article>)}</div>
          {!devices.length && <div className="empty-state"><Icon name="Devices" size={36}/><h3>{deviceLoaded ? 'No players added' : 'Loading your players'}</h3><p>Add a device by its LAN IP address, or refresh to query your saved players. No device status is simulated.</p></div>}
          {developerMode && <div className="protocol-note"><span className="note-icon"><Icon name="shield" size={22}/></span><div><h3>Connected does not mean deployment-ready.</h3><p>Device controls communicate directly over the local network. Close native NovoDS Studio before taking screenshots. Status connectivity does not verify content deployment.</p></div><span className="badge amber">Local network</span></div>}
        </>}
        {tab === 'Library' && <>
          <div className="library-toolbar"><label className="search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search your media…" aria-label="Search media" value={search} onChange={event => setSearch(event.target.value)}/></label><span className="muted">{studio.media.length} assets · {bytes(studio.media.reduce((total, media) => total + (media.size || 0), 0))}</span></div>
          <button className="upload-zone" disabled={!loaded || !!busy} onClick={() => fileInput.current.click()}><span className="upload-symbol"><Icon name="upload" size={25}/></span><strong>Add something worth showing</strong><span>Select an image or video to upload to your library</span><span className="upload-link">Browse files</span></button>
          <div className="media-grid">{filteredMedia.map(media => <button className="media-card" key={media.id} onClick={() => setPreview(media)}><div className="media-thumb"><Preview media={media}/><span className="media-type">{media.type === 'video' || media.type?.startsWith('video/') ? 'Video' : 'Image'}</span></div><div className="media-meta"><strong>{media.name}</strong><span>{bytes(media.size)}<span>Preview ↗</span></span></div></button>)}</div>
          {!filteredMedia.length && <p className="muted empty-caption">{search ? 'No media matches your search.' : 'Your library is empty. Upload your first asset to get started.'}</p>}
        </>}
        {tab === 'Playlists' && <div className="collection-grid">{studio.playlists.map(list => <article className="collection-card" key={list.id}><div className="collection-art"><Icon name="Playlists" size={32}/><span>{list.width} × {list.height}</span></div><div className="collection-body"><h3>{list.name}</h3><p>{list.items.length} items · {list.items.reduce((sum, item) => sum + item.duration, 0)} seconds</p><ol className="mini-sequence">{list.items.slice(0, 3).map((item, index) => <li key={index}>{studio.media.find(media => media.id === item.mediaId)?.name || 'Missing media'}<span>{item.duration}s</span></li>)}</ol><div className="card-actions"><button disabled={!!busy} onClick={() => newEditor('playlist', list)}>Edit playlist</button><button disabled={!!busy} onClick={() => { setError(''); setDeletingItem({ kind: 'playlist', item: list }); }}>Delete</button><button className="primary" disabled={!!busy} onClick={() => setDeploy({ kind: 'playlist', item: list })}>Publish<Icon name="arrow" size={15}/></button></div></div></article>)}{!studio.playlists.length && <div className="empty-state"><Icon name="Playlists" size={36}/><h3>Your next story starts here</h3><p>Create a playlist, add media, and set the order and duration.</p><button disabled={!loaded || !!busy} onClick={() => newEditor('playlist')}>+ Create playlist</button></div>}</div>}
        {tab === 'Schedules' && <div className="schedule-list">{studio.schedules.map(schedule => <article className="schedule-card" key={schedule.id}><span className="schedule-icon"><Icon name="Schedules" size={25}/></span><div className="schedule-info"><h3>{schedule.name}</h3><p>{studio.playlists.find(list => list.id === schedule.playlistId)?.name || 'Missing playlist'}</p><div className="schedule-days">{weekdays.map((day, index) => <span key={day} className={schedule.days.includes(index) ? 'enabled' : ''}>{day}</span>)}</div></div><div className="schedule-time"><strong>{schedule.start} <span>–</span> {schedule.end}</strong><small>Recurring · player local time</small></div><div className="card-actions"><button disabled={!!busy} onClick={() => newEditor('schedule', schedule)}>Edit</button><button disabled={!!busy} onClick={() => { setError(''); setDeletingItem({ kind: 'schedule', item: schedule }); }}>Delete</button><button className="primary" disabled={!!busy} onClick={() => setDeploy({ kind: 'schedule', item: schedule })}>Publish<Icon name="arrow" size={15}/></button></div></article>)}{!studio.schedules.length && <div className="empty-state"><Icon name="Schedules" size={36}/><h3>Give your content a rhythm</h3><p>Create a recurring schedule from a saved playlist.</p><button disabled={!loaded || !!busy} onClick={() => newEditor('schedule')}>+ Create schedule</button></div>}</div>}
        <input ref={fileInput} className="sr-only" type="file" accept="image/*,video/*" aria-label="Upload media file" onChange={upload} disabled={!loaded || !!busy}/>
        <footer><span>NovoDS Studio</span><span>Built for your DS200 display network</span></footer>
      </main>
    </div>
    {addingDevice && <Modal title="Add device" onClose={() => {if(!busy) setAddingDevice(false);}}><form onSubmit={event => {event.preventDefault();run('Adding device',async () => {await request('/api/devices',json({action:'add',...newDevice}));setAddingDevice(false);await loadDevices();setNotice('Device added to your workspace.');});}}><fieldset disabled={!!busy}><label>Device name<input required maxLength={200} value={newDevice.name} onChange={event => setNewDevice(value => ({...value,name:event.target.value}))}/></label><label>IP address<input required placeholder="192.168.1.100" value={newDevice.ip} onChange={event => setNewDevice(value => ({...value,ip:event.target.value}))}/></label>{error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" onClick={() => setAddingDevice(false)}>Cancel</button><button className="primary" type="submit">{busy?'Adding…':'Add device'}</button></div></fieldset></form></Modal>}
    {preview && <Modal title={preview.name} onClose={() => setPreview(null)}><div className="large-preview"><Preview media={preview} controls/></div><p className="muted">{preview.type} · {bytes(preview.size)}</p><div className="modal-actions"><button disabled={!!busy} onClick={() => { const item = preview; setPreview(null); setError(''); setDeletingItem({ kind: 'media', item }); }}>Delete asset</button><button className="primary" onClick={() => setPreview(null)}>Close</button></div></Modal>}
    {reading && developerMode && <Modal title={reading.title} onClose={() => setReading(null)}><p className="muted">Live read-only response from the device API.</p><pre className="response-data">{JSON.stringify(reading.data, null, 2)}</pre></Modal>}
    {editor && <Modal title={`${studio[editor.kind === 'playlist' ? 'playlists' : 'schedules'].some(item => item.id === editor.value.id) ? 'Edit' : 'New'} ${editor.kind}`} onClose={() => { if (!busy) setEditor(null); }}><form onSubmit={saveEditor}><fieldset disabled={!!busy}><label>Name<input required maxLength={120} value={editor.value.name} placeholder={editor.kind === 'playlist' ? 'e.g. Welcome display' : 'e.g. Weekday mornings'} onChange={event => patch({ name: event.target.value })}/></label>
      {editor.kind === 'playlist' ? <>
        <div className="form-row"><label>Width (px)<input type="number" min="1" step="1" required value={editor.value.width} onChange={event => patch({ width: Number(event.target.value) })}/></label><label>Height (px)<input type="number" min="1" step="1" required value={editor.value.height} onChange={event => patch({ height: Number(event.target.value) })}/></label></div>
        <div className="editor-section"><h3>Playback sequence</h3><span className="muted">{editor.value.items.length} items</span></div>
        {!editor.value.items.length && <p className="inline-empty">Add media below. Items play from top to bottom.</p>}
        <ol className="item-editor">{editor.value.items.map((item, index) => <li key={index}><span className="item-number">{index + 1}</span><strong>{studio.media.find(media => media.id === item.mediaId)?.name || 'Missing media'}</strong><label className="duration">Seconds<input type="number" min="1" required value={item.duration} onChange={event => patch({ items: editor.value.items.map((entry, position) => position === index ? { ...entry, duration: Number(event.target.value) } : entry) })}/></label><div className="item-buttons"><button type="button" aria-label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => { const items = [...editor.value.items]; [items[index - 1], items[index]] = [items[index], items[index - 1]]; patch({ items }); }}>↑</button><button type="button" aria-label={`Move item ${index + 1} down`} disabled={index === editor.value.items.length - 1} onClick={() => { const items = [...editor.value.items]; [items[index + 1], items[index]] = [items[index], items[index + 1]]; patch({ items }); }}>↓</button><button type="button" aria-label={`Remove item ${index + 1}`} onClick={() => patch({ items: editor.value.items.filter((_, position) => position !== index) })}>×</button></div></li>)}</ol>
        <label>Add media<select value="" onChange={event => { if (event.target.value) patch({ items: [...editor.value.items, { mediaId: event.target.value, duration: 10 }] }); }}><option value="">{studio.media.length ? 'Choose a library asset…' : 'Upload media in Library first'}</option>{studio.media.map(media => <option key={media.id} value={media.id}>{media.name}</option>)}</select></label>
      </> : <>
        <label>Playlist<select required value={editor.value.playlistId} onChange={event => patch({ playlistId: event.target.value })}><option value="">Choose a playlist…</option>{studio.playlists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
        <div className="form-row"><label>Start time<input type="time" required value={editor.value.start} onChange={event => patch({ start: event.target.value })}/></label><label>End time<input type="time" required value={editor.value.end} onChange={event => patch({ end: event.target.value })}/></label></div><p className="muted">Times use the player’s local timezone. End must be after start.</p>
        <fieldset className="days-field"><legend>Repeat on</legend>{weekdays.map((day, index) => <label key={day} className="day-toggle"><input type="checkbox" checked={editor.value.days.includes(index)} onChange={event => patch({ days: event.target.checked ? [...editor.value.days, index].sort() : editor.value.days.filter(value => value !== index) })}/><span>{day}</span></label>)}</fieldset>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" onClick={() => setEditor(null)}>Cancel</button><button className="primary" type="submit">{busy === 'Saving' ? 'Saving…' : `Save ${editor.kind}`}</button></div></fieldset></form></Modal>}
    {removingDevice && <Modal title="Remove device" onClose={() => { if (!busy) setRemovingDevice(null); }}><p>Remove <strong>{removingDevice.name}</strong> from your workspace?</p><p className="muted">Your library, playlists, and schedules stay in the studio. The device can be added again at any time.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button disabled={!!busy} onClick={() => setRemovingDevice(null)}>Keep device</button><button className="primary" disabled={!!busy} onClick={() => run('Removing device', async () => { await request('/api/devices', json({ action: 'remove', deviceId: removingDevice.id, confirmed: true })); setDevices(current => current.filter(device => device.id !== removingDevice.id)); setSelected(current => current.filter(id => id !== removingDevice.id)); setRemovingDevice(null); setNotice(`${removingDevice.name} was removed from your workspace.`); })}>{busy === 'Removing device' ? 'Removing…' : 'Remove from workspace'}</button></div></Modal>}
    {deletingItem && (() => {
      const { kind, item } = deletingItem;
      const blockers = kind === 'playlist'
        ? studio.schedules.filter(s => s.playlistId === item.id)
        : kind === 'media'
        ? studio.playlists.filter(p => p.items?.some(i => i.mediaId === item.id))
        : [];
      const isBlocked = blockers.length > 0;
      return <Modal title={`Delete ${kind === 'media' ? 'media asset' : kind}`} onClose={() => { if (!busy) setDeletingItem(null); }}>
        <p>Delete <strong>{item.name}</strong> from your workspace?</p>
        {isBlocked ? (
          <div role="alert" className="form-error">
            Cannot delete: referenced by {kind === 'media' ? 'playlist' : 'schedule'}(s): {blockers.map(b => `"${b.name}"`).join(', ')}. Remove it from them first.
          </div>
        ) : (
          <p className="muted">
            {kind === 'media' ? 'This permanently removes the file from local storage and your library.' : 'This will remove the item from your workspace. Content on devices is unchanged.'}
          </p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button disabled={!!busy} onClick={() => setDeletingItem(null)}>{isBlocked ? 'Close' : 'Cancel'}</button>
          {!isBlocked && (
            <button className="primary" disabled={!!busy} onClick={() => run(`Deleting ${kind}`, async () => {
              const next = await request('/api/studio', json({ kind, id: item.id, revision: studio.revision, confirmed: true }, 'DELETE'));
              setStudio(next);
              setDeletingItem(null);
              setNotice(`${item.name} was removed from your workspace.`);
            })}>
              {busy ? 'Deleting…' : `Delete ${kind}`}
            </button>
          )}
        </div>
      </Modal>;
    })()}
    {deploy && <Modal title={deploy.kind === 'playlist' ? 'Publish content' : 'Publish schedule'} onClose={() => { if (!busy) setDeploy(null); }}>
      <fieldset disabled={!!busy} className="deploy-targets"><legend>{deploy.kind === 'playlist' ? 'Choose a playlist' : 'Choose a schedule'}</legend>{deploy.kind === 'playlist'
        ? <label>Playlist<select required value={deploy.item?.id || ''} onChange={event => setDeploy(current => ({ ...current, item: studio.playlists.find(list => list.id === event.target.value) }))}><option value="">{studio.playlists.length ? 'Choose a playlist…' : 'No saved playlists yet'}</option>{studio.playlists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
        : <label>Schedule<select required value={deploy.item?.id || ''} onChange={event => setDeploy(current => ({ ...current, item: studio.schedules.find(schedule => schedule.id === event.target.value) }))}><option value="">{studio.schedules.length ? 'Choose a schedule…' : 'No saved schedules yet'}</option>{studio.schedules.map(schedule => <option key={schedule.id} value={schedule.id}>{schedule.name}</option>)}</select></label>}</fieldset>
      <fieldset disabled={!!busy} className="deploy-targets"><legend>Target devices</legend>{devices.map(device => <label key={device.id}><input type="checkbox" checked={selected.includes(device.id)} onChange={event => setSelected(current => event.target.checked ? [...current, device.id] : current.filter(id => id !== device.id))}/><span>{device.name}<small>{device.ip}</small></span></label>)}{!devices.length && <p>No devices loaded. Refresh the Devices tab first.</p>}</fieldset>
      <div className="deploy-warning"><Icon name="shield"/><span>Publishing is unavailable right now: support for the player’s content format is still being completed. You can review your choices here, but nothing is sent and players are not changed.</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button disabled={!!busy} onClick={() => setDeploy(null)}>Close</button></div>
    </Modal>}
  </div>;
}
