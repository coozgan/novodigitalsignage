import {exchangeDevice} from '../../../../lib/protocol.mjs'
import {findDevice} from '../../../../lib/devices.mjs'
import {mutationGuard,errorResponse} from '../../../../lib/http.mjs'
import {readDeviceSchedule,deleteDeviceSchedule} from '../../../../lib/device-schedule.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request) {
  try {
    const url=new URL(request.url)
    const device=await findDevice(url.searchParams.get('deviceId'))
    const result=await readDeviceSchedule(device,exchangeDevice)
    if(url.searchParams.get('format')==='xml') return new Response(result.xml,{headers:{'content-type':'application/xml; charset=utf-8','content-disposition':'attachment; filename="device-schedule.xml"','cache-control':'no-store','x-content-type-options':'nosniff'}})
    return Response.json(result,{headers:{'cache-control':'no-store'}})
  } catch(error) {return errorResponse(error,error.message==='Unknown device'?404:502)}
}
export async function DELETE(request) {
  try {
    mutationGuard(request)
    const body=await request.json()
    if(!body || Array.isArray(body) || Object.keys(body).some(k=>!['deviceId','confirmed','revision','entryIndex'].includes(k))) throw new Error('Invalid schedule deletion request')
    if(Object.hasOwn(body,'entryIndex') && (!Number.isSafeInteger(body.entryIndex) || body.entryIndex<0)) throw new Error('Invalid schedule entry selection')
    if(body.confirmed!==true) throw new Error('Confirm device schedule deletion first')
    const device=await findDevice(body.deviceId)
    const result=await deleteDeviceSchedule(device,body,exchangeDevice)
    return Response.json(result,{status:result.verified?200:207,headers:{'cache-control':'no-store'}})
  } catch(error) {return errorResponse(error,error.message==='Unknown device'?404:400)}
}
