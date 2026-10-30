import net from 'node:net'
import dgram from 'node:dgram'

import {loadDevices,findDevice} from './devices.mjs'
export {devices} from './devices.mjs'
const key = Buffer.from('Q3VyaW9zaXR5IGtpbGxlZCB0aGUgY2F0')
export function encodeFrame(text) {
  const bytes = Buffer.from(text)
  return '4D4143' + Buffer.from(bytes.map((v,i)=>v ^ key[i % key.length])).toString('base64') + '\r\n'
}
export function decodeFrame(frame) {
  // Devices reply without the 4D4143 prefix and wrap base64 at 76 chars (Qt toBase64 + \n).
  const body = frame.replace(/^4D4143/,'').replace(/\s+/g,'')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body) || body.length%4!==0) throw new Error('Invalid DeviceTCP frame')
  const bytes = Buffer.from(body,'base64')
  return Buffer.from(bytes.map((v,i)=>v ^ key[i % key.length])).toString('utf8')
}

// ponytail: replies arrive on fixed UDP port 20116; upgrade to full 20111/20114 listener service when native deployment handshakes are verified.
let discovery
export async function discoverDevices(timeout = 1200) {
  const devices=await loadDevices()
  if (discovery) return discovery
  discovery = new Promise((resolve,reject)=> {
    const socket = dgram.createSocket({type:'udp4',reuseAddr:true})
    const found = new Map()
    let timer
    const finish = (err) => {
      clearTimeout(timer)
      socket.close()
      if (err) reject(err)
      else resolve(found)
    }
    socket.once('error',finish)
    socket.on('message',(bytes,remote)=> {
      if (!devices.some(d=>d.ip===remote.address)) return
      const text = bytes.toString('utf8')
      if (!/^NovoDS_[A-Fa-f0-9-]+\s/.test(text)) return
      found.set(remote.address,{deviceName:text.split(' _%&*_ ')[0].trim(),response:text})
    })
    socket.bind(20116,()=> {
      timer = setTimeout(()=>finish(),timeout)
      for (const device of devices) socket.send(Buffer.from('ipaddressssid'),20116,device.ip)
    })
  }).finally(()=>{discovery=undefined})
  return discovery
}

export async function queryDevice(device, action='status', timeout=2000) {
  const command = {status:'REMOTE_CONTROL;[GET_All]',playlists:'GET_PLAYLISTS;NULL'}[action]
  if (!command) throw new Error('Unsupported read-only action')
  return exchangeDevice(device,command,timeout)
}

export async function exchangeDevice(device,command,timeout=3000) {
  const registered=await findDevice(device?.id)
  if(registered.ip!==device.ip) throw new Error('Unknown device')
  device=registered
  if(typeof command!=='string' || command.length>8192 || /[\r\n\0]/.test(command)) throw new Error('Invalid device command')
  return new Promise(resolve=> {
    const socket = net.connect(20110,device.ip)
    const frames=[]
    let buffer='', connected=false, finished=false
    const timer=setTimeout(()=>finish('No complete DeviceTCP response before timeout'),timeout)
    function finish(detail) {
      if (finished) return
      finished=true
      clearTimeout(timer)
      if(buffer.trim()) { try { frames.push(decodeFrame(buffer)); detail='Received DeviceTCP response' } catch {} }
      socket.destroy()
      resolve({...device,reachable:connected,protocolVerified:frames.some(f=>/^\[(REMOTE_CONTROL|GET_PLAYLISTS)\]/.test(f)),frames,detail})
    }
    socket.on('connect',()=>{connected=true;socket.write(encodeFrame(command))})
    socket.on('data',bytes=> {
      buffer+=bytes.toString('ascii')
      if(buffer.length>1024*1024) return finish('Response exceeds 1 MB limit')
      // Android Base64.DEFAULT: 76-char lines joined by \n, trailing \n. A short last line ends the message.
      // ponytail: a reply whose base64 is an exact multiple of 76 chars waits for the timeout fallback below.
      const lines=buffer.split('\n')
      if(buffer.endsWith('\n') && lines.at(-2).length<76) {
        try { frames.push(decodeFrame(buffer)) } catch { return finish('Device returned an unrecognized control frame') }
        buffer=''
        finish('Received DeviceTCP response')
      }
    })
    socket.on('error',error=>finish(error.message))
    socket.on('end',()=>finish(frames.length?'Received DeviceTCP response':'Device closed connection without a response'))
  })
}

