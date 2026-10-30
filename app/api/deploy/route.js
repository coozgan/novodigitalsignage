import {loadDevices} from '../../../lib/devices.mjs'
import {loadStudio} from '../../../lib/store.mjs'
import {mutationGuard,errorResponse} from '../../../lib/http.mjs'
export const runtime='nodejs'
const validId=value=>typeof value==='string' && value.length>0 && value.length<=80 && !/[^a-zA-Z0-9-]/.test(value)
export async function POST(request) {
  try {
    mutationGuard(request)
    const body=await request.json()
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(key=>!['deviceIds','kind','id'].includes(key))) throw new Error('Invalid deployment request')
    const {deviceIds,kind,id}=body
    if(!Array.isArray(deviceIds) || !deviceIds.length || !deviceIds.every(validId)) throw new Error('Select valid devices')
    const targets=[...new Set(deviceIds)]
    const devices=await loadDevices()
    if(!targets.every(id=>devices.some(device=>device.id===id))) throw new Error('Some selected devices are no longer available. Refresh the device list and try again.')
    if(!['playlist','schedule'].includes(kind)) throw new Error('Invalid deployment kind')
    if(!validId(id)) throw new Error('Select a saved playlist or schedule')
    const state=await loadStudio()
    if(!state[kind==='playlist'?'playlists':'schedules'].some(item=>item.id===id)) throw new Error('Saved item not found')
    // Keep the gate closed until native fixtures verify serialization and packaging.
    return Response.json({
      error:'Publishing is not available yet. Nothing was sent and current playback was not changed.',
      code:'PROTOCOL_UNVERIFIED',
      details:'The native playlist/schedule XML and media package mapping are not verified. Transport has static-derived and loopback tests only, not native ciphertext or device acceptance verification.',
      results:targets.map(deviceId=>({deviceId,status:'blocked',code:'PROTOCOL_UNVERIFIED'})),
    },{status:501})
  } catch(error) { return errorResponse(error) }
}
