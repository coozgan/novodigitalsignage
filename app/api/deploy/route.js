import path from 'node:path'
import {readFile} from 'node:fs/promises'
import {loadDevices} from '../../../lib/devices.mjs'
import {loadStudio,dataRoot} from '../../../lib/store.mjs'
import {mutationGuard,errorResponse} from '../../../lib/http.mjs'
import {openUploadControl,deployPlaylistSession,deployScheduleSession,uploadKey,uploadIV} from '../../../lib/deploy.mjs'
import {nativePlaylistFiles,nativeScheduleXml,nativeSchedulePayload,nativeScheduleMatches} from '../../../lib/native-xml.mjs'
import {queryDevice,exchangeDevice} from '../../../lib/protocol.mjs'
import {playlistReadback,parseStatus,controlCommand,playbackName} from '../../../lib/control.mjs'
export const runtime='nodejs'
const validId=value=>typeof value==='string' && value.length>0 && value.length<=80 && !/[^a-zA-Z0-9-]/.test(value)
const nativeName=value=>typeof value==='string' && value===value.trim() && value.length>0 && value.length<=200 && !/[\x00-\x1f\x7f;:,|/\\]/.test(value)

async function preparePlaylist(playlist,studio) {
  if(!nativeName(playlist.name)) throw new Error(`Playlist "${playlist.name}" has characters the player cannot store. Rename it before publishing.`)
  if(!Array.isArray(playlist.items) || !playlist.items.length) throw new Error(`Playlist "${playlist.name}" has no media items to publish.`)
  const media=playlist.items.map(item=>studioMedia(item.mediaId))
  function studioMedia(id) {
    const entry=studio.media.find(m=>m.id===id)
    if(!entry) throw new Error('Playlist references media that is no longer in the library')
    return entry
  }
  const mediaBytes={}
  for(const entry of media) mediaBytes[entry.fileName]=await readFile(path.resolve(dataRoot,'media',entry.fileName))
  return nativePlaylistFiles({
    name:playlist.name,width:playlist.width,height:playlist.height,
    items:playlist.items.map((item,index)=>({fileName:media[index].fileName,size:media[index].size,mediaType:media[index].type,duration:item.duration})),
    mediaBytes,
  })
}

async function readUploadIdentity(device) {
  const status=await queryDevice(device,'status')
  const parsed=status.reachable?parseStatus(status.frames):null
  const physicalName=parsed?.name,bsp=bspFromFrames(status.frames)
  if(!physicalName || !bsp) throw new Error('Could not read the device name and firmware version needed for a native upload.')
  return {physicalName,bsp}
}

async function verifyPlaylist(device,playlistName) {
  const listing=await queryDevice(device,'playlists')
  const playlists=listing.reachable?playlistReadback(listing.frames):null
  const entry=playlists?.find(p=>p.name===playlistName || p.name===`[Internal] ${playlistName}`)
  if(!entry) throw new Error('Upload finished, but the player does not list the playlist. Treat the publish as unverified.')
  return {playlists,storedName:entry.name}
}

export async function publishPlaylist(device,playlist,studio,{play=false}={}) {
  const files=await preparePlaylist(playlist,studio)
  const seconds=nowSeconds()
  // Native key derivation uses the physical device name (GET_Device_Name) and BSP version
  // (GET_Version), not the workspace label. Fetch both live so keys match the device.
  const {physicalName,bsp}=await readUploadIdentity(device)
  const control=await openUploadControl({host:device.ip,timeout:10000})
  try {
    const result=await deployPlaylistSession({
      control,host:device.ip,playlistName:playlist.name,files,
      deriveKey:async(fileName)=>uploadKey(fileName,physicalName,bsp),
      deriveIV:async()=>uploadIV(seconds),
      now:new Date(),timeout:30000,
    })
    const {playlists,storedName}=await verifyPlaylist(device,playlist.name)
    const outcome={deviceId:device.id,status:'published',playlistName:playlist.name,info:result.info}
    if(!play) return outcome
    const played=await exchangeDevice(device,controlCommand('play',storedName,{playlists}))
    if(!played.reachable) return {...outcome,playStatus:'unverified',playError:'Playlist published, but the play command did not reach the player.'}
    const after=await exchangeDevice(device,'REMOTE_CONTROL;[Current_Playing_Playlist_Name]',2000)
    const prefix='[REMOTE_CONTROL][Current_Playing_Playlist_Name]'
    const current=after.frames.find(f=>f.startsWith(prefix))?.slice(prefix.length)
    const active=after.reachable && typeof current==='string' && playbackName(current)===playbackName(storedName)
    return {...outcome,playStatus:active?'verified':'unverified'}
  } finally {control.close()}
}

