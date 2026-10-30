import assert from 'node:assert/strict'
import {nativePlaylistXml,nativePlaylistFiles,validNativeName} from '../lib/native-xml.mjs'

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
assert.match(xml,/ContentType="Media" SectionValid="true"/)
assert.match(xml,/Content="a\.jpg"/)
assert.match(xml,/MediaItem src="b\.mp4"[^>]*videoDuration="12"/)
assert.match(xml,/MediaItem src="a\.jpg"[^>]*videoDuration="0"/)
assert.match(xml,/Width="1920" Height="1080"/)
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
console.log('Native XML serializer checks passed')
