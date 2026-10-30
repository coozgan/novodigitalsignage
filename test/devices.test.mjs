import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {EventEmitter} from 'node:events'
import net from 'node:net'
import dgram from 'node:dgram'
import os from 'node:os'
import path from 'node:path'

const dir=await mkdtemp(path.join(os.tmpdir(),'novods-devices-'))
process.env.NOVODS_DATA_DIR=dir
const registry=await import('../lib/devices.mjs')
const api=await import('../app/api/devices/route.js')
const control=await import('../app/api/devices/control/route.js')
const screenshot=await import('../app/api/devices/screenshot/route.js')
const protocol=await import('../lib/protocol.mjs')
const file=path.join(dir,'devices.json')
const request=(body,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/devices',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)})
const stored=async()=>JSON.parse(await readFile(file,'utf8'))
test.after(()=>rm(dir,{recursive:true,force:true}))

test('persistent registry and public device endpoints without hardware traffic',async t=> {
  await t.test('seeds absent file and persists UUID additions across processes',async()=> {
    assert.deepEqual((await registry.loadDevices()).map(d=>d.id),['device-1','device-2'])
    const response=await api.POST(request({action:'add',name:' Lobby ',ip:'10.20.30.40'}))
    assert.equal(response.status,201)
    const {device}=await response.json()
    assert.match(device.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.equal(device.name,'Lobby')
    assert.deepEqual((await stored()).at(-1),device)
    const output=execFileSync(process.execPath,['--input-type=module','-e',`import {loadDevices} from './lib/devices.mjs'; console.log(JSON.stringify(await loadDevices()))`],{cwd:process.cwd(),env:{...process.env,NOVODS_DATA_DIR:dir},encoding:'utf8'})
    assert.deepEqual(JSON.parse(output),await stored())
  })
  await t.test('rejects invalid names, non-LAN targets, duplicates and cross-origin additions unchanged',async()=> {
    const before=await readFile(file,'utf8')
    for(const ip of ['192.168.80.128','10.20.30.40','http://192.168.1.2','192.168.1.2:20110','localhost','127.0.0.1','0.0.0.0','169.254.169.254','8.8.8.8','172.32.0.1','::1','fc00::1','192.168.001.2','999.2.3.4',null,123]) {
      assert.equal((await api.POST(request({action:'add',name:'Bad',ip}))).status,400,String(ip))
    }
    for(const name of ['', ' ',null,123,'x'.repeat(201),'bad\nname']) assert.equal((await api.POST(request({action:'add',name,ip:'10.0.0.9'}))).status,400)
    for(const body of [null,[],{action:'add',name:'Bad',ip:'10.0.0.9',command:'STOP;NULL'}]) assert.equal((await api.POST(request(body))).status,400)
    assert.equal((await api.POST(request({action:'add',name:'Bad',ip:'10.0.0.9'},'https://evil.example'))).status,400)
    assert.equal(await readFile(file,'utf8'),before)
  })
  await t.test('serializes concurrent writes and duplicate checks without dropping old metadata',async()=> {
    const entries=await stored()
    entries[0].custom={keep:true}
    await writeFile(file,JSON.stringify(entries))
    const results=await Promise.all(Array.from({length:12},(_,i)=>api.POST(request({action:'add',name:`Screen ${i}`,ip:`172.16.0.${i+1}`}))))
    assert.ok(results.every(r=>r.status===201))
    const duplicate=await Promise.all([1,2].map(()=>api.POST(request({action:'add',name:'Race',ip:'192.168.9.9'}))))
    assert.deepEqual(duplicate.map(r=>r.status).sort(),[201,400])
    const saved=await stored()
    assert.equal(saved.length,16)
    assert.deepEqual(saved.slice(0,entries.length),entries)
    assert.equal(new Set(saved.map(d=>d.id)).size,saved.length)
    assert.deepEqual(await readdir(dir),['devices.json'])
  })
  await t.test('all read, control and screenshot lookups use persisted entries',async()=> {
    const device=(await stored()).find(d=>d.ip==='10.20.30.40')
    const connections=[],packets=[]
    const jpeg=Buffer.from('ffd8ffe0aabbffd9','hex')
    t.mock.method(net,'connect',(port,ip,callback)=> {
      connections.push({port,ip})
      const socket=new EventEmitter()
      socket.destroy=()=>{}
      socket.write=()=> {
        if(port===20114) socket.emit('data',Buffer.concat([Buffer.from([0,0,0,8+jpeg.length,0x52,0,1,0]),jpeg]))
        else socket.emit('data',protocol.encodeFrame('[REMOTE_CONTROL][GET_Device_Name]Lobby'))
      }
      process.nextTick(()=>{callback?.();socket.emit('connect')})
      return socket
    })
    t.mock.method(dgram,'createSocket',()=> {
      const socket=new EventEmitter()
      socket.bind=(_port,callback)=>callback()
      socket.close=callback=>callback?.()
      socket.send=(bytes,port,ip,callback)=>{packets.push({port,ip});callback?.()}
      return socket
    })
    t.mock.method(net,'createServer',()=> {
      const server=new EventEmitter()
      server.listen=(_port,callback)=>callback()
      server.close=callback=>callback?.()
      return server
    })
    try {
      assert.equal((await api.POST(request({action:'status',deviceId:device.id}))).status,200)
      const status=await control.GET(new Request(`http://localhost/api/devices/control?deviceId=${device.id}`))
      assert.equal(status.status,200)
      // Invalid controls resolve the new ID but never issue a mutation command.
      const invalid=await control.POST(request({deviceId:device.id,action:'reboot',value:false}))
      assert.equal(invalid.status,400)
      assert.match((await invalid.json()).error,/Unsupported control or invalid value/)
      const shot=await screenshot.GET(new Request(`http://localhost/api/devices/screenshot?deviceId=${device.id}`))
      assert.equal(shot.status,200)
      assert.deepEqual(Buffer.from(await shot.arrayBuffer()),jpeg)
      const response=await api.GET()
      assert.deepEqual((await response.json()).devices.map(d=>d.id),(await stored()).map(d=>d.id))
      assert.ok(connections.some(c=>c.ip===device.ip && c.port===20110))
      assert.ok(connections.some(c=>c.ip===device.ip && c.port===20114))
      assert.ok(packets.some(p=>p.ip===device.ip && p.port===20116))
      const count=connections.length
      assert.equal((await api.POST(request({action:'status',deviceId:'missing'}))).status,400)
      assert.equal((await control.GET(new Request('http://localhost/api/devices/control?deviceId=missing'))).status,400)
      assert.equal((await screenshot.GET(new Request('http://localhost/api/devices/screenshot?deviceId=missing'))).status,404)
      await assert.rejects(protocol.exchangeDevice({...device,ip:'127.0.0.1'},'STOP;NULL'),/Unknown device/)
      assert.equal(connections.length,count)
    } finally { t.mock.restoreAll() }
  })
  await t.test('removes only the selected entry across restart without hardware traffic',async()=> {
    const before=await stored()
    const device=before.find(d=>d.ip==='10.20.30.40')
    t.mock.method(net,'connect',()=>{throw new Error('Removal must not contact hardware')})
    t.mock.method(dgram,'createSocket',()=>{throw new Error('Removal must not contact hardware')})
    try {
      const response=await api.POST(request({action:'remove',deviceId:device.id,confirmed:true}))
      assert.equal(response.status,200)
      assert.deepEqual(await response.json(),{device})
      const expected=before.filter(d=>d.id!==device.id)
      assert.deepEqual(await stored(),expected)
      assert.deepEqual(registry.devices,expected)
      await assert.rejects(registry.findDevice(device.id),/Unknown device/)
      const output=execFileSync(process.execPath,['--input-type=module','-e',`import {loadDevices} from './lib/devices.mjs'; console.log(JSON.stringify(await loadDevices()))`],{cwd:process.cwd(),env:{...process.env,NOVODS_DATA_DIR:dir},encoding:'utf8'})
      assert.deepEqual(JSON.parse(output),expected)
    } finally { t.mock.restoreAll() }
  })
  await t.test('requires exact confirmation, valid IDs and fields, and same origin without mutation',async()=> {
    const deviceId=(await stored())[0].id
    const before=await readFile(file,'utf8')
    for(const confirmed of [undefined,false,'true',1,null]) {
      assert.equal((await api.POST(request({action:'remove',deviceId,confirmed}))).status,400)
    }
    for(const id of [undefined,null,123,{},[],true,'',' ','bad\nname','x'.repeat(201),'missing']) {
      assert.equal((await api.POST(request({action:'remove',deviceId:id,confirmed:true}))).status,400)
    }
    assert.equal((await api.POST(request({action:'remove',deviceId,confirmed:true,ip:'10.0.0.1'}))).status,400)
    assert.equal((await api.POST(request({action:'remove',deviceId,confirmed:true},'https://evil.example'))).status,400)
    await assert.rejects(registry.removeDevice('missing'),/Unknown device/)
    for(const id of [null,123,'',' ','bad\nname','x'.repeat(201)]) await assert.rejects(registry.removeDevice(id),/Invalid device ID/)
    assert.equal(await readFile(file,'utf8'),before)
  })
  await t.test('serializes concurrent additions and removals without losing entries or metadata',async()=> {
    const before=await stored()
    const removed=before.slice(1,7)
    const results=await Promise.all(removed.flatMap((device,i)=>[
      api.POST(request({action:'remove',deviceId:device.id,confirmed:true})),
      api.POST(request({action:'add',name:`Concurrent ${i}`,ip:`10.42.0.${i+1}`})),
    ]))
    assert.deepEqual(results.map(r=>r.status),removed.flatMap(()=>[200,201]))
    const added=await Promise.all(results.filter((_,i)=>i%2===1).map(async r=>(await r.json()).device))
    assert.deepEqual(await stored(),[...before.filter(d=>!removed.some(r=>r.id===d.id)),...added])
    const id=(await stored()).at(-1).id
    const duplicate=await Promise.all([1,2].map(()=>api.POST(request({action:'remove',deviceId:id,confirmed:true}))))
    assert.deepEqual(duplicate.map(r=>r.status).sort(),[200,400])
    assert.deepEqual(await readdir(dir),['devices.json'])
  })
  await t.test('updates device name and IP while preserving ID, model, and metadata',async()=> {
    const list=await stored()
    const target=list[0]
    const response=await api.POST(request({action:'update',deviceId:target.id,name:' Renamed Player ',ip:'192.168.80.200'}))
    assert.equal(response.status,200)
    const {device}=await response.json()
    assert.equal(device.id,target.id)
    assert.equal(device.name,'Renamed Player')
    assert.equal(device.ip,'192.168.80.200')
    assert.equal(device.model,target.model)
    assert.deepEqual((await stored()).find(d=>d.id===target.id),device)
    const sameIp=await api.POST(request({action:'update',deviceId:target.id,name:'Renamed Again',ip:'192.168.80.200'}))
    assert.equal(sameIp.status,200)
    if(list.length>1) {
      const other=list.find(d=>d.id!==target.id)
      const dup=await api.POST(request({action:'update',deviceId:target.id,name:'Renamed',ip:other.ip}))
      assert.equal(dup.status,400)
    }
    for(const ip of ['8.8.8.8','127.0.0.1','localhost','http://10.0.0.1','invalid',null,123]) {
      assert.equal((await api.POST(request({action:'update',deviceId:target.id,name:'Valid',ip}))).status,400)
    }
    for(const name of ['','   ',null,123,'x'.repeat(201),'bad\nname']) {
      assert.equal((await api.POST(request({action:'update',deviceId:target.id,name,ip:'192.168.80.201'}))).status,400)
    }
    assert.equal((await api.POST(request({action:'update',deviceId:'unknown-id',name:'Valid',ip:'192.168.80.201'}))).status,400)
    assert.equal((await api.POST(request({action:'update',deviceId:target.id,name:'Valid',ip:'192.168.80.201',extra:'bad'}))).status,400)
    assert.equal((await api.POST(request({action:'update',deviceId:target.id,name:'Valid',ip:'192.168.80.201'},'https://evil.example'))).status,400)
  })
  await t.test('removing every entry leaves the registry empty across restart',async()=> {
    for(const device of await stored()) assert.deepEqual(await registry.removeDevice(device.id),device)
    assert.deepEqual(await stored(),[])
    assert.deepEqual(await registry.loadDevices(),[])
    const output=execFileSync(process.execPath,['--input-type=module','-e',`import {loadDevices} from './lib/devices.mjs'; console.log(JSON.stringify(await loadDevices()))`],{cwd:process.cwd(),env:{...process.env,NOVODS_DATA_DIR:dir},encoding:'utf8'})
    assert.deepEqual(JSON.parse(output),[])
    assert.deepEqual(registry.devices,[])
  })
  await t.test('never reseeds empty or corrupted existing files',async()=> {
    await writeFile(file,'[]')
    assert.deepEqual(await registry.loadDevices(),[])
    assert.equal(await readFile(file,'utf8'),'[]')
    await writeFile(file,'{corrupt')
    assert.equal((await api.POST(request({action:'add',name:'New',ip:'10.0.0.99'}))).status,400)
    assert.equal(await readFile(file,'utf8'),'{corrupt')
    await writeFile(file,'{}')
    await assert.rejects(registry.loadDevices(),/Invalid device registry/)
    assert.equal(await readFile(file,'utf8'),'{}')
  })
})
