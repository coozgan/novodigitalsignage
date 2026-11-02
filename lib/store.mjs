import {mkdir,readFile,writeFile,rename} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {scheduleInstant,scheduleTimeZone,validScheduleDate} from './schedule-time.mjs'

// ponytail: atomic single-JSON persistence covers local single-operator studio; upgrade to SQLite if concurrent multi-operator access is needed.
export const dataRoot = path.resolve(process.env.NOVODS_DATA_DIR || 'data')
let queue=Promise.resolve()
export async function loadStudio() {
  try { return JSON.parse(await readFile(path.join(dataRoot,'studio.json'),'utf8')) }
  catch (error) { if(error.code==='ENOENT') return {media:[],playlists:[],schedules:[],revision:0}; throw error }
}
const requireValue = (condition,message) => { if(!condition) throw new Error(message) }
const id = value => typeof value==='string' && /^[a-zA-Z0-9-]{1,80}$/.test(value)
const name = value => typeof value==='string' && value.trim().length>0 && value.length<=200
export function validateStudio(state,existing) {
  requireValue(state && Array.isArray(state.media) && Array.isArray(state.playlists) && Array.isArray(state.schedules),'Invalid studio document')
  for(const key of ['media','playlists','schedules']) {
    requireValue(state[key].length<=1000,'Too many entries')
    requireValue(new Set(state[key].map(x=>x.id)).size===state[key].length,'Duplicate IDs')
    for(const entry of state[key]) requireValue(id(entry.id) && name(entry.name),'Each entry requires an ID and name')
  }
  for(const media of state.media) requireValue(existing.media.some(m=>JSON.stringify(m)===JSON.stringify(media)),'Media can only be added through upload')
  for(const p of state.playlists) {
    requireValue(Number.isInteger(p.width) && p.width>=1 && p.width<=7680 && Number.isInteger(p.height) && p.height>=1 && p.height<=7680,'Invalid playlist resolution')
    requireValue(Array.isArray(p.items) && p.items.length<=1000,'Invalid playlist items')
    for(const item of p.items) requireValue(state.media.some(m=>m.id===item.mediaId) && Number.isFinite(item.duration) && item.duration>0 && item.duration<=86400,'Invalid media reference or duration')
  }
  for(const s of state.schedules) {
    requireValue(state.playlists.some(p=>p.id===s.playlistId),'Schedule references an unknown playlist')
    requireValue(/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.end) && s.end>s.start,'Schedule end must be after start on the same day')
    requireValue(s.recurrence===undefined || ['weekly','once'].includes(s.recurrence),'Select a valid schedule recurrence')
    if(s.timeZone!==undefined) scheduleTimeZone(s.timeZone)
    if(s.recurrence==='once') {
      requireValue(validScheduleDate(s.date),'Select a valid schedule date')
      scheduleInstant(s.date,s.start,s.timeZone)
      scheduleInstant(s.date,s.end,s.timeZone)
    } else requireValue(Array.isArray(s.days) && s.days.length>0 && s.days.length<=7 && new Set(s.days).size===s.days.length && s.days.every(d=>Number.isInteger(d) && d>=0 && d<=6),'Select valid schedule days')
  }
}
export function transact(update) {
  const task=queue.then(async()=> {
    const current=await loadStudio()
    const next=await update(current)
    next.revision=(current.revision || 0)+1
    await mkdir(dataRoot,{recursive:true})
    const temp=path.join(dataRoot,`${randomUUID()}.tmp`)
    await writeFile(temp,JSON.stringify(next,null,2))
    await rename(temp,path.join(dataRoot,'studio.json'))
    return next
  })
  queue=task.catch(()=>{})
  return task
}