export async function publishSchedule(device,schedule,studio) {
  if(!nativeName(schedule.name)) throw new Error(`Schedule "${schedule.name}" has characters the player cannot store. Rename it before publishing.`)
  const playlist=studio.playlists.find(item=>item.id===schedule.playlistId)
  if(!playlist) throw new Error('Schedule references a playlist that is no longer in the workspace')
  const files=await preparePlaylist(playlist,studio)
  const now=new Date(),seconds=nowSeconds(now)
  const scheduleXml=nativeScheduleXml({schedule,playlistName:playlist.name,now})
  const scheduleContent=nativeSchedulePayload({scheduleXml,playlists:[{name:playlist.name,files}]})
  const {physicalName,bsp}=await readUploadIdentity(device)
  const control=await openUploadControl({host:device.ip,timeout:10000})
  try {
    await deployScheduleSession({
      control,host:device.ip,scheduleContent,playlists:[{name:playlist.name,files}],
      deriveKey:async(fileName)=>uploadKey(fileName,physicalName,bsp),
      deriveIV:async()=>uploadIV(seconds),
      now,timeout:30000,
    })
    await verifyPlaylist(device,playlist.name)
    const readback=await exchangeDevice(device,'DOWNLOAD_SCHEDULE;NULL',5000)
    const xml=readback.frames.find(f=>f.startsWith('[DOWNLOAD_SCHEDULE]'))?.slice('[DOWNLOAD_SCHEDULE]'.length)
    if(!readback.reachable || !nativeScheduleMatches(xml,scheduleXml)) throw new Error('Schedule uploaded, but device schedule readback did not match. Treat the publish as unverified.')
    return {deviceId:device.id,status:'published',scheduleName:schedule.name,playlistName:playlist.name}
  } finally {control.close()}
}

const bspFromFrames=frames=> {
  for(const frame of frames || []) {
    const match=/\[GET_Version\]v[\d.]+:[^:]*:([^:,]+)/.exec(frame)
    if(match) return match[1]
  }
  return null
}
const nowSeconds=(d=new Date())=>d.getHours()*3600+d.getMinutes()*60+d.getSeconds()

export async function POST(request) {
  try {
    mutationGuard(request)
    const body=await request.json()
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(key=>!['deviceIds','kind','id','play'].includes(key))) throw new Error('Invalid deployment request')
    const {deviceIds,kind,id,play}=body
    if(!Array.isArray(deviceIds) || !deviceIds.length || !deviceIds.every(validId)) throw new Error('Select valid devices')
    if(play!==undefined && typeof play!=='boolean') throw new Error('Invalid play option')
    const targets=[...new Set(deviceIds)]
    const devices=await loadDevices()
    if(!targets.every(id=>devices.some(device=>device.id===id))) throw new Error('Some selected devices are no longer available. Refresh the device list and try again.')
    if(kind!=='playlist' && kind!=='schedule') throw new Error('Select a playlist or schedule to publish')
    if(kind==='schedule' && play===true) throw new Error('Immediate play applies to playlists only')
    if(!validId(id)) throw new Error(`Select a saved ${kind}`)
    const state=await loadStudio()
    const targetItem=(kind==='playlist'?state.playlists:state.schedules).find(item=>item.id===id)
    if(!targetItem) throw new Error(`Saved ${kind} not found`)
    const results=[]
    for(const deviceId of targets) {
      const device=devices.find(d=>d.id===deviceId)
      try {
        results.push(kind==='playlist'?await publishPlaylist(device,targetItem,state,{play:play===true}):await publishSchedule(device,targetItem,state))
      } catch(error) {
        results.push({deviceId,status:'failed',error:error.message})
      }
    }
    const anyFailed=results.some(r=>r.status==='failed')
    const label=kind==='playlist'?'Playlist':'Schedule'
    return Response.json({results,summary:anyFailed?'Some devices failed. Check each result.':`${label} published to all selected devices.`},{status:anyFailed?207:200})
  } catch(error) { return errorResponse(error) }
}
