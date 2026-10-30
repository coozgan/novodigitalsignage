import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const dir = await mkdtemp(path.join(os.tmpdir(),'novods-test-'))
process.env.NOVODS_DATA_DIR = dir
const {encodeFrame,decodeFrame,inspectDevices,parseSnapshot,parsePush} = await import('../lib/protocol.mjs')

test('parseSnapshot frames native JPEG reply',()=>{
  const jpeg=Buffer.from('ffd8ffe0aabb','hex'), msg=Buffer.concat([Buffer.from([0,0,0,8+jpeg.length,0x52,0,1,0]),jpeg])
  assert.equal(parseSnapshot(msg.subarray(0,10)),undefined)
  assert.deepEqual(parseSnapshot(msg),jpeg)
  assert.throws(()=>parseSnapshot(Buffer.from([0,0,0,9,0x41,0,0,0,0])),/Unexpected/)
  assert.throws(()=>parseSnapshot(Buffer.from([0xff,0,0,0,0x52,0,0,0])),/length/)
})
test('parsePush frames device-pushed JPEG',()=>{
  const jpeg=Buffer.from('ffd8ffe0aabbffd9','hex'), msg=Buffer.concat([Buffer.from([1,0x75,0,0,0,jpeg.length]),jpeg])
  assert.equal(parsePush(msg.subarray(0,9)),undefined)
  assert.deepEqual(parsePush(msg),jpeg)
  assert.throws(()=>parsePush(Buffer.from([1,0x75,0,0,0,3,0,0,0])),/JPEG/)
})
const studio = await import('../app/api/studio/route.js')
const media = await import('../app/api/media/route.js')
const mediaFile = await import('../app/api/media/[file]/route.js')
const deploy = await import('../app/api/deploy/route.js')

test.after(()=>rm(dir,{recursive:true,force:true}))

test('round-trips DeviceTCP frames and rejects malformed frames', () => {
  assert.equal(encodeFrame('REMOTE_CONTROL;[GET_All]'),'4D4143A3YbNjUSZjkuFgZnBgtPKyUCLDMbLy5t\r\n')
  assert.equal(decodeFrame('4D4143A3YbNjUSZjkuFgZnBgtPKyUCLDMcJiNEFDUwOBVbNUQM\r\n'),'REMOTE_CONTROL;[GET_Feature_List]')
  assert.throws(()=>decodeFrame('bad-frame'))
  for(const length of [1,57,114,300]) {
    const text='[REMOTE_CONTROL]'+ 'x'.repeat(length)
    const body=encodeFrame(text).slice(6,-2)
    assert.equal(decodeFrame(body.match(/.{1,76}/g).join('\n')+'\n'),text)
  }
  assert.throws(()=>decodeFrame('YWJ'))
})

test('uploads media, persists playlists and schedules, and blocks unverified deploy', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452','hex')
  const form = new FormData()
  form.set('file',new File([png],'poster.png',{type:'image/png'}))
  const up = await media.POST(new Request('http://127.0.0.1:3000/api/media',{method:'POST',headers:{origin:'http://localhost:3000'},body:form}))
  assert.equal(up.status,200)
  const {media:uploaded,revision} = await up.json()
  const served = await mediaFile.GET(new Request(`http://127.0.0.1:3000${uploaded.url}`),{params:Promise.resolve({file:uploaded.fileName})})
  assert.equal(served.status,200)

  const doc = {
    revision,
    media:[uploaded],
    playlists:[{id:'pl-1',name:'Lobby Loop',width:1920,height:1080,items:[{mediaId:uploaded.id,duration:15}]}],
    schedules:[{id:'sc-1',name:'Morning',playlistId:'pl-1',start:'08:00',end:'12:00',days:[1,2,3,4,5]}],
  }
  const save = await studio.PUT(new Request('http://127.0.0.1:3000/api/studio',{method:'PUT',headers:{origin:'http://127.0.0.1:3000','content-type':'application/json'},body:JSON.stringify(doc)}))
  assert.equal(save.status,200)
  const loaded = await (await studio.GET()).json()
  assert.equal(loaded.playlists[0].name,'Lobby Loop')
  assert.equal(loaded.schedules[0].playlistId,'pl-1')

  const dep = await deploy.POST(new Request('http://127.0.0.1:3000/api/deploy',{method:'POST',headers:{origin:'http://127.0.0.1:3000','content-type':'application/json'},body:JSON.stringify({deviceIds:['device-1'],kind:'schedule',id:'sc-1'})}))
  assert.equal(dep.status,501)
  const devices = await inspectDevices()
  assert.equal(devices.length,2)
  assert.equal(devices.every(d=>typeof d.protocolVerified==='boolean'),true)
})

