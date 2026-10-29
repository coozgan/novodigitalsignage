import test from 'node:test'
import assert from 'node:assert/strict'
import {controlCommand,controlOutcome,parseStatus,parsePlaylists,volumeQuery} from '../lib/control.mjs'
import {POST} from '../app/api/devices/control/route.js'

test('native control mappings use exact wire commands',()=> {
  assert.equal(volumeQuery,'REMOTE_CONTROL;[GET_Volume_Status]')
  const cases=[['stop',undefined,'STOP;NULL'],['reboot',true,'REMOTE_CONTROL;[RC_SET_RebootDevice]NULL'],['orientation','Portrait-R','REMOTE_CONTROL;[SET_ScreenOrientation]Portrait-R'],['zoom',95,'REMOTE_CONTROL;[SET_ScreenZoomPercent]95'],['name','Canteen','REMOTE_CONTROL;[SET_Device_Name]Canteen'],['volume',15,'REMOTE_CONTROL;[SET_Volume_Current]15'],['play','[Internal] Example','TCP_PLAY;[Internal] Example']]
  for(const [action,value,expected] of cases) assert.equal(controlCommand(action,value,{volume:{min:0,max:15},playlists:[{name:'[Internal] Example'}]}),expected)
})
test('reject unsafe, unknown and out of range arguments',()=> {
  for(const [action,value] of [['reset',true],['network','x'],['password','x'],['stop','NULL'],['reboot',false],['reboot','true'],['orientation','portrait'],['orientation',0],['zoom',79],['zoom',101],['zoom',90.5],['zoom','90'],['name',''],['name','a'.repeat(21)],['name',' x'],['name','x;STOP'],['name','x\n'],['name','x[GET_All]'],['volume',-1],['volume',16],['volume','1'],['play','missing'],['play','x;STOP']]) assert.throws(()=>controlCommand(action,value,{volume:{min:0,max:15},playlists:[{name:'x;STOP'}]}))
  assert.throws(()=>controlCommand('volume',1))
  assert.throws(()=>controlCommand('play','Example'))
})
test('parse native status including nested GET_All and bracketed playlist names',()=> {
  const status=parseStatus(['[REMOTE_CONTROL][GET_All][GET_Version]v4,[GET_ScreenOrientation]Landscape,[GET_ScreenZoomPercent]100,[GET_NovoDisplay_Playlist_Settings]false:5:[Internal] Demo:false:false,[GET_Device_Name]Canteen','[REMOTE_CONTROL][GET_Volume_Status]Min:0|Max:15|Current:4'])
  assert.equal(status.name,'Canteen')
  assert.equal(status.orientation,'Landscape')
  assert.equal(status.zoom,100)
  assert.deepEqual(status.volume,{min:0,max:15,current:4})
  assert.equal(status.fields.GET_Version,'v4')
  assert.equal(status.fields.GET_NovoDisplay_Playlist_Settings,'false:5:[Internal] Demo:false:false')
  assert.equal(parseStatus(['[REMOTE_CONTROL][GET_Volume_Status]Min:0|Max:15|Current:16']).volume,null)
  assert.equal(parseStatus([]).volume,null)
  assert.deepEqual(parsePlaylists(['[GET_PLAYLISTS][Internal] Demo:29.5 MB,Other:1 GB']),[{name:'[Internal] Demo',size:'29.5 MB'},{name:'Other',size:'1 GB'}])
  assert.deepEqual(parsePlaylists(['garbage','[GET_PLAYLISTS]']),[])
})
test('never claim execution from connection or arbitrary response',()=> {
  assert.equal(controlOutcome('stop',undefined,{reachable:true,frames:['OK']},{}).state,'unverified')
  assert.equal(controlOutcome('volume',4,{reachable:true},{volume:{current:4}}).state,'verified')
  assert.equal(controlOutcome('volume',4,{reachable:true},{volume:{current:5}}).state,'unverified')
  assert.equal(controlOutcome('reboot',true,{reachable:false},null).state,'unreachable')
})
test('API rejects cross origin, unknown device and raw command without device mutation',async()=> {
  for(const [body,origin] of [[{deviceId:'device-1',action:'stop'},'https://evil.example'],[{deviceId:'unknown',action:'stop'},undefined],[{deviceId:'device-1',command:'STOP;NULL'},undefined],[{deviceId:'device-1',action:'reboot',value:false},undefined]]) {
    const response=await POST(new Request('http://localhost:3000/api/devices/control',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)}))
    assert.equal(response.status,400)
  }
})
