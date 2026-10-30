import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import net from 'node:net'
import dgram from 'node:dgram'
import os from 'node:os'
import path from 'node:path'

const dir=await mkdtemp(path.join(os.tmpdir(),'novods-deploy-'))
process.env.NOVODS_DATA_DIR=dir
// Import the route before editing the registry, reproducing stale in-memory targets.
const {POST}=await import('../app/api/deploy/route.js')
const registryFile=path.join(dir,'devices.json'),studioFile=path.join(dir,'studio.json')
const devices=[{id:'new-device',name:'Lobby',ip:'10.0.0.9'},{id:'other-device',name:'Cafe',ip:'10.0.0.10'}]
const state={revision:1,media:[],playlists:[{id:'pl-1',name:'Loop'}],schedules:[{id:'sc-1',name:'Morning'}]}
await writeFile(registryFile,JSON.stringify(devices))
await writeFile(studioFile,JSON.stringify(state))
const request=(body,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/deploy',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})
const valid={deviceIds:['new-device','other-device'],kind:'schedule',id:'sc-1'}
test.after(()=>rm(dir,{recursive:true,force:true}))

test('deployment validates persisted targets and never opens a device connection',async t=> {
  for(const [object,method] of [[net,'connect'],[net,'createConnection'],[dgram,'createSocket']]) t.mock.method(object,method,()=>assert.fail('Deployment gate must not contact devices'))
  const before=await readFile(studioFile,'utf8')
  for(const kind of ['playlist','schedule']) {
    const response=await POST(request({...valid,kind,id:kind==='playlist'?'pl-1':'sc-1',deviceIds:['new-device','other-device','new-device']}))
    assert.equal(response.status,501)
    const body=await response.json()
    assert.equal(body.code,'PROTOCOL_UNVERIFIED')
    assert.match(body.error,/Nothing was sent/)
    assert.match(body.details,/native/i)
    assert.deepEqual(body.results,[
      {deviceId:'new-device',status:'blocked',code:'PROTOCOL_UNVERIFIED'},
      {deviceId:'other-device',status:'blocked',code:'PROTOCOL_UNVERIFIED'},
    ])
    assert.equal(body.success,undefined)
  }
  assert.equal(await readFile(studioFile,'utf8'),before)
  assert.deepEqual(JSON.parse(await readFile(registryFile,'utf8')),devices)
  await writeFile(registryFile,JSON.stringify([devices[1]]))
  assert.equal((await POST(request(valid))).status,400,'Removed persisted targets must be rejected')
  await writeFile(registryFile,JSON.stringify(devices))
})

test('rejects malformed requests and rejects the entire batch for unknown targets',async()=> {
  const invalid=[null,[],{}, {...valid,extra:true},{...valid,deviceIds:[]},{...valid,deviceIds:'new-device'},
    ...[null,1,{},'', ' new-device','new-device\n','x'.repeat(81),'device-1','unknown'].map(id=>({...valid,deviceIds:['new-device',id]})),
    ...[null,1,{},'', 'pl-1\n'].map(id=>({...valid,id})),
    {...valid,kind:'media'},{...valid,id:'missing'}]
  for(const body of invalid) assert.equal((await POST(request(body))).status,400,JSON.stringify(body))
  const badJSON=new Request('http://localhost:3000/api/deploy',{method:'POST',headers:{'content-type':'application/json'},body:'{'})
  assert.equal((await POST(badJSON)).status,400)
  const crossOrigin=await POST(request(valid,'https://evil.example'))
  assert.equal(crossOrigin.status,400)
  assert.match((await crossOrigin.json()).error,/Cross-origin/)
})
