import test from 'node:test'
import assert from 'node:assert/strict'
import {controlCommand,controlOutcome,parseStatus,parsePlaylists,volumeQuery,playlistReadback,deletePlaylist} from '../lib/control.mjs'
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
test('delete uses exact native command, explicit confirmation and device allowlist',()=> {
  const name='[Internal] Demo', context={confirmed:true,playlists:[{name}]}
  assert.equal(controlCommand('delete',name,context),'DELETE;[Internal] Demo')
  for(const confirmed of [undefined,false,'true',1]) assert.throws(()=>controlCommand('delete',name,{...context,confirmed}))
  assert.throws(()=>controlCommand('delete','missing',context))
  assert.throws(()=>controlCommand('delete',name,{confirmed:true}))
  for(const value of ['',null,1,'x;STOP','x\n','x\0','x\x7f','../x','a/b','a\\b','x:y','x,y',' x','x|y','@_overlaymessage','a'.repeat(256)]) {
    assert.throws(()=>controlCommand('delete',value,{confirmed:true,playlists:[{name:value}]}))
  }
  assert.throws(()=>controlCommand('update',name,context))
  assert.throws(()=>controlCommand('firmware',true,context))
})
test('delete readback fails closed on missing, error, partial, duplicate or ambiguous listings',()=> {
  assert.deepEqual(playlistReadback(['[GET_PLAYLISTS]']),[])
  assert.deepEqual(playlistReadback(['[GET_PLAYLISTS][Internal] Demo:29.5 MB,Other:100 BYTES']),[{name:'[Internal] Demo',size:'29.5 MB'},{name:'Other',size:'100 BYTES'}])
  for(const frames of [[],['OK'],['[GET_PLAYLISTS][ERROR]playing'],['[GET_PLAYLISTS]Demo:1 MB,broken'],['[GET_PLAYLISTS]Demo:1 MB,Demo:2 MB'],['[GET_PLAYLISTS]','[GET_PLAYLISTS]Demo:1 MB'],['[GET_PLAYLISTS]Demo:.. MB']]) assert.equal(playlistReadback(frames),null)
})
test('delete orchestration reads fresh allowlist and verifies only valid absence, never an ACK',async()=> {
  const name='[Internal] Demo', calls=[]
  for(const [after,state] of [
    [{reachable:true,frames:['[GET_PLAYLISTS]Other:2 MB']},'verified'],
    [{reachable:true,frames:['[GET_PLAYLISTS]']},'verified'],
    [{reachable:true,frames:[`[GET_PLAYLISTS]${name}:1 MB`]},'unverified'],
    [{reachable:true,frames:['OK']},'unverified'],
    [{reachable:true,frames:['[GET_PLAYLISTS]broken']},'unverified'],
    [{reachable:false,frames:[]},'unverified'],
  ]) {
    calls.length=0
    const result=await deletePlaylist({id:'offline-fixture'},name,true,{
      queryDevice:async(device,action)=>{calls.push(action); return calls.length===1?{reachable:true,frames:[`[GET_PLAYLISTS]${name}:1 MB`]}:after},
      exchangeDevice:async(device,command)=>{calls.push(command); return {reachable:true,frames:['OK']}},
    })
    assert.deepEqual(calls,['playlists',`DELETE;${name}`,'playlists'])
    assert.equal(result.state,state)
  }
})
test('delete never sends a mutation when confirmation or fresh allowlist fails',async()=> {
  for(const [confirmed,before] of [[false,null],['true',null],[true,{reachable:false,frames:[]}],[true,{reachable:true,frames:['[GET_PLAYLISTS]']}],[true,{reachable:true,frames:['[GET_PLAYLISTS]Demo:1 MB,broken']}]]) {
    let sent=false
    await assert.rejects(deletePlaylist({},'Demo',confirmed,{
      queryDevice:async()=>{assert.equal(confirmed,true);return before},
      exchangeDevice:async()=>{sent=true;throw new Error('Must not send')},
    }))
    assert.equal(sent,false)
  }
})
test('API rejects unconfirmed delete without querying hardware',async()=> {
  for(const confirmed of [undefined,false,'true']) {
    const response=await POST(new Request('http://localhost:3000/api/devices/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:'device-1',action:'delete',value:'Demo',confirmed})}))
    assert.equal(response.status,400)
    assert.match((await response.json()).error,/Confirm playlist deletion/)
  }
})