// Native flow (Communication + CDataExchangeClient2): UDP 20112 [len,0x0f,1,1] starts capture,
// then TCP 20114 request [u32be 8][0x52][type 0][u16 1]; reply is [u32be total][4-byte header][JPEG].
// Some devices (.100) instead connect back to us on TCP 20114 and push [u16 ?][u32be len][JPEG];
// native triggers that by also sending AES-port start 00 06 0f 01 01 01 on UDP 20109.
const SHOT_START=Buffer.from('050f010100','hex'), SHOT_STOP=Buffer.from('050f020000','hex')
const SHOT_START_AES=Buffer.from('00060f010101','hex'), SHOT_STOP_AES=Buffer.from('00060f020001','hex')
const SHOT_REQ=Buffer.from('0000000852000100','hex'), SHOT_MAX=16*1024*1024
export function parseSnapshot(buf) {
  if(buf.length<8) return
  const total=buf.readUInt32BE(0)
  if(total<8||total>SHOT_MAX) throw new Error('Invalid snapshot length')
  if((buf[4]&0xfe)!==0x52) throw new Error('Unexpected snapshot command')
  if(buf.length<total) return
  const jpeg=buf.subarray(8,total)
  if(jpeg.length<4 || jpeg[0]!==0xff || jpeg[1]!==0xd8 || jpeg.at(-2)!==0xff || jpeg.at(-1)!==0xd9) throw new Error('Snapshot is not a complete JPEG')
  return jpeg
}
export function parsePush(buf) {
  if(buf.length<6) return
  const len=buf.readUInt32BE(2)
  if(len<3||len>SHOT_MAX) throw new Error('Invalid pushed snapshot length')
  if(buf.length<6+len) return
  const jpeg=buf.subarray(6,6+len)
  if(jpeg[0]!==0xff||jpeg[1]!==0xd8) throw new Error('Pushed snapshot is not a JPEG')
  return jpeg
}
// ponytail: serialize captures because native push callbacks share TCP 20114; use a shared listener for parallel captures.
let snapshotQueue=Promise.resolve()
export function snapshot(device,timeout=10000) {
  const capture=snapshotQueue.then(()=>captureSnapshot(device,timeout))
  snapshotQueue=capture.catch(()=>{})
  return capture
}
async function captureSnapshot(device,timeout) {
  const registered=await findDevice(device?.id)
  if(registered.ip!==device.ip) throw new Error('Unknown device')
  device=registered
  const started=Date.now()
  try {
    return await new Promise((resolve,reject)=> {
      const socket=net.connect(20114,device.ip,()=>socket.write(SHOT_REQ))
      let chunks=[],size=0,done=false
      const timer=setTimeout(()=>finish(new Error('Direct snapshot timeout')),Math.min(1500,timeout/2))
      function finish(error,jpeg) {
        if(done) return
        done=true; clearTimeout(timer); socket.destroy(); chunks=[]
        if(error) reject(error)
        else resolve(jpeg)
      }
      socket.on('data',bytes=> {
        if(done) return
        if(size+bytes.length>SHOT_MAX) return finish(new Error('Snapshot exceeds size limit'))
        chunks.push(bytes); size+=bytes.length
        try { const jpeg=parseSnapshot(Buffer.concat(chunks,size)); if(jpeg) finish(null,Buffer.from(jpeg)) } catch(error) { finish(error) }
      })
      socket.on('error',finish)
      socket.on('end',()=>finish(new Error('Device closed connection before screenshot completed')))
    })
  } catch {}
  timeout=Math.max(1,timeout-(Date.now()-started))
  const udp=dgram.createSocket('udp4'), sendUdp=p=>udp.send(p,20112,device.ip)
  return new Promise((resolve,reject)=> {
    let socket, server, delay, chunks=[], size=0, done=false
    const callbacks=new Set()
    const timer=setTimeout(()=>finish(new Error('Device did not send a screenshot before timeout')),timeout)
    function finish(error,jpeg) {
      if(done) return
      done=true; clearTimeout(timer); clearTimeout(delay); socket?.destroy()
      for(const client of callbacks) client.destroy()
      // Do not release the queue until the fixed port is closed and STOP has been sent.
      const closed=new Promise(resolve=>server?server.close(()=>resolve()):resolve())
      const stopped=new Promise(resolve=>udp.send(SHOT_STOP,20112,device.ip,()=>udp.send(SHOT_STOP_AES,20109,device.ip,()=>udp.close(()=>resolve()))))
      Promise.all([closed,stopped]).then(()=>error?reject(error):resolve(jpeg),reject)
    }
    function start() {
      if(done) return
      sendUdp(SHOT_START)
      udp.send(SHOT_START_AES,20109,device.ip)
    }
    udp.on('error',e=>finish(e))
    // A native Studio listener may own 20114. Leave it alone and fall back to pull-only.
    server=net.createServer(c=> {
      if(done || callbacks.size || c.remoteAddress?.replace(/^::ffff:/,'')!==device.ip) return c.destroy()
      callbacks.add(c)
      c.on('close',()=>callbacks.delete(c))
      const parts=[]; let n=0
      c.on('data',d=> {
        if(done || n+d.length>SHOT_MAX) return c.destroy()
        parts.push(d); n+=d.length
        try {
          // Callback images can be stale. Drain and validate, but only a pull may succeed.
          if(parsePush(Buffer.concat(parts,n))) c.destroy()
        } catch { c.destroy() }
      })
      c.on('error',()=>{})
    })
    server.on('error',()=>{server=undefined; start()})
    server.listen(20114,start)
    // ponytail: fixed 1.5 s capture delay matches what worked on hardware; upgrade to UDP ack if one is found.
    delay=setTimeout(()=> {
      socket=net.connect(20114,device.ip,()=>socket.write(SHOT_REQ))
      socket.on('data',c=> {
        if(done) return
        if(size+c.length>SHOT_MAX) return finish(new Error('Snapshot exceeds size limit'))
        chunks.push(c); size+=c.length
        try { const jpeg=parseSnapshot(Buffer.concat(chunks,size)); if(jpeg) finish(null,Buffer.from(jpeg)) } catch(e) { finish(e) }
      })
      socket.on('error',finish)
      socket.on('end',()=>finish(new Error('Device closed connection before screenshot completed')))
    },1500)
  })
}

export async function inspectDevices() {
  const devices=await loadDevices()
  const [discovered,results] = await Promise.all([
    discoverDevices().catch(error=>({error:error.message})),
    Promise.all(devices.map(d=>queryDevice(d))),
  ])
  return results.map(device=>({...device,reachable:device.reachable || discovered instanceof Map && discovered.has(device.ip),discovery:discovered instanceof Map?discovered.get(device.ip):undefined,discoveryError:discovered.error,checkedAt:new Date().toISOString()}))
}
