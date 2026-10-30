import {mkdir,readFile,writeFile,rename,link,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {isIP} from 'node:net'
import path from 'node:path'

const file=path.resolve(process.env.NOVODS_DATA_DIR || 'data','devices.json')
const seeds=[
  {id:'device-1',name:'Device 1',ip:'192.168.80.128',model:'ds200'},
  {id:'device-2',name:'Device 2',ip:'192.168.80.100',model:'ds200'},
]
// Compatibility for existing imports. Runtime callers load the registry before use.
export const devices=seeds.map(device=>({...device}))
let queue=Promise.resolve()
function serialize(task) {
  const result=queue.then(task)
  queue=result.catch(()=>{})
  return result
}
async function persist(entries,seed=false) {
  await mkdir(path.dirname(file),{recursive:true})
  const temp=`${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temp,JSON.stringify(entries,null,2),{flag:'wx'})
    if(seed) await link(temp,file)
    else await rename(temp,file)
  } finally { await rm(temp,{force:true}) }
}
async function readRegistry() {
  let entries
  try { entries=JSON.parse(await readFile(file,'utf8')) }
  catch(error) {
    if(error.code!=='ENOENT') throw error
    try { await persist(seeds,true) } catch(error) { if(error.code!=='EEXIST') throw error }
    entries=JSON.parse(await readFile(file,'utf8'))
  }
  if(!Array.isArray(entries) || entries.some(d=>!d || typeof d.id!=='string' || typeof d.name!=='string' || !isIP(d.ip))) throw new Error('Invalid device registry')
  devices.splice(0,devices.length,...entries.map(device=>({...device})))
  return entries
}
// ponytail: serialized atomic JSON writes cover one Studio process; use SQLite before running multiple writers.
export function loadDevices() { return serialize(readRegistry) }
export async function findDevice(id) {
  const device=(await loadDevices()).find(d=>d.id===id)
  if(!device) throw new Error('Unknown device')
  return device
}
export function addDevice({name,ip}) {
  return serialize(async()=> {
    if(typeof name!=='string' || !name.trim() || name.length>200 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Invalid device name')
    // Existing discovery and screenshot transports are IPv4. Never accept hosts, URLs, loopback or public targets.
    if(typeof ip!=='string' || isIP(ip)!==4) throw new Error('Invalid device IP: enter a private LAN IPv4 address')
    const [a,b]=ip.split('.').map(Number)
    if(!(a===10 || a===172 && b>=16 && b<=31 || a===192 && b===168)) throw new Error('Device IP must be a private LAN IPv4 address')
    const entries=await readRegistry()
    if(entries.some(d=>d.ip===ip)) throw new Error('Duplicate device IP')
    const device={id:randomUUID(),name:name.trim(),ip,model:'ds200'}
    await persist([...entries,device])
    devices.push({...device})
    return device
  })
}
