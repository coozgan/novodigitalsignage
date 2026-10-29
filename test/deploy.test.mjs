import assert from 'node:assert/strict'
import net from 'node:net'
import {once} from 'node:events'
import {createDecipheriv} from 'node:crypto'
import {uploadIV,uploadHeader,uploadChunks,parseUploadAcknowledgement,transferFile,openUploadControl,deployPlaylistSession,deployScheduleSession} from '../lib/deploy.mjs'
import {encodeFrame,decodeFrame} from '../lib/protocol.mjs'

const key=Buffer.alloc(32,7),iv=Buffer.alloc(16,3)
assert.equal(uploadIV(0).toString('hex'),'0000000000ff00ffff00ff00ffffffff')
assert.equal(uploadIV(3600).toString('hex'),'100e000000ef00f1ff0eff10fffff1ef')
for(const value of [-1,86400,NaN,0.5]) assert.throws(()=>uploadIV(value))
await assert.rejects(deployPlaylistSession({
  control:{request(){assert.fail('Invalid files must not reach the device')}},
  playlistName:'Test',files:[{fileName:'../bad',bytes:Buffer.from('x')}],
}),/Invalid native upload filename/)
assert.equal(uploadHeader('index.xml',17,2,1,3600).toString('hex'),'000000275100020100000e1009696e6465782e786d6c')
for(const name of ['../x','a/b','a\\b','bad\nname','x'.repeat(129)]) assert.throws(()=>uploadHeader(name,17,1,1,0))
assert.throws(()=>uploadHeader('x',0,1,1,0))
assert.throws(()=>uploadHeader('x',1,256,1,0))
assert.throws(()=>uploadHeader('x',1,1,2,0))
assert.throws(()=>uploadHeader('x',1,1,1,86400))
const bytes=Buffer.alloc(1024*1024+17,0x42)
const chunks=[...uploadChunks(bytes,key,iv)]
assert.equal(chunks.length,2)
assert.equal(chunks[0][4],0)
assert.equal(chunks[1][4],1)
assert.equal(chunks[1].readUInt32BE(0),37)
for(let i=0;i<chunks.length;i++) {
  const decipher=createDecipheriv('aes-256-cfb',key,iv)
  const plain=Buffer.concat([decipher.update(chunks[i].subarray(5)),decipher.final()])
  const source=bytes.subarray(i*1024*1024,(i+1)*1024*1024)
  assert.deepEqual(plain.subarray(0,source.length),source)
  assert.ok(plain.subarray(source.length).every(b=>b===0))
}
const ack=Buffer.from('0000000851000201','hex')
for(let i=0;i<8;i++) assert.equal(parseUploadAcknowledgement(ack.subarray(0,i)),undefined)
assert.equal(parseUploadAcknowledgement(ack).command,0x51)
assert.throws(()=>parseUploadAcknowledgement(Buffer.from('0000000751000201','hex')))
assert.throws(()=>parseUploadAcknowledgement(Buffer.from('0000000852000201','hex')))

let captured=Buffer.alloc(0)
const server=net.createServer(socket=> {
  socket.on('data',data=> {
    captured=Buffer.concat([captured,data])
    if(captured.length===59) {socket.write(ack.subarray(0,3));setTimeout(()=>socket.end(ack.subarray(3)),5)}
  })
})
server.listen(0,'127.0.0.1')
await once(server,'listening')
try {
  const result=await transferFile({host:'127.0.0.1',port:server.address().port,fileName:'index.xml',bytes:Buffer.alloc(17,1),count:2,index:1,key,iv,seconds:3600,timeout:1000})
  assert.equal(result.command,0x51)
  assert.deepEqual(captured.subarray(0,22),uploadHeader('index.xml',17,2,1,3600))
} finally {server.close();await once(server,'close')}
const silent=net.createServer(socket=>{socket.on('data',()=>{})})
silent.listen(0,'127.0.0.1')
await once(silent,'listening')
try {
  await assert.rejects(transferFile({host:'127.0.0.1',port:silent.address().port,fileName:'x',bytes:Buffer.alloc(16),count:1,index:1,key,iv,seconds:0,timeout:30}),/timed out/)
} finally {silent.close();await once(silent,'close')}

