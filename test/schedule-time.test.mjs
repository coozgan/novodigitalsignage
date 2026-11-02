import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeScheduleXml} from '../lib/native-xml.mjs'
import {parseDeviceSchedule} from '../lib/device-schedule.mjs'
import {scheduleInstant} from '../lib/schedule-time.mjs'
import {validateStudio} from '../lib/store.mjs'
const schedule={id:'s',name:'JOSHUA',playlistId:'p',start:'14:59',end:'15:01',days:[1,2,3,4,5],timeZone:'Asia/Singapore'}
const now=new Date('2026-11-02T07:00:00Z')
const alarm=s=>parseDeviceSchedule(nativeScheduleXml({schedule:s,playlistName:'trial',now})).alarms[0]
test('reported 14:59–15:01 stays 14:59 in UTC+8 regardless of container timezone',()=> {
  const previous=process.env.TZ
  try {
    for(const tz of ['UTC','Asia/Singapore','America/Los_Angeles']) {
      process.env.TZ=tz
      const a=alarm(schedule)
      assert.equal(a.dateTime,Date.parse('2026-11-02T06:59:00Z'))
      assert.equal(a.duration,120)
      assert.equal(a.type,3)
      assert.equal(a.weekMask,31)
    }
  } finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}
})
test('specific future date emits a one-time alarm and does not require weekdays',()=> {
  const a=alarm({...schedule,recurrence:'once',date:'2026-12-25',days:[]})
  assert.equal(a.type,0)
  assert.equal(a.weekMask,0)
  assert.equal(a.dateTime,Date.parse('2026-12-25T06:59:00Z'))
  assert.equal(a.duration,120)
  assert.equal(alarm({...schedule,recurrence:'once',date:'2026-12-25',start:'00:01'}).dateTime,Date.parse('2026-12-24T16:01:00Z'))
})
test('invalid dates, missing timezone, unsupported recurrence and DST ambiguity are rejected',()=> {
  for(const change of [{date:'2026-02-30',recurrence:'once'},{date:'',recurrence:'once'},{timeZone:'Invalid/Zone'},{timeZone:undefined},{recurrence:'monthly'}]) assert.throws(()=>alarm({...schedule,...change}))
  assert.throws(()=>scheduleInstant('2026-03-08','02:30','America/New_York'),/daylight saving/)
  assert.throws(()=>scheduleInstant('2026-11-01','01:30','America/New_York'),/daylight saving/)
  assert.equal(scheduleInstant('2026-12-25','14:59','Asia/Kolkata'),Date.parse('2026-12-25T09:29:00Z'))
})
test('store accepts once and legacy weekly schedules but rejects invalid date/timezone inputs',()=> {
  const state=s=>({media:[],playlists:[{id:'p',name:'trial',width:1920,height:1080,items:[]}],schedules:[s]})
  validateStudio(state({...schedule,recurrence:'once',date:'2026-12-25',days:[]}),{media:[]})
  const legacy={...schedule};delete legacy.timeZone
  validateStudio(state(legacy),{media:[]})
  for(const change of [{recurrence:'once',date:'2026-02-30'},{timeZone:'bogus'},{recurrence:'monthly'},{days:[]}]) assert.throws(()=>validateStudio(state({...schedule,...change}),{media:[]}))
})
