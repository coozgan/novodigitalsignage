import {devices} from '../../../lib/protocol.mjs'
import {loadStudio} from '../../../lib/store.mjs'
import {mutationGuard,errorResponse} from '../../../lib/http.mjs'
export const runtime='nodejs'
export async function POST(request) {
  try {
    mutationGuard(request)
    const {deviceIds,kind,id}=await request.json()
    if(!Array.isArray(deviceIds) || !deviceIds.length || !deviceIds.every(id=>devices.some(d=>d.id===id))) throw new Error('Select known devices')
    if(!['playlist','schedule'].includes(kind)) throw new Error('Invalid deployment kind')
    const state=await loadStudio()
    if(!state[kind==='playlist'?'playlists':'schedules'].some(item=>item.id===id)) throw new Error('Saved item not found')
    return Response.json({error:'Deployment blocked: the native playlist/schedule format, file transfer handshake, and device acknowledgement are not yet verified. Nothing was sent and current playback was not changed.',code:'PROTOCOL_UNVERIFIED'},{status:501})
  } catch(error) { return errorResponse(error) }
}
