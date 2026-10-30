import assert from 'node:assert/strict'
import {nativePlaylistXml,nativePlaylistFiles,validNativeName,nativeScheduleXml,nativeSchedulePayload,nativeScheduleMatches} from '../lib/native-xml.mjs'

const items=[
  {fileName:'a.jpg',size:1234,mediaType:'image',duration:7},
  {fileName:'b.mp4',size:999,mediaType:'video',duration:12},
]
const xml=nativePlaylistXml({name:'Studio & <test>',width:1920,height:1080,items,uuid:'u-1'})
assert.match(xml,/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<NovoDS Version="1\.1" /)
assert.match(xml,/Description="Studio &amp; &lt;test&gt;"/)
assert.match(xml,/Playlist_UUID="u-1"/)
assert.match(xml,/Model_Type="ds200" Interactive="false" Layout_Type="1"/)
assert.equal((xml.match(/<Page /g)||[]).length,2)
assert.match(xml,/ContentType="Media" SectionValid="1"/)
assert.doesNotMatch(xml,/ Content="/)
assert.equal((xml.match(/Orientation="0"/g)||[]).length,2)
// Native saveXML nests model data inside Content, including its attachment manifest.
const sections=[...xml.matchAll(/<Section\b[^>]*>\s*<Content\b[^>]*>([\s\S]*?)<\/Content>\s*<\/Section>/g)]
assert.equal(sections.length,2)
for(const [index,section] of sections.entries()) {
  assert.match(section[1],new RegExp(`<AttachmentFiles>\\s*<File Name="${items[index].fileName}" Size="${items[index].size}"/>\\s*</AttachmentFiles>\\s*<MediaItem `))
}
assert.match(xml,/<\/Pages>\s*<Timeline Looping="true">\s*<Item Duration="7" Page="1"\/>\s*<Item Duration="12" Page="2"\/>\s*<\/Timeline>/)
const portrait=nativePlaylistXml({name:'Portrait',width:1080,height:1920,items:[{...items[0],duration:7.6}]})
assert.match(portrait,/Orientation="1"/)
assert.match(portrait,/<Content[^>]* duration="8"/)
assert.match(portrait,/<Item Duration="8" Page="1"\/>/)
assert.match(xml,/<Content isVideoFillArea="false" Detect_Picture_Orientation="false" showType="Default" scaleType="FIT_CENTER" duration="7">/)
assert.doesNotMatch(xml,/totalTime=/)
const escaped=nativePlaylistXml({name:'Escaped',items:[{...items[0],fileName:'a&".jpg'}]})
assert.match(escaped,/<File Name="a&amp;&quot;\.jpg" Size="1234"\/>/)
assert.match(escaped,/<MediaItem src="a&amp;&quot;\.jpg"/)
assert.match(xml,/MediaItem src="b\.mp4"[^>]*videoDuration="12"/)
assert.match(xml,/MediaItem src="a\.jpg"[^>]*videoDuration="0"/)
assert.match(xml,/Width="1" Height="1"/)
assert.ok(xml.endsWith('</NovoDS>\n'))

const files=nativePlaylistFiles({
  name:'T',width:1920,height:1080,items,
  mediaBytes:{'a.jpg':Buffer.alloc(10),'b.mp4':Buffer.alloc(20)},
})
assert.equal(files.length,3)
assert.equal(files[0].fileName,'index.xml')
assert.ok(files[0].bytes.includes(Buffer.from('NovoDS')))
assert.equal(files[1].fileName,'a.jpg')
assert.equal(files[1].bytes.length,10)

// Rejections
for(const bad of [
  ()=>nativePlaylistXml({name:'a/b',items}),
  ()=>nativePlaylistXml({name:'',items}),
  ()=>nativePlaylistXml({name:'x',width:0,height:1080,items}),
  ()=>nativePlaylistXml({name:'x',items:[]}),
  ()=>nativePlaylistXml({name:'x',items:[{fileName:'sub/dir.jpg',duration:5,mediaType:'image'}]}),
  ()=>nativePlaylistXml({name:'x',items:[{fileName:'../evil.jpg',duration:5,mediaType:'image'}]}),
  ()=>nativePlaylistXml({name:'x',items:[{fileName:'ok.jpg',duration:0.5,mediaType:'image'}]}),
]) assert.throws(bad)
assert.throws(()=>nativePlaylistFiles({name:'T',items,mediaBytes:{'a.jpg':Buffer.alloc(1)}}),/Missing media bytes/)
assert.throws(()=>nativePlaylistFiles({name:'T',items:[items[0],items[0]],mediaBytes:{'a.jpg':Buffer.alloc(1),}}),/Duplicate/)
assert.equal(validNativeName('Studio_Test'),true)
assert.equal(validNativeName('a/b'),false)
assert.equal(validNativeName('..\\evil'),false)

const schedule={id:'sc-1',name:'Weekday & welcome',start:'08:30',end:'12:00',days:[1,2,3,4,5]}
const now=new Date(2026,9,30,10,0)
const scheduleXml=nativeScheduleXml({schedule,playlistName:'Studio & <test>',now})
assert.match(scheduleXml,/Type="3"/)
assert.match(scheduleXml,/WeekMask="31"/)
assert.match(scheduleXml,/Duration="12600"/)
assert.match(scheduleXml,/StartTime="-1" EndTime="-1"/)
assert.match(scheduleXml,new RegExp(`DateTime="${new Date(2026,9,30,8,30).getTime()}"`))
assert.match(scheduleXml,/Playlist="Studio &amp; &lt;test&gt;"/)
assert.ok(nativeScheduleMatches(scheduleXml.replaceAll('"',"'"),scheduleXml))
assert.ok(!nativeScheduleMatches(scheduleXml.replace('WeekMask="31"','WeekMask="127"'),scheduleXml))
for(const [days,mask] of [[[0],64],[[1],1],[[6],32],[[0,1,2,3,4,5,6],127]]) assert.match(nativeScheduleXml({schedule:{...schedule,days},playlistName:'Loop',now}),new RegExp(`WeekMask="${mask}"`))
const payload=nativeSchedulePayload({scheduleXml,playlists:[{name:'Studio & <test>',files}]})
assert.ok(payload.startsWith(scheduleXml+'[.PLS_FILES.]<?xml'))
assert.match(payload,new RegExp(`<File Name="index.xml" Size="${files[0].bytes.length}"/>`))
assert.match(payload,/<Playlist Name="Studio &amp; &lt;test&gt;">/)
for(const change of [{days:[]},{days:[1,1]},{days:[7]},{start:'25:00'},{end:'08:00'},{name:'bad\u0000name'}]) assert.throws(()=>nativeScheduleXml({schedule:{...schedule,...change},playlistName:'Loop',now}))
assert.throws(()=>nativeSchedulePayload({scheduleXml,playlists:[]}),/playlist/i)
console.log('Native XML serializer checks passed')
