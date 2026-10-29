import net from 'node:net'
import dgram from 'node:dgram'

export const devices = [
  {id:'device-1',name:'Device 1',ip:'192.168.80.128',model:'ds200'},
  {id:'device-2',name:'Device 2',ip:'192.168.80.100',model:'ds200'},
]
const key = Buffer.from('Q3VyaW9zaXR5IGtpbGxlZCB0aGUgY2F0')
export function encodeFrame(text) {
  const bytes = Buffer.from(text)
  return '4D4143' + Buffer.from(bytes.map((v,i)=>v ^ key[i % key.length])).toString('base64') + '\r\n'
}
export function decodeFrame(frame) {
  if (!/^4D4143[A-Za-z0-9+/]*={0,2}\r\n$/.test(frame)) throw new Error('Invalid DeviceTCP frame')
  const bytes = Buffer.from(frame.slice(6,-2),'base64')
  return Buffer.from(bytes.map((v,i)=>v ^ key[i % key.length])).toString('utf8')
}

// ponytail: replies arrive on fixed UDP port 20116; upgrade to full 20111/20114 listener service when native deployment handshakes are verified.
let discovery
export function discoverDevices(timeout = 1200) {
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

export function queryDevice(device, action='status', timeout=2000) {
  if (!devices.some(d=>d.ip===device.ip)) throw new Error('Unknown device')
  const command = {status:'REMOTE_CONTROL;[GET_All]',playlists:'GET_PLAYLISTS;NULL'}[action]
  if (!command) throw new Error('Unsupported read-only action')
  return new Promise(resolve=> {
    const socket = net.connect(20110,device.ip)
    const frames=[]
    let buffer='', connected=false, finished=false
    const timer=setTimeout(()=>finish('No complete DeviceTCP response before timeout'),timeout)
    function finish(detail) {
      if (finished) return
      finished=true
      clearTimeout(timer)
      socket.destroy()
      resolve({...device,reachable:connected,protocolVerified:frames.some(f=>/^\[(REMOTE_CONTROL|GET_PLAYLISTS)\]/.test(f)),frames,detail})
    }
    socket.on('connect',()=>{connected=true;socket.write(encodeFrame(command))})
    socket.on('data',bytes=> {
      buffer+=bytes.toString('ascii')
      if(buffer.length>1024*1024) return finish('Response exceeds 1 MB limit')
      let end
      while((end=buffer.indexOf('\r\n'))!==-1) {
        const line=buffer.slice(0,end+2)
        buffer=buffer.slice(end+2)
        try { frames.push(decodeFrame(line)) } catch { return finish('Device returned an unrecognized control frame') }
      }
      if(frames.length) finish('Received DeviceTCP response')
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
const SHOT_START_AES=Buffer.from('00060f010101','hex')
const SHOT_REQ=Buffer.from('0000000852000100','hex'), SHOT_MAX=16*1024*1024
export function parseSnapshot(buf) {
  if(buf.length<8) return
  const total=buf.readUInt32BE(0)
  if(total<8||total>SHOT_MAX) throw new Error('Invalid snapshot length')
  if((buf[4]&0xfe)!==0x52) throw new Error('Unexpected snapshot command')
  if(buf.length<total) return
  return buf.subarray(8,total)
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
export function snapshot(device,timeout=10000) {
  if (!devices.some(d=>d.ip===device.ip)) throw new Error('Unknown device')
  const udp=dgram.createSocket('udp4'), sendUdp=p=>udp.send(p,20112,device.ip)
  return new Promise((resolve,reject)=> {
    let socket, server, chunks=[], size=0, done=false
    const timer=setTimeout(()=>finish(new Error('Device did not send a screenshot before timeout')),timeout)
    function finish(error,jpeg) {
      if(done) return
      done=true; clearTimeout(timer); clearTimeout(delay); socket?.destroy(); server?.close()
      udp.send(SHOT_STOP,20112,device.ip,()=>udp.close())
      error?reject(error):resolve(jpeg)
    }
    udp.on('error',e=>finish(e))
    // ponytail: one listener per request; a concurrent request (or native Studio) holding 20114 just
    // drops to pull-only. Upgrade to a shared long-lived listener keyed by device IP if that bites.
    server=net.createServer(c=> {
      if(c.remoteAddress?.replace(/^::ffff:/,'')!==device.ip) return c.destroy()
      const parts=[]; let n=0
      c.on('data',d=> {
        parts.push(d); n+=d.length
        try { const jpeg=parsePush(Buffer.concat(parts,n)); if(jpeg) { finish(null,Buffer.from(jpeg)); c.destroy() } } catch(e) { finish(e); c.destroy() }
      })
      c.on('error',()=>{})
    })
    server.on('error',()=>{server=undefined})
    server.listen(20114,()=> {
      sendUdp(SHOT_START)
      udp.send(SHOT_START_AES,20109,device.ip)
    })
    server.once('error',()=>sendUdp(SHOT_START))
    // ponytail: fixed 1.5 s capture delay matches what worked on hardware; upgrade to UDP ack if one is found.
    const delay=setTimeout(()=> {
      socket=net.connect(20114,device.ip,()=>socket.write(SHOT_REQ))
      socket.on('data',c=> {
        chunks.push(c); size+=c.length
        try { const jpeg=parseSnapshot(Buffer.concat(chunks,size)); if(jpeg) finish(null,Buffer.from(jpeg)) } catch(e) { finish(e) }
      })
      socket.on('error',e=>finish(e))
      socket.on('end',()=>{ if(!server) finish(new Error('Device closed connection before screenshot completed')) })
    },1500)
  })
}

export async function inspectDevices() {
  const [discovered,results] = await Promise.all([
    discoverDevices().catch(error=>({error:error.message})),
    Promise.all(devices.map(d=>queryDevice(d))),
  ])
  return results.map(device=>({...device,reachable:device.reachable || discovered instanceof Map && discovered.has(device.ip),discovery:discovered instanceof Map?discovered.get(device.ip):undefined,discoveryError:discovered.error,checkedAt:new Date().toISOString()}))
}
