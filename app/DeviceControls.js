'use client'
import {useEffect,useState} from 'react'
import {orientations} from '../lib/control.mjs'

export default function DeviceControls({device,onChanged,developerMode=false}) {
  const [data,setData]=useState(null), [busy,setBusy]=useState(false), [error,setError]=useState(''), [message,setMessage]=useState('')
  const [playlist,setPlaylist]=useState(''), [volume,setVolume]=useState(''), [orientation,setOrientation]=useState('Landscape'), [zoom,setZoom]=useState(100), [name,setName]=useState('')
  function apply(status) {
    if(!status) return
    setVolume(status.volume?.current ?? '')
    setOrientation(status.orientation || 'Landscape')
    setZoom(status.zoom ?? 100)
    setName(status.name || '')
  }
  async function refresh(signal) {
    setBusy(true); setError('')
    try {
      const response=await fetch(`/api/devices/control?deviceId=${encodeURIComponent(device.id)}`,{signal,cache:'no-store'})
      const result=await response.json()
      if(!response.ok) throw new Error(result.error || 'Unable to read device controls')
      setData(result); apply(result.status)
      setPlaylist(previous=>result.playlists.some(p=>p.name===previous)?previous:result.playlists[0]?.name || '')
      if(!result.reachable) setError('Device is unreachable. Refresh before sending controls.')
    } catch(err) { if(err.name!=='AbortError') setError(err.message) }
    finally { if(!signal?.aborted) setBusy(false) }
  }
  useEffect(()=> {
    const controller=new AbortController()
    setData(null); setMessage(''); setPlaylist('')
    refresh(controller.signal)
    return ()=>controller.abort()
  },[device.id])
  async function send(action,value) {
    if(action==='delete' && !window.confirm(`Delete “${value}” from ${data?.status?.name || device.name}? This removes the device copy and cannot be undone here. Schedules using it may stop working. Local studio content is not deleted.`)) return
    if(['play','stop'].includes(action) && !window.confirm(`${action==='play'?'Replace current playback with the selected playlist':'Stop current playback'} on ${data?.status?.name || device.name}? This interrupts the current signage.`)) return
    if(action==='reboot' && !window.confirm(`Reboot ${data?.status?.name || device.name}? Playback will be interrupted.`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      const response=await fetch('/api/devices/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:device.id,action,value,...(action==='delete'?{confirmed:true}:{})})})
      const result=await response.json()
      if(!response.ok) throw new Error(result.error || 'Control request failed')
      setMessage(result.message)
      if(action==='delete') {
        setData(previous=>({...previous,playlists:result.playlists || []}))
        setPlaylist('')
      }
      if(result.status) { setData(previous=>({...previous,status:result.status})); apply(result.status) }
      onChanged?.(result)
    } catch(err) { setError(err.message) }
    finally { setBusy(false) }
  }
  const range=data?.status?.volume
  return <section className="remote-controls" aria-label={`Remote controls for ${data?.status?.name || device.name}`} aria-busy={busy}>
    <h3>Remote controls: {data?.status?.name || device.name}</h3>
    <button type="button" disabled={busy} onClick={()=>refresh()}>Refresh controls</button>
    <p role="status" aria-live="polite">{busy?'Communicating with device…':message}</p>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={busy || !data?.reachable}>
      <legend>Playback and device settings</legend>
      <div><label>Existing playlist <select value={playlist} onChange={e=>setPlaylist(e.target.value)}><option value="">Select playlist</option>{data?.playlists.map(p=><option key={p.name} value={p.name}>{p.name} ({p.size})</option>)}</select></label> <button type="button" disabled={!playlist} onClick={()=>send('play',playlist)}>Play playlist</button> <button type="button" onClick={()=>send('stop')}>Stop playback</button></div>
      <div><button type="button" disabled={!playlist} onClick={()=>send('delete',playlist)}>Delete selected playlist…</button> <small>Removes only the device copy. Stop its playback first.</small></div>
      <div><label>Volume {range?`(${range.min}–${range.max})`:'(range unavailable)'} <input type="number" min={range?.min} max={range?.max} step="1" disabled={!range} value={volume} onChange={e=>setVolume(e.target.value)}/></label> <button type="button" disabled={!range || volume===''} onClick={()=>send('volume',Number(volume))}>Set volume</button></div>
      <div><label>Orientation <select value={orientation} onChange={e=>setOrientation(e.target.value)}>{orientations.map(o=><option key={o}>{o}</option>)}</select></label> <button type="button" onClick={()=>send('orientation',orientation)}>Set orientation</button></div>
      <div><label>Screen zoom (80–100%) <input type="number" min="80" max="100" step="1" value={zoom} onChange={e=>setZoom(e.target.value)}/></label> <button type="button" disabled={zoom===''} onClick={()=>send('zoom',Number(zoom))}>Set zoom</button></div>
      <div><label>Device name <input maxLength="20" value={name} onChange={e=>setName(e.target.value)}/></label> <button type="button" disabled={!name.trim()} onClick={()=>send('name',name.trim())}>Rename device</button></div>
      <button type="button" onClick={()=>send('reboot',true)}>Reboot device…</button>
    </fieldset>
    <p><small>Settings are checked against device readback. Check the screen after changing playback or rebooting.</small></p>
    <p><small>Replacing playlist content is not available yet. Deleting a playlist does not upload a replacement.</small></p>
    {developerMode && <details><summary>Developer details</summary><p>Deletion uses the native DELETE command with a freshly read playlist allowlist. Verification means only that a valid subsequent GET_PLAYLISTS list omits the selected name. No delete-specific acknowledgement is known. Content upload is blocked on native XML/package and ciphertext validation, not firmware update.</p></details>}
  </section>
}
