import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyDeviceSchedule} from '../lib/device-schedule.mjs'
let xml=emptyDeviceSchedule,calls=[]
test.mock.module('../lib/protocol.mjs',{namedExports:{exchangeDevice:async(_device,command)=>{calls.push(command);return {reachable:true,frames:['[DOWNLOAD_SCHEDULE]'+xml]}}}})
test.mock.module('../lib/devices.mjs',{namedExports:{findDevice:async id=>{if(id!=='d') throw new Error('Unknown device');return {id,ip:'192.168.1.2'}}}})
const {GET,DELETE}=await import('../app/api/devices/schedule/route.js')
const request=(body,origin)=>new Request('http://localhost/api/devices/schedule',{method:'DELETE',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)})
test('schedule API provides fresh JSON and downloadable safe XML',async()=> {
  calls=[]
  let response=await GET(new Request('http://localhost/api/devices/schedule?deviceId=d'))
  assert.equal(response.status,200)
  assert.equal(response.headers.get('cache-control'),'no-store')
  const data=await response.json()
  assert.equal(data.schedule.alarms.length,0)
  assert.match(data.revision,/^[a-f0-9]{64}$/)
  response=await GET(new Request('http://localhost/api/devices/schedule?deviceId=d&format=xml'))
  assert.equal(await response.text(),emptyDeviceSchedule)
  assert.match(response.headers.get('content-disposition'),/attachment/)
  assert.match(response.headers.get('content-type'),/application\/xml/)
  assert.deepEqual(calls,['DOWNLOAD_SCHEDULE;NULL','DOWNLOAD_SCHEDULE;NULL'])
})
test('deletion rejects origin, confirmation, arbitrary commands and unknown device before hardware',async()=> {
  for(const [body,origin] of [[{deviceId:'d',confirmed:false}], [{deviceId:'d',confirmed:true,revision:'0'.repeat(64)},'http://evil.invalid'],[{deviceId:'d',confirmed:true,command:'STOP'}],[{deviceId:'unknown',confirmed:true}]]) {
    calls=[]
    const response=await DELETE(request(body,origin))
    assert.ok([400,404].includes(response.status))
    assert.equal(calls.length,0)
  }
})
test('API removal returns verified only after empty schedule readback',async()=> {
  xml=emptyDeviceSchedule
  const before=await (await GET(new Request('http://localhost/api/devices/schedule?deviceId=d'))).json()
  calls=[]
  const response=await DELETE(request({deviceId:'d',confirmed:true,revision:before.revision}))
  assert.equal(response.status,200)
  assert.equal((await response.json()).verified,true)
  assert.deepEqual(calls,['DOWNLOAD_SCHEDULE;NULL','TCP_SCHEDULE;'+emptyDeviceSchedule,'DOWNLOAD_SCHEDULE;NULL'])
})
test('unchanged device schedule returns 207, never a verified deletion',async()=> {
  xml='<AlarmManager Name="Still present"><Alarms><Alarm Enabled="true" Type="3"/></Alarms></AlarmManager>'
  const before=await (await GET(new Request('http://localhost/api/devices/schedule?deviceId=d'))).json()
  const response=await DELETE(request({deviceId:'d',confirmed:true,revision:before.revision}))
  assert.equal(response.status,207)
  assert.equal((await response.json()).verified,false)
})
