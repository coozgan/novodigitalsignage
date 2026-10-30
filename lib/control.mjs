// Commands recovered from NovoDS Studio x86_64: DeviceTCP::tcp_Play_Playlist,
// stopPlay and DeviceSettingDialog::rc_Set_* (REA Hopper evidence).
export const orientations=['Landscape','Portrait','Landscape-R','Portrait-R']
export const volumeQuery='REMOTE_CONTROL;[GET_Volume_Status]'
export function parseStatus(frames=[]) {
  const fields={}
  for(const frame of frames) {
    if(!frame.startsWith('[REMOTE_CONTROL]')) continue
    for(const match of frame.matchAll(/\[(GET_[A-Za-z0-9_]+|RC_GET_[A-Za-z0-9_]+)\]([\s\S]*?)(?=,?\[(?:GET_|RC_GET_)|$)/g)) fields[match[1]]=match[2]
  }
  const volume={}
  for(const part of (fields.GET_Volume_Status || '').split('|')) {
    const match=/^(Min|Max|Current):(\d+)$/i.exec(part)
    if(match) volume[match[1].toLowerCase()]=Number(match[2])
  }
  const validVolume=['min','max','current'].every(k=>Number.isSafeInteger(volume[k])) && volume.min<=volume.current && volume.current<=volume.max
  return {fields,name:fields.GET_Device_Name,orientation:fields.GET_ScreenOrientation,zoom:/^\d+$/.test(fields.GET_ScreenZoomPercent || '')?Number(fields.GET_ScreenZoomPercent):undefined,volume:validVolume?volume:null}
}
export function parsePlaylists(frames=[]) {
  return frames.filter(f=>f.startsWith('[GET_PLAYLISTS]')).flatMap(f=>f.slice(15).split(',')).flatMap(entry=> {
    const match=/^(.+):([\d.]+\s*(?:B|KB|MB|GB))$/.exec(entry)
    return match?[{name:match[1],size:match[2]}]:[]
  })
}
// Deletion needs a complete listing, not the best-effort display parser above.
export function playlistReadback(frames=[]) {
  const listings=frames.filter(f=>f.startsWith('[GET_PLAYLISTS]'))
  if(listings.length!==1) return null
  const body=listings[0].slice(15)
  if(body==='') return []
  const playlists=[]
  for(const entry of body.split(',')) {
    const match=/^([^:]+):(\d+(?:\.\d+)?\s*(?:B|BYTES|KB|MB|GB))$/i.exec(entry)
    if(!match || playlists.some(p=>p.name===match[1])) return null
    playlists.push({name:match[1],size:match[2]})
  }
  return playlists
}
export async function deletePlaylist(device,value,confirmed,{queryDevice,exchangeDevice}) {
  if(confirmed!==true) throw new Error('Confirm playlist deletion first')
  const before=await queryDevice(device,'playlists')
  const playlists=playlistReadback(before.frames)
  if(!before.reachable || !playlists) throw new Error('Unable to read a fresh device playlist list. Nothing was deleted.')
  const command=controlCommand('delete',value,{playlists,confirmed})
  const result=await exchangeDevice(device,command)
  const after=await queryDevice(device,'playlists')
  const readback=after.reachable?playlistReadback(after.frames):null
  const absent=readback!==null && !readback.some(p=>p.name===value)
  return {state:absent?'verified':result.reachable?'unverified':'unreachable',
    message:absent?'The device no longer lists this playlist.':readback!==null?'The device still lists this playlist. Deletion is not confirmed. If it is playing, stop playback first.':'Deletion was attempted, but the device playlist list could not be read back. Refresh before retrying.',
    playlists:readback,frames:result.frames,detail:result.detail}
}
export function controlCommand(action,value,context={}) {
  if(action==='stop' && value===undefined) return 'STOP;NULL'
  if(action==='reboot' && value===true) return 'REMOTE_CONTROL;[RC_SET_RebootDevice]NULL'
  if(action==='play' && typeof value==='string' && value.length<=255 && !/[;\r\n\0]/.test(value) && context.playlists?.some(p=>p.name===value)) return `TCP_PLAY;${value}`
  // Native DeviceTCP::remoteDelete (0x100097460) appends the selected table name.
  if(action==='delete' && context.confirmed===true && typeof value==='string' && value.length>0 && value.length<=255 && value===value.trim() && !/[\x00-\x1f\x7f;:,|/\\]/.test(value) && value!=='.' && !value.includes('..') && !value.includes('@_overlaymessage') && context.playlists?.some(p=>p.name===value)) return `DELETE;${value}`
  if(action==='volume' && Number.isSafeInteger(value) && context.volume && value>=context.volume.min && value<=context.volume.max) return `REMOTE_CONTROL;[SET_Volume_Current]${value}`
  if(action==='orientation' && orientations.includes(value)) return `REMOTE_CONTROL;[SET_ScreenOrientation]${value}`
  // ponytail: expose conservative 80-100% zoom only until other hardware ranges are verified.
  if(action==='zoom' && Number.isInteger(value) && value>=80 && value<=100) return `REMOTE_CONTROL;[SET_ScreenZoomPercent]${value}`
  if(action==='name' && typeof value==='string' && value===value.trim() && value.length>0 && value.length<=20 && !/[\x00-\x1f\x7f;\[\],|]/.test(value)) return `REMOTE_CONTROL;[SET_Device_Name]${value}`
  throw new Error('Unsupported control or invalid value (playlists and volume require fresh device data)')
}
export function controlOutcome(action,value,result,status) {
  const actual=action==='volume'?status?.volume?.current:status?.[action]
  if(['volume','name','orientation','zoom'].includes(action) && actual===value) return {state:'verified',message:'Device readback matches the requested value.'}
  // A TCP connection or arbitrary response is not evidence that a mutation succeeded.
  return {state:result.reachable?'unverified':'unreachable',message:result.reachable?'Command attempted. Device execution is not confirmed.':'Device could not be reached. Command was not confirmed.'}
}
