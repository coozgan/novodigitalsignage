import {createHash} from 'node:crypto'
import {nativeScheduleMatches} from './native-xml.mjs'

// Bounded native schedule XML only. Reject declarations/entities and malformed XML,
// rather than interpreting unknown data as an empty (deletable) schedule.
export function parseDeviceSchedule(xml) {
  if(typeof xml!=='string' || xml.length>1024*1024 || /<!|[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(xml)) throw new Error('Invalid device schedule XML')
  const decode=value=>value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,(_,entity)=> {
    if(entity[0]==='#') {
      const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1))
      if(n<32 || n>0x10ffff || n>=0xd800 && n<=0xdfff) throw new Error('Invalid XML entity')
      return String.fromCodePoint(n)
    }
    return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[entity]
  })
  const stack=[],roots=[]
  const tokens=xml.match(/<\?xml\s[^?]*\?>|<[^>]*>|[^<]+/g)||[]
  if(tokens.join('')!==xml) throw new Error('Malformed schedule XML')
  for(const token of tokens) {
    if(token.startsWith('<?xml') && !roots.length) continue
    if(!token.startsWith('<')) {if(token.trim()) throw new Error('Unexpected schedule text');continue}
    if(token.startsWith('</')) {
      if(!/^<\/[A-Za-z][\w.-]*\s*>$/.test(token) || stack.pop()?.tag!==token.slice(2,-1).trim()) throw new Error('Malformed schedule nesting')
      continue
    }
    const match=/^<([A-Za-z][\w.-]*)([\s\S]*?)(\/?)>$/.exec(token)
    if(!match || stack.length>16) throw new Error('Malformed schedule element')
    const node={tag:match[1],attrs:Object.create(null),children:[]}
    let rest=match[2]
    while(rest.trim()) {
      const attr=/^\s+([A-Za-z][\w.-]*)\s*=\s*(['"])([^<>]*?)\2/.exec(rest)
      if(!attr || Object.hasOwn(node.attrs,attr[1]) || /&(?!(?:#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);)/.test(attr[3])) throw new Error('Malformed schedule attribute')
      node.attrs[attr[1]]=decode(attr[3]);rest=rest.slice(attr[0].length)
    }
    if(stack.length) stack.at(-1).children.push(node)
    else roots.push(node)
    if(!match[3]) stack.push(node)
  }
  if(stack.length || roots.length!==1 || roots[0].tag!=='AlarmManager') throw new Error('Missing complete AlarmManager schedule')
  const root=roots[0],groups=root.children.filter(n=>n.tag==='Alarms')
  if(groups.length!==1 || root.children.length!==1 || groups[0].children.some(n=>n.tag!=='Alarm')) throw new Error('Unsupported schedule structure')
  const num=(attrs,key)=> {
    if(attrs[key]===undefined) return null
    if(!/^-?\d+$/.test(attrs[key]) || !Number.isSafeInteger(Number(attrs[key]))) throw new Error(`Invalid schedule ${key}`)
    return Number(attrs[key])
  }
  const alarms=groups[0].children.map(node=> {
    const a=node.attrs
    if(!['true','false','1','0'].includes(a.Enabled)) throw new Error('Invalid alarm enabled state')
    const plays=node.children.filter(n=>n.tag==='Play')
    if(plays.length>1 || plays.length!==node.children.length || plays.some(p=>p.children.some(n=>n.tag!=='Item'))) throw new Error('Unsupported alarm content')
    const playlists=plays.flatMap(p=>p.children.map(item=>({name:item.attrs.Playlist||'',duration:num(item.attrs,'Duration'),repeat:p.attrs.Repeat==='true'})))
    if(!playlists.length && a.Playlist) playlists.push({name:a.Playlist,duration:null,repeat:false})
    return {id:a.ID||'',description:a.Description||'',enabled:['true','1'].includes(a.Enabled),type:num(a,'Type'),dateTime:num(a,'DateTime'),startTime:num(a,'StartTime'),endTime:num(a,'EndTime'),duration:num(a,'Duration'),weekMask:num(a,'WeekMask'),playlists}
  })
  return {name:root.attrs.Name||'',description:root.attrs.Description||'',defaultPlaylist:root.attrs.DefaultPlaylist||'',alarms}
}

export const emptyDeviceSchedule='<?xml version="1.0" encoding="utf-8"?>\n<AlarmManager Version="1.0" Name="_Delete_Schedule_" DefaultPlaylist="" PlayDefaultPlaylistWaitTime="5"><Alarms/></AlarmManager>'
export const emptyPlaylistManifest='[.PLS_FILES.]<?xml version="1.0" encoding="utf-8"?><Playlists/>'
export async function readDeviceSchedule(device,exchangeDevice) {
  const result=await exchangeDevice(device,'DOWNLOAD_SCHEDULE;NULL',4000)
  const frames=result.frames.filter(f=>f.startsWith('[DOWNLOAD_SCHEDULE]'))
  if(!result.reachable || frames.length!==1) throw new Error('Unable to read the device schedule. Refresh and try again.')
  const xml=frames[0].slice('[DOWNLOAD_SCHEDULE]'.length).trim()
  const schedule=parseDeviceSchedule(xml)
  return {schedule,xml,revision:createHash('sha256').update(xml).digest('hex'),checkedAt:new Date().toISOString()}
}

export function removeScheduleEntry(xml,entryIndex) {
  const schedule=parseDeviceSchedule(xml)
  if(!Number.isSafeInteger(entryIndex) || entryIndex<0 || entryIndex>=schedule.alarms.length) throw new Error('Select an existing device schedule entry')
  // Preserve all untouched native fields, unknown attributes and default assignment.
  const entries=[...xml.matchAll(/<Alarm\b[^>]*?(?:\/>|>[\s\S]*?<\/Alarm\s*>)/g)]
  if(entries.length!==schedule.alarms.length) throw new Error('Unsupported schedule entry encoding')
  const entry=entries[entryIndex]
  const updated=xml.slice(0,entry.index)+xml.slice(entry.index+entry[0].length)
  parseDeviceSchedule(updated)
  return updated
}

export async function deleteDeviceSchedule(device,{confirmed,revision,entryIndex},exchangeDevice) {
  if(confirmed!==true) throw new Error('Confirm device schedule deletion first')
  if(typeof revision!=='string' || !/^[a-f0-9]{64}$/.test(revision)) throw new Error('Read the device schedule before deleting it')
  const before=await readDeviceSchedule(device,exchangeDevice)
  if(before.revision!==revision) throw new Error('The device schedule has changed. Refresh before deleting it.')
  const selective=entryIndex!==undefined
  const replacement=selective?removeScheduleEntry(before.xml,entryIndex):emptyDeviceSchedule
  // Native Remove (Device Side) generates an empty AlarmManager and uploads it.
  // This clears scheduled rules/default playback, not playlist files or local studio data.
  // Native schedule updates require the manifest envelope, even with no files to upload.
  await exchangeDevice(device,`TCP_SCHEDULE;${replacement}${emptyPlaylistManifest}`,3000)
  try {
    const after=await readDeviceSchedule(device,exchangeDevice)
    const verified=selective?nativeScheduleMatches(after.xml,replacement):after.schedule.alarms.length===0 && after.schedule.defaultPlaylist===''
    return {...after,verified,message:verified?(selective?'Selected entry deleted. Other schedule entries, the default playlist and playlist files were preserved.':'Device schedule cleared. Device playlists and local schedules were not deleted.'):'Device readback does not match the expected schedule. Deletion is not confirmed.'}
  } catch {
    return {verified:false,schedule:null,xml:null,revision:null,message:'Schedule removal was attempted, but device readback failed. Refresh to check the result.'}
  }
}
