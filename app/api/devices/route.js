import {devices,inspectDevices,queryDevice} from '../../../lib/protocol.mjs'
import {mutationGuard,errorResponse} from '../../../lib/http.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET() { return Response.json({devices:await inspectDevices()}) }
export async function POST(request) {
  try {
    mutationGuard(request)
    const {deviceId,action}=await request.json()
    const device=devices.find(d=>d.id===deviceId)
    if(!device) throw new Error('Unknown device')
    if(!['status','playlists'].includes(action)) throw new Error('Unsupported read-only action')
    return Response.json(await queryDevice(device,action))
  } catch(error) { return errorResponse(error) }
}
