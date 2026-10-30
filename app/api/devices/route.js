import {inspectDevices,queryDevice} from '../../../lib/protocol.mjs'
import {addDevice,findDevice} from '../../../lib/devices.mjs'
import {mutationGuard,errorResponse} from '../../../lib/http.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET() {
  try { return Response.json({devices:await inspectDevices()}) }
  catch(error) { return errorResponse(error,500) }
}
export async function POST(request) {
  try {
    mutationGuard(request)
    const body=await request.json()
    if(!body || typeof body!=='object' || Array.isArray(body)) throw new Error('Invalid device request')
    const {deviceId,action,name,ip}=body
    if(action==='add') {
      if(Object.keys(body).some(k=>!['action','name','ip'].includes(k))) throw new Error('Invalid add-device request')
      return Response.json({device:await addDevice({name,ip})},{status:201})
    }
    if(!['status','playlists'].includes(action)) throw new Error('Unsupported read-only action')
    const device=await findDevice(deviceId)
    return Response.json(await queryDevice(device,action))
  } catch(error) { return errorResponse(error) }
}
