import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {mkdtemp,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import dgram from 'node:dgram'

const dir=await mkdtemp(path.join(os.tmpdir(),'novods-snapshot-'))
process.env.NOVODS_DATA_DIR=dir
const {loadDevices}=await import('../lib/devices.mjs')
const {snapshot}=await import('../lib/protocol.mjs')
const [first,second]=await loadDevices()
const jpeg=Buffer.from('ffd8ffe0aabbffd9','hex')
const currentJpeg=Buffer.from('ffd8ffe0ccddffd9','hex')
const push=Buffer.concat([Buffer.from([0,0,0,0,0,jpeg.length]),jpeg])
test.after(()=>rm(dir,{recursive:true,force:true}))

function transport(t,plans) {
  const events=[],servers=[],clients=[]
  let index=0,active=0,maxActive=0,direct=true
  t.mock.method(dgram,'createSocket',()=> {
    const udp=new EventEmitter(),capture=index++,plan=plans[capture]
    direct=false
    udp.send=(bytes,port,ip,callback)=> {
      events.push(`${capture}:${bytes.toString('hex')}:${ip}`)
      if(bytes.toString('hex')==='00060f010101' && (plan.startsWith('push') || ['late-push','oversize-push'].includes(plan))) {
        setTimeout(()=> {
          const client=new EventEmitter()
          client.remoteAddress=`::ffff:${ip}`
          client.destroy=()=>{client.destroyed=true;client.emit('close')}
          clients.push(client)
          servers[capture].accept(client)
          client.emit('data',plan==='oversize-push'?Buffer.concat([push,Buffer.alloc(16*1024*1024)]):push)
        },plan==='late-push'?1550:5)
      }
      setTimeout(()=>callback?.(),2)
    }
    udp.close=callback=>setTimeout(()=>{direct=true;events.push(`${capture}:udp-closed`);callback?.()},8)
    return udp
  })
  t.mock.method(net,'createServer',accept=> {
    const capture=servers.length,listener=new EventEmitter()
    listener.accept=accept
    listener.listen=()=> {
      if(plans[capture]==='occupied') return process.nextTick(()=>listener.emit('error',Object.assign(new Error('Port owned by native Studio'),{code:'EADDRINUSE'})))
      active++;maxActive=Math.max(maxActive,active)
      events.push(`${capture}:listen`)
      process.nextTick(()=>listener.emit('listening'))
    }
    // Match Node's optional listening callback registration.
    const listen=listener.listen
    listener.listen=(port,callback)=>{listener.once('listening',callback);listen(port)}
    listener.close=callback=>setTimeout(()=>{active--;events.push(`${capture}:closed`);callback?.()},10)
    servers.push(listener)
    return listener
  })
  t.mock.method(net,'connect',(_port,ip,callback)=> {
    events.push(`pull:${ip}`)
    const initial=direct,plan=plans[initial?index:index-1]
    const socket=new EventEmitter()
    socket.destroy=()=>{socket.destroyed=true}
    socket.write=bytes=> {
      assert.equal(bytes.toString('hex'),'0000000852000100')
      if(initial && plan==='direct-hang') return
      if(plan==='push-hang') return
      if(plan==='push-end') return socket.emit('end')
      if(plan==='push-invalid') return socket.emit('data',Buffer.alloc(8))
      const image=['direct','push-pull','oversize-push'].includes(plan)?currentJpeg:jpeg
      const frame=Buffer.concat([Buffer.from([0,0,0,8+image.length,0x52,0,1,0]),image])
      socket.emit('data',plan==='push-oversize-pull'?Buffer.concat([frame,Buffer.alloc(16*1024*1024)]):frame)
    }
    process.nextTick(()=> {
      if(initial && !['direct','direct-hang'].includes(plan)) return socket.emit('error',new Error('Initial pull refused'))
      if(initial && plan==='direct') index++
      if(['late-push','push-error'].includes(plan)) socket.emit('error',new Error('Pull refused'))
      else callback?.()
    })
    return socket
  })
  return {events,servers,clients,maxActive:()=>maxActive}
}

test('successful initial pull sends no UDP START or STOP and opens no callback listener',async t=> {
  const state=transport(t,['direct','direct'])
  assert.deepEqual(await Promise.all([snapshot(first,200),snapshot(second,200)]),[currentJpeg,currentJpeg])
  assert.deepEqual(state.events,[`pull:${first.ip}`,`pull:${second.ip}`])
  assert.equal(state.servers.length,0)
})

test('initial direct timeout falls back and queue continues without hanging',async t=> {
  const state=transport(t,['direct-hang','push'])
  const results=await Promise.allSettled([snapshot(first,60),snapshot(second,100)])
  assert.equal(results[0].status,'rejected')
  assert.match(results[0].reason.message,/timeout/)
  assert.deepEqual(results[1].value,jpeg)
  assert.equal(state.maxActive(),1)
  assert.ok(state.events.includes(`0:050f010100:${first.ip}`))
  assert.ok(state.events.includes(`0:00060f010101:${first.ip}`))
})

test('queues captures across devices until callback port and UDP cleanup finish',async t=> {
  const state=transport(t,['push','push'])
  const results=await Promise.all([snapshot(first,200),snapshot(second,200)])
  assert.deepEqual(results,[jpeg,jpeg])
  assert.equal(state.maxActive(),1)
  assert.ok(state.events.indexOf('0:closed')<state.events.indexOf('1:listen'))
  assert.ok(state.events.indexOf('0:udp-closed')<state.events.indexOf('1:listen'))
  assert.ok(state.clients.every(c=>c.destroyed))
})

test('timeout rejects only active capture and queue continues with full per-capture timeout',async t=> {
  const state=transport(t,['silent','push'])
  const results=await Promise.allSettled([snapshot(first,40),snapshot(second,40)])
  assert.equal(results[0].status,'rejected')
  assert.match(results[0].reason.message,/timeout/)
  assert.equal(results[1].status,'fulfilled')
  assert.deepEqual(results[1].value,jpeg)
  assert.equal(state.maxActive(),1)
  assert.ok(state.events.some(e=>e===`0:050f020000:${first.ip}`))
  assert.ok(state.events.some(e=>e===`0:00060f020001:${first.ip}`))
})

test('native-owned callback port falls back to pull without closing or killing its owner',async t=> {
  const state=transport(t,['occupied','push'])
  assert.deepEqual(await snapshot(first,2000),jpeg)
  assert.ok(state.events.includes(`pull:${first.ip}`))
  assert.ok(!state.events.includes('0:closed'))
  assert.deepEqual(await snapshot(second,200),jpeg)
})

test('invalid queued device does not block the next capture',async t=> {
  const state=transport(t,['push'])
  const results=await Promise.allSettled([snapshot({...first,ip:'127.0.0.1'}),snapshot(second,200)])
  assert.equal(results[0].status,'rejected')
  assert.match(results[0].reason.message,/Unknown device/)
  assert.deepEqual(results[1].value,jpeg)
  assert.equal(state.servers.length,1)
})

test('pull refusal does not cancel a pending callback capture',async t=> {
  const state=transport(t,['late-push'])
  assert.deepEqual(await snapshot(second,2000),jpeg)
  assert.ok(state.events.includes(`pull:${second.ip}`))
  assert.ok(state.clients.every(c=>c.destroyed))
})

test('successful pull wins over a differing early callback',async t=> {
  const state=transport(t,['push-pull'])
  assert.deepEqual(await snapshot(first,2000),currentJpeg)
  assert.ok(state.events.includes(`pull:${first.ip}`))
  assert.ok(state.events.includes(`0:050f010100:${first.ip}`))
  assert.ok(state.events.includes(`0:00060f010101:${first.ip}`))
  assert.ok(state.clients.every(c=>c.destroyed))
})

for(const plan of ['push-error','push-end','push-invalid','push-oversize-pull','push-hang']) {
  test(`retained callback is fallback for ${plan}`,async t=> {
    const state=transport(t,[plan,'push'])
    assert.deepEqual(await snapshot(first,1700),jpeg)
    assert.ok(state.events.includes(`pull:${first.ip}`))
    assert.deepEqual(await snapshot(second,40),jpeg)
    assert.equal(state.maxActive(),1)
    assert.ok(state.events.indexOf('0:closed')<state.events.indexOf('1:listen'))
    assert.ok(state.events.indexOf('0:udp-closed')<state.events.indexOf('1:listen'))
    assert.ok(state.clients.every(c=>c.destroyed))
  })
}

test('oversized callback buffer is discarded without preventing pull success',async t=> {
  const state=transport(t,['oversize-push'])
  assert.deepEqual(await snapshot(first,2000),currentJpeg)
  assert.ok(state.clients.every(c=>c.destroyed))
})
