import {snapshot} from '../../../../lib/protocol.mjs'
import {findDevice} from '../../../../lib/devices.mjs'
import {errorResponse} from '../../../../lib/http.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request) {
  let device
  try { device=await findDevice(new URL(request.url).searchParams.get('deviceId')) }
  catch(error) { return errorResponse(error,error.message==='Unknown device'?404:500) }
  try {
    return new Response(await snapshot(device),{headers:{'content-type':'image/jpeg','cache-control':'no-store'}})
  } catch(error) { return errorResponse(error,502) }
}
