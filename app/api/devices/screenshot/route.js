import {devices,snapshot} from '../../../../lib/protocol.mjs'
import {errorResponse} from '../../../../lib/http.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request) {
  const device=devices.find(d=>d.id===new URL(request.url).searchParams.get('deviceId'))
  if(!device) return errorResponse(new Error('Unknown device'),404)
  try {
    return new Response(await snapshot(device),{headers:{'content-type':'image/jpeg','cache-control':'no-store'}})
  } catch(error) { return errorResponse(error,502) }
}
