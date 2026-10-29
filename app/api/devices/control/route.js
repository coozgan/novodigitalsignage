import {devices,queryDevice,exchangeDevice} from '../../../../lib/protocol.mjs'
import {mutationGuard,errorResponse} from '../../../../lib/http.mjs'
import {parseStatus,parsePlaylists,controlCommand,controlOutcome,volumeQuery} from '../../../../lib/control.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
function findDevice(id) {
  const device=devices.find(d=>d.id===id)
  if(!device) throw new Error('Unknown device')
  return device
}
async function readStatus(device) {
  const status=await queryDevice(device,'status')
  const volume=await exchangeDevice(device,volumeQuery)
  return {status:parseStatus([...status.frames,...volume.frames]),reachable:status.reachable || volume.reachable}
}
export async function GET(request) {
  try {
    const device=findDevice(new URL(request.url).searchParams.get('deviceId'))
    const current=await readStatus(device)
    const playlists=await queryDevice(device,'playlists')
    return Response.json({...current,playlists:parsePlaylists(playlists.frames)})
  } catch(error) { return errorResponse(error) }
}
export async function POST(request) {
  try {
    mutationGuard(request)
    const body=await request.json()
    if(!body || Array.isArray(body) || Object.keys(body).some(k=>!['deviceId','action','value'].includes(k))) throw new Error('Invalid control request')
    const {deviceId,action,value}=body, device=findDevice(deviceId)
    const context={}
    if(action==='play') context.playlists=parsePlaylists((await queryDevice(device,'playlists')).frames)
    if(action==='volume') context.volume=parseStatus((await exchangeDevice(device,volumeQuery)).frames).volume
    const command=controlCommand(action,value,context)
    const result=await exchangeDevice(device,command)
    const current=action==='reboot'?null:await readStatus(device)
    return Response.json({action,...controlOutcome(action,value,result,current?.status),status:current?.status,frames:result.frames,detail:result.detail})
  } catch(error) { return errorResponse(error) }
}
