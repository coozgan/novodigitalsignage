import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,mkdir,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const dir=await mkdtemp(path.join(os.tmpdir(),'novods-deploy-'))
process.env.NOVODS_DATA_DIR=dir
const registryFile=path.join(dir,'devices.json'),studioFile=path.join(dir,'studio.json')
const mediaFile='poster.png',mediaBytes=Buffer.from('89504e470d0a1a0a0000000d49484452','hex')
await mkdir(path.join(dir,'media'))
await writeFile(path.join(dir,'media',mediaFile),mediaBytes)
const devices=[{id:'new-device',name:'Lobby',ip:'10.0.0.9'},{id:'other-device',name:'Cafe',ip:'10.0.0.10'}]
const state={revision:1,media:[{id:'m-1',type:'image',size:mediaBytes.length,fileName:mediaFile}],
  playlists:[{id:'pl-1',name:'Loop',width:1920,height:1080,items:[{mediaId:'m-1',duration:15}]},{id:'pl-2',name:'bad:name',items:[{mediaId:'m-1',duration:15}]}],
  schedules:[{id:'sc-1',name:'Morning',playlistId:'pl-1'}]}
await writeFile(registryFile,JSON.stringify(devices))
await writeFile(studioFile,JSON.stringify(state))

// Mock device I/O at module level so the route runs its full logic with no network.
// Requires --experimental-test-module-mocks (set in npm test script).
const calls=[]
const fakeStatus={reachable:true,protocolVerified:true,
  frames:['[REMOTE_CONTROL][GET_Device_Name]Lobby,[GET_Version]v4.5.3.1845:ND-G1000:ND-G1000-0132:NDG1000-EU-CORP']}
const fakePlaylists=uploaded=>({reachable:true,protocolVerified:true,
  frames:[`[GET_PLAYLISTS]${uploaded ? '[Internal] Loop:1.2 MB' : 'Baseline:1.0 MB'}`]})
let uploadedNames=new Set(),nextUploadFails=false
test.mock.module('../lib/protocol.mjs',{
  namedExports:{...await import('../lib/protocol.mjs'),
    queryDevice:async(device,action)=>{
      calls.push(['query',device.id,action])
      if(action==='status') return fakeStatus
      return fakePlaylists(uploadedNames.size>0)
    }},
})
test.mock.module('../lib/deploy.mjs',{
  namedExports:{...await import('../lib/deploy.mjs'),
    openUploadControl:async({host})=>({host,send:()=>{},close:()=>{}}),
    deployPlaylistSession:async({playlistName,files})=>{
      calls.push(['upload',playlistName,files.map(f=>f.fileName)])
      if(nextUploadFails) {nextUploadFails=false;throw new Error('Device rejected playlist upload: [TCP_UPLOAD_DONE]fail')}
      uploadedNames.add(playlistName)
      return {playlistName,info:'[PLAYLIST_INFO]',transferred:[],done:'[TCP_UPLOAD_DONE]ok'}
    }},
})
const {POST}=await import('../app/api/deploy/route.js')
const request=(body,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/deploy',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})
const publish={deviceIds:['new-device','other-device'],kind:'playlist',id:'pl-1'}
test.after(()=>rm(dir,{recursive:true,force:true}))

test('publishes a playlist with native identity and fail-closed readback',async()=> {
  const response=await POST(request({...publish,deviceIds:['new-device','other-device','new-device']}))
  assert.equal(response.status,200)
  const body=await response.json()
  assert.match(body.summary,/published to all/)
  assert.deepEqual(body.results.map(r=>({deviceId:r.deviceId,status:r.status})),[
    {deviceId:'new-device',status:'published'},{deviceId:'other-device',status:'published'},
  ])
  // One status query (identity), upload, and playlists readback per device.
  assert.deepEqual(calls,[['query','new-device','status'],['upload','Loop',['index.xml',mediaFile]],['query','new-device','playlists'],['query','other-device','status'],['upload','Loop',['index.xml',mediaFile]],['query','other-device','playlists']])
  // The serialized XML uses the physical name/BSP-derived key path (upload was reached).
  assert.equal(body.results[0].playlistName,'Loop')
})

test('reports per-device failures without altering other results',async()=> {
  calls.length=0
  nextUploadFails=true
  const response=await POST(request(publish))
  assert.equal(response.status,207)
  const body=await response.json()
  assert.equal(body.results[0].status,'failed')
  assert.match(body.results[0].error,/rejected/)
  assert.equal(body.results[1].status,'published')
  assert.equal(calls.length,5,'Failed device skips readback')
})

test('missing media, unsafe names, and unknown playlists fail before any device contact',async()=> {
  calls.length=0
  const name=await POST(request({...publish,id:'pl-2'}))
  assert.equal(name.status,207)
  assert.match((await name.json()).results[0].error,/characters the player cannot store/)
  // simulate broken media reference
  state.playlists[0].items[0].mediaId='gone'
  await writeFile(studioFile,JSON.stringify(state))
  const gone=await POST(request({...publish,deviceIds:['new-device']}))
  assert.equal(gone.status,207)
  assert.match((await gone.json()).results[0].error,/no longer in the library/)
  state.playlists[0].items[0].mediaId='m-1'
  await writeFile(studioFile,JSON.stringify(state))
  assert.equal(calls.length,0,'Validation failures must not contact devices')
})

test('schedule publishing remains gated and nothing is sent',async()=> {
  calls.length=0
  const response=await POST(request({deviceIds:['new-device'],kind:'schedule',id:'sc-1'}))
  assert.equal(response.status,400)
  assert.match((await response.json()).error,/not available yet.*Nothing was sent/)
  assert.equal(calls.length,0)
  assert.equal(await readFile(studioFile,'utf8'),JSON.stringify(state))
  assert.deepEqual(JSON.parse(await readFile(registryFile,'utf8')),devices)
})

test('rejects malformed requests and stale persisted targets',async()=> {
  const invalid=[null,[],{}, {...publish,extra:true},{...publish,deviceIds:[]},{...publish,deviceIds:'new-device'},
    ...[null,1,{},'', ' new-device','new-device\n','x'.repeat(81),'device-1','unknown'].map(id=>({...publish,deviceIds:['new-device',id]})),
    ...[null,1,{},'', 'pl-1\n'].map(id=>({...publish,id})),
    {...publish,kind:'media'},{...publish,id:'missing'}]
  for(const body of invalid) assert.equal((await POST(request(body))).status,400,JSON.stringify(body))
  const badJSON=new Request('http://localhost:3000/api/deploy',{method:'POST',headers:{'content-type':'application/json'},body:'{'})
  assert.equal((await POST(badJSON)).status,400)
  const crossOrigin=await POST(request(publish,'https://evil.example'))
  assert.equal(crossOrigin.status,400)
  assert.match((await crossOrigin.json()).error,/Cross-origin/)
  await writeFile(registryFile,JSON.stringify([devices[1]]))
  assert.equal((await POST(request(publish))).status,400,'Removed persisted targets must be rejected')
  await writeFile(registryFile,JSON.stringify(devices))
})
