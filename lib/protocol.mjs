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

export async function inspectDevices() {
  const [discovered,results] = await Promise.all([
    discoverDevices().catch(error=>({error:error.message})),
    Promise.all(devices.map(d=>queryDevice(d))),
  ])
  return results.map(device=>({...device,reachable:device.reachable || discovered instanceof Map && discovered.has(device.ip),discovery:discovered instanceof Map?discovered.get(device.ip):undefined,discoveryError:discovered.error,checkedAt:new Date().toISOString()}))
}