// Full native upload sequence against a mock device: persistent framed control socket plus data sockets.
const controlCommands=[],dataFiles=[]
const controlServer=net.createServer(socket=> {
  let buffer=''
  socket.on('data',bytes=> {
    buffer+=bytes.toString('ascii')
    for(const line of buffer.split('\r\n').slice(0,-1)) {
      const command=decodeFrame(line);controlCommands.push(command)
      const reply=command==='TCP_UPLOAD;My List'?'[PLAYLIST_INFO]':command==='TCP_UPLOAD_DONE;My List'?'[TCP_UPLOAD_DONE]ok':undefined
      if(reply) socket.write(encodeFrame(reply))
    }
    buffer=buffer.split('\r\n').at(-1)
  })
})
const data=net.createServer(socket=> {
  let received=Buffer.alloc(0)
  socket.on('data',bytes=> {
    received=Buffer.concat([received,bytes])
    if(received.length<13) return
    const headerLen=13+received[12]
    if(received.length<headerLen+4) return
    const chunkLen=received.readUInt32BE(headerLen)
    if(received.length===headerLen+chunkLen) {
      dataFiles.push(received.subarray(0,headerLen))
      socket.write(ack)
    }
  })
})
controlServer.listen(0,'127.0.0.1');data.listen(0,'127.0.0.1')
await Promise.all([once(controlServer,'listening'),once(data,'listening')])
try {
  const session=await openUploadControl({host:'127.0.0.1',port:controlServer.address().port,timeout:500})
  try {
    const result=await deployPlaylistSession({
      control:session,host:'127.0.0.1',port:data.address().port,playlistName:'My List',
      files:[{fileName:'index.xml',bytes:Buffer.alloc(17,1)},{fileName:'a.jpg',bytes:Buffer.alloc(16,2)}],
      deriveKey:async fileName=>Buffer.alloc(32,7),deriveIV:async()=>Buffer.alloc(16,3),
      now:new Date(2026,9,29,1,0,0),timeout:500,
    })
    assert.equal(result.done,'[TCP_UPLOAD_DONE]ok')
    assert.deepEqual(controlCommands,['TCP_UPLOAD;My List','TCP_UPLOAD_FILE_COUNT;2','TCP_UPLOAD_DONE;My List'])
    assert.equal(dataFiles.length,2)
    assert.deepEqual(dataFiles[0],uploadHeader('index.xml',17,2,1,3600))
    assert.deepEqual(dataFiles[1],uploadHeader('a.jpg',16,2,2,3600))
    await deployScheduleSession({
      control:session,scheduleContent:'<AlarmManager/>[.PLS_FILES.]<Playlists/>',
      playlists:[{name:'My List',files:[{fileName:'index.xml',bytes:Buffer.alloc(17,1)}]}],
      host:'127.0.0.1',port:data.address().port,deriveKey:async()=>Buffer.alloc(32,7),deriveIV:async()=>Buffer.alloc(16,3),
      now:new Date(2026,9,29,1,0,0),timeout:500,
    })
    assert.equal(controlCommands[3],'SCHEDULE;<AlarmManager/>[.PLS_FILES.]<Playlists/>')
    // Control must reject unexpected ack commands.
    await assert.rejects(session.request('TCP_UPLOAD;My List',f=>f.startsWith('[NOPE]'),50),/Timed out/)
  } finally {session.close()}
} finally {controlServer.close();data.close();await Promise.all([once(controlServer,'close'),once(data,'close')])}
console.log('Deployment framing, encryption, fragmented acknowledgement and timeout checks passed')
