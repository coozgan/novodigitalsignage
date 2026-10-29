import net from 'node:net'
import {createCipheriv} from 'node:crypto'
import {encodeFrame,decodeFrame} from './protocol.mjs'

const CHUNK_SIZE=1024*1024
export function uploadHeader(fileName,size,count,index,seconds) {
  const name=Buffer.from(fileName,'utf8')
  if(typeof fileName!=='string' || !fileName || /[\x00-\x1f/\\]/.test(fileName) || name.length>128) throw new Error('Invalid native upload filename')
  if(!Number.isSafeInteger(size) || size<1 || size>0xffffffff-141) throw new Error('Invalid upload size')
  if(!Number.isInteger(count) || count<1 || count>255 || !Number.isInteger(index) || index<1 || index>count) throw new Error('Native upload supports 1 to 255 files')
  if(!Number.isInteger(seconds) || seconds<0 || seconds>86399) throw new Error('Invalid upload timestamp')
  const header=Buffer.alloc(13+name.length)
  header.writeUInt32BE(size+header.length)
  header[4]=0x51
  header[6]=count
  header[7]=index
  header.writeUInt32BE(seconds,8)
  header[12]=name.length
  name.copy(header,13)
  return header
}

// Native DataExchangeClient encrypts each 1 MiB chunk independently, reusing its IV.
export function* uploadChunks(bytes,key,iv) {
  if(!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('Empty upload')
  if(!Buffer.isBuffer(key) || key.length!==32 || !Buffer.isBuffer(iv) || iv.length!==16) throw new Error('Invalid native upload key or IV')
  for(let offset=0;offset<bytes.length;offset+=CHUNK_SIZE) {
    const chunk=bytes.subarray(offset,offset+CHUNK_SIZE)
    const padded=Buffer.alloc(Math.ceil(chunk.length/16)*16)
    chunk.copy(padded)
    const cipher=createCipheriv('aes-256-cfb',key,iv)
    const encrypted=Buffer.concat([cipher.update(padded),cipher.final()])
    const frame=Buffer.alloc(5+encrypted.length)
    frame.writeUInt32BE(frame.length)
    frame[4]=offset+chunk.length===bytes.length?1:0
    encrypted.copy(frame,5)
    yield frame
  }
}

export function parseUploadAcknowledgement(bytes) {
  if(bytes.length<4) return
  const length=bytes.readUInt32BE(0)
  if(length<8 || length>65536) throw new Error('Invalid upload acknowledgement length')
  if(bytes.length<length) return
  if(bytes[4]!==0x51) throw new Error('Unexpected upload acknowledgement command')
  // Native only tests command 0x51. This acknowledges file receipt, not playlist installation.
  return {command:bytes[4],type:bytes[5],count:bytes[6],index:bytes[7]}
}

export async function transferFile({host,port=20117,fileName,bytes,count,index,key,iv,seconds,timeout=30000}) {
  const header=uploadHeader(fileName,bytes.length,count,index,seconds)
  const chunks=uploadChunks(bytes,key,iv)
  // Validate crypto before opening a connection or writing a header.
  const first=chunks.next()
  return new Promise((resolve,reject)=> {
    const socket=net.createConnection({host,port})
    let received=Buffer.alloc(0),done=false
    const timer=setTimeout(()=>finish(new Error('File transfer acknowledgement timed out')),timeout)
    function finish(error,ack) {
      if(done) return
      done=true
      clearTimeout(timer)
      socket.destroy()
      error?reject(error):resolve(ack)
    }
    socket.on('error',finish)
    socket.on('end',()=>finish(new Error('File connection closed before acknowledgement')))
    socket.on('data',chunk=> {
      if(received.length+chunk.length>65536) return finish(new Error('Upload acknowledgement exceeds limit'))
      received=Buffer.concat([received,chunk])
      try {
        const ack=parseUploadAcknowledgement(received)
        if(ack) finish(null,ack)
      } catch(error) { finish(error) }
    })
    socket.on('connect',()=> {
      const frames=(function*(){yield header;yield first.value;yield* chunks})()
      function pump() {
        try {
          for(let next=frames.next();!next.done;next=frames.next()) {
            if(done) return
            if(!socket.write(next.value)) {socket.once('drain',pump);return}
          }
        } catch(error) {finish(error)}
      }
      pump()
    })
  })
}

const controlName = name => typeof name==='string' && name.length>0 && name.length<=200 && !/[;\r\n\0]/.test(name)
export function openUploadControl({host,port=20110,timeout=10000}) {
  return new Promise((resolve,reject)=> {
    const socket=net.createConnection({host,port})
    let buffer='',pending,timer=setTimeout(()=>{socket.destroy();reject(new Error('Upload control connection timed out'))},timeout)
    function fail(error) {
      clearTimeout(timer)
      const current=pending;pending=undefined
      socket.destroy()
      current?current.reject(error):reject(error)
    }
    socket.on('error',fail)
    socket.on('end',()=>fail(new Error('Upload control connection closed unexpectedly')))
    socket.on('data',bytes=> {
      buffer+=bytes.toString('ascii')
      if(buffer.length>1024*1024) return fail(new Error('Upload control response exceeds 1 MB'))
      const lines=buffer.split('\n')
      // ponytail: exact 76-char base64 boundary waits for timeout; switch to streaming base64 boundary decoder if observed in practice.
      if(!pending || !buffer.endsWith('\n') || lines.at(-2).length>=76) return
      try {
        const frame=decodeFrame(buffer);buffer=''
        if(!pending.match(frame)) return
        clearTimeout(timer)
        const current=pending;pending=undefined
        current.resolve(frame)
      } catch(error) {fail(error)}
    })
    socket.once('connect',()=> {
      clearTimeout(timer)
      resolve({
        send(command) {
      // DeviceTCP::writeLine preserves embedded newlines inside a single base64-encoded command.
      if(typeof command!=='string' || !command || /\0/.test(command)) throw new Error('Invalid upload control command')
          socket.write(encodeFrame(command))
        },
        request(command,match,wait=timeout) {
          if(pending) return Promise.reject(new Error('Concurrent upload control request'))
          return new Promise((res,rej)=> {
            try {
              this.send(command)
              pending={match,resolve:res,reject:rej}
              timer=setTimeout(()=>fail(new Error(`Timed out waiting for response to ${command.split(';')[0]}`)),wait)
            } catch(error) {rej(error)}
          })
        },
        close() {clearTimeout(timer);pending=undefined;socket.destroy()},
      })
    })
  })
}

export async function deployPlaylistSession({control,host,port=20117,playlistName,files,deriveKey,deriveIV,now=new Date(),timeout=30000}) {
  if(!controlName(playlistName)) throw new Error('Invalid native playlist name')
  if(!Array.isArray(files) || !files.length || files.length>255) throw new Error('Playlist requires 1 to 255 files')
  const seconds=now.getHours()*3600+now.getMinutes()*60+now.getSeconds()
  // Validate every file before starting a device-side upload session.
  for(const [i,file] of files.entries()) {
    if(!file || !Buffer.isBuffer(file.bytes)) throw new Error('Invalid upload bytes')
    uploadHeader(file.fileName,file.bytes.length,files.length,i+1,seconds)
  }
  if(typeof deriveKey!=='function' || typeof deriveIV!=='function') throw new Error('Missing native crypto derivation')
  const info=await control.request(`TCP_UPLOAD;${playlistName}`,f=>f.startsWith('[PLAYLIST_INFO]'),timeout)
  // ponytail: always uploads the full playlist set; parse [PLAYLIST_INFO] MD5/size entries to skip unchanged media once live format is confirmed.
  control.send(`TCP_UPLOAD_FILE_COUNT;${files.length}`)
  const transferred=[]
  for(let i=0;i<files.length;i++) {
    const {fileName,bytes}=files[i]
    const key=await deriveKey(fileName,bytes)
    const iv=await deriveIV(seconds,bytes.length,fileName)
    transferred.push(await transferFile({host,port,fileName,bytes,count:files.length,index:i+1,key,iv,seconds,timeout}))
  }
  const done=await control.request(`TCP_UPLOAD_DONE;${playlistName}`,f=>f.startsWith('[TCP_UPLOAD_DONE]'),timeout)
  if(done.slice('[TCP_UPLOAD_DONE]'.length).toLowerCase()!=='ok') throw new Error(`Device rejected playlist upload: ${done}`)
  return {playlistName,info,transferred,done}
}

export async function deployScheduleSession({control,scheduleContent,playlists,host,port=20117,deriveKey,deriveIV,now=new Date(),timeout=30000}) {
  if(typeof scheduleContent!=='string' || !scheduleContent.includes('[.PLS_FILES.]') || /\0/.test(scheduleContent)) throw new Error('Invalid native schedule upload content')
  if(!Array.isArray(playlists) || !playlists.length) throw new Error('Schedule requires at least one playlist')
  // Device::TCP_uploadSchedule writes SCHEDULE;<AlarmManager>[.PLS_FILES.]<Playlists> on the main control session,
  // then UploadToDevice::slot_sendScheduleToExchangeServer uploads each referenced playlist.
  control.send(`SCHEDULE;${scheduleContent}`)
  const uploaded=[]
  for(const playlist of playlists) uploaded.push(await deployPlaylistSession({control,host,port,playlistName:playlist.name,files:playlist.files,deriveKey,deriveIV,now,timeout}))
  return {uploaded}
}
