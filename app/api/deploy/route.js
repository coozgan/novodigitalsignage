import path from 'node:path'
import {readFile} from 'node:fs/promises'
import {loadDevices} from '../../../lib/devices.mjs'
import {loadStudio,dataRoot} from '../../../lib/store.mjs'
import {mutationGuard,errorResponse} from '../../../lib/http.mjs'
import {openUploadControl,deployPlaylistSession,uploadKey,uploadIV} from '../../../lib/deploy.mjs'
import {nativePlaylistFiles} from '../../../lib/native-xml.mjs'
import {queryDevice} from '../../../lib/protocol.mjs'
import {playlistReadback,parseStatus} from '../../../lib/control.mjs'
export const runtime='nodejs'
const validId=value=>typeof value==='string' && value.length>0 && value.length<=80 && !/[^a-zA-Z0-9-]/.test(value)
const nativeName=value=>typeof value==='string' && value===value.trim() && value.length>0 && value.length<=200 && !/[\x00-\x1f\x7f;:,|/\\]/.test(value)

export async function publishPlaylist(device,playlist,studio) {
  if(!nativeName(playlist.name)) throw new Error(`Playlist "${playlist.name}" has characters the player cannot store. Rename it before publishing.`)
  const media=playlist.items.map(item=>studioMedia(item.mediaId))
  function studioMedia(id) {
    const entry=studio.media.find(m=>m.id===id)
    if(!entry) throw new Error('Playlist references media that is no longer in the library')
    return entry
  }
  const mediaBytes={}
  for(const entry of media) mediaBytes[entry.fileName]=await readFile(path.resolve(dataRoot,'media',entry.fileName))
  const files=nativePlaylistFiles({
    name:playlist.name,width:playlist.width,height:playlist.height,
    items:playlist.items.map((item,index)=>({fileName:media[index].fileName,size:media[index].size,mediaType:media[index].type,duration:item.duration})),
    mediaBytes,
  })
  const seconds=nowSeconds()
  // Native key derivation uses the physical device name (GET_Device_Name) and BSP version
  // (GET_Version), not the workspace label. Fetch both live so keys match the device.
  const status=await queryDevice(device,'status')
  const parsed=status.reachable?parseStatus(status.frames):null
  const physicalName=parsed?.name,bsp=bspFromFrames(status.frames)
  if(!physicalName || !bsp) throw new Error('Could not read the device name and firmware version needed for a native upload.')
  const control=await openUploadControl({host:device.ip,timeout:10000})
  try {
    const result=await deployPlaylistSession({
      control,host:device.ip,playlistName:playlist.name,files,
      deriveKey:async(fileName)=>uploadKey(fileName,physicalName,bsp),
      deriveIV:async()=>uploadIV(seconds),
      now:new Date(),timeout:30000,
    })
    // Fail-closed readback: the playlist must appear in the device listing.
    const listing=await queryDevice(device,'playlists')
    const playlists=listing.reachable?playlistReadback(listing.frames):null
    // The player lists stored playlists with an "[Internal] " storage prefix.
    const present=playlists?.some(p=>p.name===playlist.name || p.name===`[Internal] ${playlist.name}`)
    if(!present) throw new Error('Upload finished, but the player does not list the playlist. Treat the publish as unverified.')
    return {deviceId:device.id,status:present?'published':'unverified',playlistName:playlist.name,info:result.info}
  } finally {control.close()}
}

const bspFromFrames=frames=> {
  for(const frame of frames || []) {
    const match=/\[GET_Version\]v[\d.]+:[^:]*:([^:,]+)/.exec(frame)
    if(match) return match[1]
  }
  return null
}
const nowSeconds=()=>{const d=new Date();return d.getHours()*3600+d.getMinutes()*60+d.getSeconds()}

export async function POST(request) {
  try {
    mutationGuard(request)
    const body=await request.json()
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(key=>!['deviceIds','kind','id','play'].includes(key))) throw new Error('Invalid deployment request')
    const {deviceIds,kind,id,play}=body
    if(!Array.isArray(deviceIds) || !deviceIds.length || !deviceIds.every(validId)) throw new Error('Select valid devices')
    const targets=[...new Set(deviceIds)]
    const devices=await loadDevices()
    if(!targets.every(id=>devices.some(device=>device.id===id))) throw new Error('Some selected devices are no longer available. Refresh the device list and try again.')
    if(kind!=='playlist') throw new Error(`Publishing ${kind || 'this content'} is not available yet. Nothing was sent.`)
    if(!validId(id)) throw new Error('Select a saved playlist')
    const state=await loadStudio()
    const playlist=state.playlists.find(item=>item.id===id)
    if(!playlist) throw new Error('Saved playlist not found')
    const results=[]
    for(const deviceId of targets) {
      const device=devices.find(d=>d.id===deviceId)
      try {
        const outcome=await publishPlaylist(device,playlist,state)
        if(play===true) results.push({...outcome,playStatus:'not-played'})
        else results.push(outcome)
      } catch(error) {
        results.push({deviceId,status:'failed',error:error.message})
      }
    }
    const anyFailed=results.some(r=>r.status==='failed')
    return Response.json({results,summary:anyFailed?'Some devices failed. Check each result.':'Playlist published to all selected devices.'},{status:anyFailed?207:200})
  } catch(error) { return errorResponse(error) }
}
