// Convert a wall-clock selection without relying on the server/container timezone.
export function scheduleTimeZone(value) {
  if(typeof value!=='string' || !value || value.length>100) throw new Error('Select a valid schedule timezone')
  try { return new Intl.DateTimeFormat('en-CA',{timeZone:value,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}) }
  catch { throw new Error('Select a valid schedule timezone') }
}
const parts=(format,date)=>Object.fromEntries(format.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]))
export function validScheduleDate(date) {
  return typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date+'T00:00:00Z')) && new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date
}
export function scheduleInstant(date,time,timeZone) {
  if(!validScheduleDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Select a valid schedule date and time')
  const format=scheduleTimeZone(timeZone)
  const wall=Date.parse(`${date}T${time}:00Z`),candidates=new Set()
  // Check offsets on either side of DST transitions and reject ambiguous/nonexistent times.
  for(const delta of [-86400000,0,86400000]) {
    const sample=wall+delta,p=parts(format,new Date(sample))
    const offset=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`)-sample
    const candidate=wall-offset,q=parts(format,new Date(candidate))
    if(`${q.year}-${q.month}-${q.day}T${q.hour}:${q.minute}`===`${date}T${time}`) candidates.add(candidate)
  }
  if(candidates.size!==1) throw new Error('Schedule time is ambiguous or unavailable because of daylight saving. Select another time.')
  return [...candidates][0]
}
export function scheduleDate(now,timeZone) {
  const p=parts(scheduleTimeZone(timeZone),now)
  return `${p.year}-${p.month}-${p.day}`
}