test('serves rendered Studio UI and live API over Next.js production server', async () => {
  const port = 3456
  const base = `http://127.0.0.1:${port}`
  const server = spawn('npx',['next','start','-p',String(port),'--hostname','127.0.0.1'],{env:{...process.env,NOVODS_DATA_DIR:dir},stdio:'ignore'})
  try {
    let html = ''
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(base)
        if (res.ok) { html = await res.text(); break }
      } catch {}
      await new Promise(r=>setTimeout(r,200))
    }
    assert.match(html,/NovoDS/)
    assert.match(html,/Your display network/)
    const headers={origin:base,'content-type':'application/json'}
    const state=await (await fetch(`${base}/api/studio`)).json()
    const saved=await fetch(`${base}/api/studio`,{method:'PUT',headers,body:JSON.stringify(state)})
    assert.equal(saved.status,200)
    const reloaded=await (await fetch(`${base}/api/studio`)).json()
    assert.deepEqual(reloaded.playlists,state.playlists)
    assert.deepEqual(reloaded.schedules,state.schedules)
    const blocked=await fetch(`${base}/api/deploy`,{method:'POST',headers,body:JSON.stringify({deviceIds:['device-1'],kind:'schedule',id:'sc-1'})})
    assert.equal(blocked.status,501)
    const crossOrigin=await fetch(`${base}/api/studio`,{method:'PUT',headers:{...headers,origin:'https://untrusted.example'},body:JSON.stringify(reloaded)})
    assert.equal(crossOrigin.status,400)
    assert.match(JSON.stringify(await crossOrigin.json()),/Cross-origin changes are not allowed/)
    assert.deepEqual(await (await fetch(`${base}/api/studio`)).json(),reloaded)
    const devRes = await (await fetch(`${base}/api/devices`)).json()
    assert.equal(devRes.devices.length,2)
    assert.equal(devRes.devices.some(d=>d.ip==='192.168.80.128' && d.reachable),true)
    assert.equal(devRes.devices.some(d=>d.ip==='192.168.80.100' && d.reachable),true)
    const addedResponse=await fetch(`${base}/api/devices`,{method:'POST',headers,body:JSON.stringify({action:'add',name:'Acceptance player',ip:'192.168.254.254'})})
    assert.equal(addedResponse.status,201)
    const registry=JSON.parse(await readFile(path.join(dir,'devices.json'),'utf8'))
    assert.equal(registry.length,3)
    assert.equal(registry.find(d=>d.ip==='192.168.254.254').name,'Acceptance player')
    const duplicate=await fetch(`${base}/api/devices`,{method:'POST',headers,body:JSON.stringify({action:'add',name:'Duplicate',ip:'192.168.254.254'})})
    assert.equal(duplicate.status,400)
    assert.deepEqual(JSON.parse(await readFile(path.join(dir,'devices.json'),'utf8')),registry)
    const added=registry.find(d=>d.ip==='192.168.254.254')
    const unconfirmed=await fetch(`${base}/api/devices`,{method:'POST',headers,body:JSON.stringify({action:'remove',deviceId:added.id})})
    assert.equal(unconfirmed.status,400)
    assert.deepEqual(JSON.parse(await readFile(path.join(dir,'devices.json'),'utf8')),registry)
    const removed=await fetch(`${base}/api/devices`,{method:'POST',headers,body:JSON.stringify({action:'remove',deviceId:added.id,confirmed:true})})
    assert.equal(removed.status,200)
    assert.deepEqual(JSON.parse(await readFile(path.join(dir,'devices.json'),'utf8')),registry.filter(d=>d.id!==added.id))
    assert.deepEqual(await (await fetch(`${base}/api/studio`)).json(),reloaded)
  } finally {
    server.kill('SIGTERM')
  }
})
