import test from 'node:test'
import assert from 'node:assert/strict'
import {parseDeviceSchedule,readDeviceSchedule,deleteDeviceSchedule,emptyDeviceSchedule,removeScheduleEntry} from '../lib/device-schedule.mjs'
const xml=`<?xml version='1.0' encoding='utf-8'?><AlarmManager Name='Week &amp; welcome' DefaultPlaylist='' Description='A'><Alarms><Alarm ID='1' Enabled='true' Type='3' DateTime='1793341500000' StartTime='-1' EndTime='-1' Duration='60' WeekMask='16'><Play Repeat='true'><Item Playlist='test' Duration='-1'/></Play></Alarm></Alarms></AlarmManager>`
const reply=xml=>({reachable:true,frames:['[DOWNLOAD_SCHEDULE]'+xml]})
const multi='<AlarmManager Name="Multi" DefaultPlaylist="Baseline" Extra_Field="keep"><Alarms><Alarm ID="duplicate" Enabled="true" Description="first"/><Alarm ID="duplicate" Enabled="false" Description="second" Interval_Hourly="2"><Play Repeat="true"><Item Playlist="Keep" Duration="15" Publishid="original"/></Play></Alarm></Alarms></AlarmManager>'
test('selective deletion removes exactly the indexed entry, preserving untouched XML',()=> {
  const updated=removeScheduleEntry(multi,0)
  assert.equal(updated,multi.replace('<Alarm ID="duplicate" Enabled="true" Description="first"/>',''))
  assert.equal(parseDeviceSchedule(updated).alarms[0].description,'second')
  assert.equal(parseDeviceSchedule(updated).defaultPlaylist,'Baseline')
  assert.equal(parseDeviceSchedule(removeScheduleEntry(updated,0)).alarms.length,0)
  for(const index of [-1,2,0.5,'0',null]) assert.throws(()=>removeScheduleEntry(multi,index))
})
test('selective readback must preserve other entries and default assignment, not merely omit selection',async()=> {
  const before=await readDeviceSchedule({},async()=>reply(multi))
  const expected=removeScheduleEntry(multi,0)
  for(const actual of [expected,expected.replace('Baseline','Changed'),expected.replace('Interval_Hourly="2"','Interval_Hourly="3"'),emptyDeviceSchedule,multi]) {
    const calls=[]
    const result=await deleteDeviceSchedule({},{confirmed:true,revision:before.revision,entryIndex:0},async(_d,c)=> {
      calls.push(c)
      if(c.startsWith('TCP_SCHEDULE;')) {assert.equal(c,'TCP_SCHEDULE;'+expected);return {reachable:true,frames:[]}}
      return reply(calls.length===1?multi:actual)
    })
    assert.equal(result.verified,actual===expected)
  }
})
test('native schedule parses quoted attributes, entities, recurring entries and empty schedule',()=> {
  const schedule=parseDeviceSchedule(xml)
  assert.equal(schedule.name,'Week & welcome')
  assert.equal(schedule.alarms[0].weekMask,16)
  assert.deepEqual(schedule.alarms[0].playlists,[{name:'test',duration:-1,repeat:true}])
  assert.equal(parseDeviceSchedule(emptyDeviceSchedule).alarms.length,0)
  assert.equal(parseDeviceSchedule('<AlarmManager><Alarms><Alarm Enabled="1" Playlist="Legacy"/></Alarms></AlarmManager>').alarms[0].playlists[0].name,'Legacy')
})
test('malformed, partial, duplicate, external-entity and unsupported XML never means empty',()=> {
  for(const bad of ['',xml.slice(0,-10),xml+xml,xml.replace('WeekMask=', 'ID='),xml.replace('Enabled=\'true\'','Enabled=\'maybe\''),xml.replace('Duration=\'60\'','Duration=\'NaN\''),'<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]>'+xml,xml.replace('<Alarms>','<Unknown>'),xml.replace('Week &amp; welcome','Week &evil; welcome')]) assert.throws(()=>parseDeviceSchedule(bad))
})
test('reader requires one complete reachable schedule response',async()=> {
  for(const r of [{reachable:false,frames:[]},{reachable:true,frames:['OK']},{reachable:true,frames:['[DOWNLOAD_SCHEDULE]NULL']},{reachable:true,frames:['[DOWNLOAD_SCHEDULE]'+xml,'[DOWNLOAD_SCHEDULE]'+xml]}]) await assert.rejects(readDeviceSchedule({},async()=>r))
})
test('deletion requires confirmation and fresh exact schedule revision before mutation',async()=> {
  const before=await readDeviceSchedule({},async()=>reply(xml))
  for(const request of [{confirmed:false,revision:before.revision},{confirmed:'true',revision:before.revision},{confirmed:true,revision:''}]) {
    let calls=0
    await assert.rejects(deleteDeviceSchedule({},request,async()=>{calls++;return reply(xml)}))
    assert.equal(calls,0)
  }
  const calls=[]
  await assert.rejects(deleteDeviceSchedule({},{confirmed:true,revision:'0'.repeat(64)},async(_d,c)=>{calls.push(c);return reply(xml)}),/changed/)
  assert.deepEqual(calls,['DOWNLOAD_SCHEDULE;NULL'])
})
test('clear sends native empty schedule only and verifies readback, not an ACK',async()=> {
  const before=await readDeviceSchedule({},async()=>reply(xml))
  for(const state of ['empty','unchanged','unavailable','malformed']) {
    const calls=[]
    const result=await deleteDeviceSchedule({},{confirmed:true,revision:before.revision},async(_d,c)=> {
      calls.push(c)
      if(c.startsWith('TCP_SCHEDULE;')) {assert.equal(c,'TCP_SCHEDULE;'+emptyDeviceSchedule);return {reachable:true,frames:['OK']}}
      if(calls.length===1) return reply(xml)
      return state==='empty'?reply(emptyDeviceSchedule):state==='unchanged'?reply(xml):state==='malformed'?reply('<AlarmManager>'):{reachable:false,frames:[]}
    })
    assert.equal(result.verified,state==='empty')
    assert.deepEqual(calls,['DOWNLOAD_SCHEDULE;NULL','TCP_SCHEDULE;'+emptyDeviceSchedule,'DOWNLOAD_SCHEDULE;NULL'])
  }
})
