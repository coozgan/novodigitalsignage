import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const dir = await mkdtemp(path.join(os.tmpdir(),'novods-test-'))
process.env.NOVODS_DATA_DIR = dir
const {encodeFrame,decodeFrame,inspectDevices} = await import('../lib/protocol.mjs')
const studio = await import('../app/api/studio/route.js')
const media = await import('../app/api/media/route.js')
const mediaFile = await import('../app/api/media/[file]/route.js')
const deploy = await import('../app/api/deploy/route.js')

test.after(()=>rm(dir,{recursive:true,force:true}))

test('round-trips DeviceTCP frames and rejects malformed frames', () => {
  assert.equal(encodeFrame('REMOTE_CONTROL;[GET_All]'),'4D4143A3YbNjUSZjkuFgZnBgtPKyUCLDMbLy5t\r\n')
  assert.equal(decodeFrame('4D4143A3YbNjUSZjkuFgZnBgtPKyUCLDMcJiNEFDUwOBVbNUQM\r\n'),'REMOTE_CONTROL;[GET_Feature_List]')
  assert.throws(()=>decodeFrame('bad-frame'))
})

test('uploads media, persists playlists and schedules, and blocks unverified deploy', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452','hex')
  const form = new FormData()
  form.set('file',new File([png],'poster.png',{type:'image/png'}))
  const up = await media.POST(new Request('http://127.0.0.1:3000/api/media',{method:'POST',headers:{origin:'http://127.0.0.1:3000'},body:form}))
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
  assert.equal(devices.every(d=>d.protocolVerified===false),true)
})
