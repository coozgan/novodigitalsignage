import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {mkdtemp,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import {emptyDeviceSchedule} from '../lib/device-schedule.mjs'

const dir=await mkdtemp(path.join(os.tmpdir(),'novods-schedule-wire-'))
process.env.NOVODS_DATA_DIR=dir
const {loadDevices}=await import('../lib/devices.mjs')
const {exchangeDevice,decodeFrame}=await import('../lib/protocol.mjs')
const [device]=await loadDevices()
test.after(()=>rm(dir,{recursive:true,force:true}))

test('schedule transport preserves multiline XML and supports schedules larger than 8 KiB',async t=> {
  const sent=[]
  t.mock.method(net,'connect',()=> {
    const socket=new EventEmitter()
    socket.destroy=()=>{}
    socket.write=frame=>{sent.push(decodeFrame(frame));queueMicrotask(()=>socket.emit('end'))}
    queueMicrotask(()=>socket.emit('connect'))
    return socket
  })
  for(const xml of [emptyDeviceSchedule,'<AlarmManager>\r\n<Alarms>'+Array.from({length:200},(_,i)=>`<Alarm ID="${i}" Enabled="true" Description="keep this entry"/>`).join('\n')+'</Alarms>\n</AlarmManager>']) {
    const command='TCP_SCHEDULE;'+xml
    await exchangeDevice(device,command)
    assert.equal(sent.at(-1),command)
  }
  assert.ok(sent[1].length>8192)
})

test('invalid schedules and non-schedule command injection never reach the network',async t=> {
  let connections=0
  t.mock.method(net,'connect',()=>{connections++;throw new Error('Must not connect')})
  for(const command of ['STOP;NULL\n','STOP;NULL\r','STOP;\0','X'.repeat(8193),'TCP_SCHEDULE;<AlarmManager>','TCP_SCHEDULE;'+emptyDeviceSchedule+'\0','TCP_SCHEDULE;<!DOCTYPE x>'+emptyDeviceSchedule,'TCP_SCHEDULE;'+emptyDeviceSchedule+' '.repeat(1024*1024)]) {
    await assert.rejects(exchangeDevice(device,command),/Invalid device command|schedule|Schedule/)
  }
  assert.equal(connections,0)
})
