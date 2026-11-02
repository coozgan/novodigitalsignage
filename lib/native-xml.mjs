import {randomUUID} from 'node:crypto'
import {scheduleInstant,scheduleDate} from './schedule-time.mjs'

// Native NovoDS index.xml serializer, recovered from NovoDS Studio 4.4.1.101
// (EditPlaylist::saveXML 0x10006a000, Section::writeXML 0x1001abbd0,
// Image_Video_Model::writeXML 0x1001a2790, PlaylistDoc::openPlaylistFile2 defaults).
// Supports Media (image/video) sections only; other native widget types are rejected
// rather than guessed.

const escapeXml = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))

const safeName = value => typeof value==='string' && value.length>0 && value.length<=200 && !/[\x00-\x1f/\\]/.test(value)

export function nativePlaylistXml({name,width=1920,height=1080,items,uuid=randomUUID()}) {
  if(!safeName(name)) throw new Error('Invalid native playlist name')
  if(!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 || width>7680 || height>7680) throw new Error('Invalid playlist resolution')
  if(!Array.isArray(items) || !items.length || items.length>255) throw new Error('Playlist requires 1 to 255 items')
  // Full-screen single-section Media pages, sequential like the web studio sequence.
  const pages=items.map((item,index)=> {
    if(!item || !safeName(item.fileName)) throw new Error('Invalid media file name')
    if(!Number.isFinite(item.duration) || item.duration<1 || item.duration>86400) throw new Error('Invalid media duration')
    const isVideo=item.mediaType==='video'
    // Native LandscapeTemplates::create_1 uses a 1x1 section in a 1x1 grid, not pixels.
    // saveXML uses numeric orientation/validity and a Content element, not an attribute.
    return `  <Page ID="${index+1}" FreeDesignerMode="false" SerialNumber="${index+1}" BackgroundMusic="" BackgroundMusicUrl="" BackgroundMusicSize="0" BgMusicApplyToAll="${index===0}" BackgroundImage="" BackgroundImageSize="0" Layout="1" Row="1" Column="1" Orientation="${height>width?1:0}" AudioSource="mute">\n`
      + `   <Section Index="1" X="0" Y="0" Z="0" Width="1" Height="1" ContentType="Media" SectionValid="1" is169="${Math.abs(width/height-16/9)<0.01}" isFixedRatio="false">\n`
      + `    <Content isVideoFillArea="false" Detect_Picture_Orientation="false" showType="Default" scaleType="FIT_CENTER" duration="${Math.round(item.duration)}">\n`
      + `     <AttachmentFiles><File Name="${escapeXml(item.fileName)}" Size="${item.size||0}"/></AttachmentFiles>\n`
      + `     <MediaItem src="${escapeXml(item.fileName)}" note="" duration="${Math.round(item.duration)}" videoDuration="${isVideo?Math.round(item.duration):0}" fileSize="${item.size||0}" videoStartTime="0" videoEndTime="0"${isVideo?'':' pdfPageRange=""'}/>\n`
      + `    </Content>\n`
      + `   </Section>\n`
      + `  </Page>`
  })
  // Part_Pages::writeTimelineXML (0x100191da0) appends Timeline to NovoDS,
  // with ordered Item Duration/Page attributes. totalTime is only for non-looping timelines.
  const timeline=items.map((item,index)=>`  <Item Duration="${Math.round(item.duration)}" Page="${index+1}"/>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<NovoDS Version="1.1" Description="${escapeXml(name)}" Playlist_UUID="${uuid}" Model_Type="ds200" Interactive="false" Layout_Type="1" Show_ConnOverlay="false" ConnOverlay_Value="false">\n <Pages>\n${pages.join('\n')}\n </Pages>\n <Timeline Looping="true">\n${timeline}\n </Timeline>\n</NovoDS>\n`
}

// Files a native upload session must carry for a studio playlist: index.xml first, then media.
export function nativePlaylistFiles({name,width,height,items,mediaBytes,uuid}) {
  const indexXml=nativePlaylistXml({name,width,height,items,uuid})
  const files=[{fileName:'index.xml',bytes:Buffer.from(indexXml,'utf8')}]
  const seen=new Set(['index.xml'])
  for(const item of items) {
    if(!safeName(item.fileName) || seen.has(item.fileName)) throw new Error(`Duplicate or invalid media file name: ${item.fileName}`)
    if(!Buffer.isBuffer(mediaBytes?.[item.fileName])) throw new Error(`Missing media bytes for ${item.fileName}`)
    seen.add(item.fileName)
    files.push({fileName:item.fileName,bytes:mediaBytes[item.fileName],size:item.size ?? mediaBytes[item.fileName].length,mediaType:item.mediaType,duration:item.duration})
  }
  if(files.length>255) throw new Error('Native upload supports 1 to 255 files')
  return files
}

export {safeName as validNativeName}

// AlarmParamsDialog2::accept and ScheduleUI::genarateXMLE: weekly=3,
// Monday-first bits, epoch milliseconds for DateTime, duration in seconds.
export function nativeScheduleXml({schedule,playlistName,now=new Date()}) {
  const time=value=>typeof value==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  if(!schedule || !safeName(schedule.name) || !safeName(playlistName)) throw new Error('Invalid native schedule or playlist name')
  if(!time(schedule.start) || !time(schedule.end) || schedule.end<=schedule.start) throw new Error('Schedule end must be after start on the same day')
  const {days}=schedule,once=schedule.recurrence==='once'
  if(schedule.recurrence!==undefined && !['weekly','once'].includes(schedule.recurrence)) throw new Error('Invalid schedule recurrence')
  if(!once && (!Array.isArray(days) || !days.length || new Set(days).size!==days.length || !days.every(d=>Number.isInteger(d) && d>=0 && d<=6))) throw new Error('Invalid schedule days')
  if(!schedule.timeZone) throw new Error('Edit and save this schedule to confirm its timezone before publishing.')
  const date=once?schedule.date:scheduleDate(now,schedule.timeZone)
  const start=scheduleInstant(date,schedule.start,schedule.timeZone)
  const end=scheduleInstant(date,schedule.end,schedule.timeZone)
  const seconds=value=>{const [h,m]=value.split(':').map(Number);return h*3600+m*60}
  const mask=once?0:days.reduce((mask,day)=>mask | (1<<((day+6)%7)),0)
  const id=String(now.getTime())
  return `<?xml version="1.0" encoding="UTF-8"?>\n<AlarmManager Version="1.0" Name="${escapeXml(schedule.name)}" DefaultPlaylist="" PlayDefaultPlaylistWaitTime="5" Description="">\n <Alarms>\n  <Alarm ID="${id}" Enabled="true" Type="${once?0:3}" StartTime="-1" EndTime="-1" DateTime="${start}" Duration="${once?(end-start)/1000:seconds(schedule.end)-seconds(schedule.start)}" WeekMask="${mask}" Playlist="" Description="${escapeXml(schedule.name)}">\n   <Play Repeat="true"><Item Playlist="${escapeXml(playlistName)}" Duration="-1" Publishid="${id}"/></Play>\n  </Alarm>\n </Alarms>\n</AlarmManager>\n`
}

export function nativeSchedulePayload({scheduleXml,playlists}) {
  if(typeof scheduleXml!=='string' || !scheduleXml.includes('<AlarmManager ') || /\0/.test(scheduleXml)) throw new Error('Invalid schedule XML')
  if(!Array.isArray(playlists) || !playlists.length) throw new Error('Schedule requires a playlist')
  const manifest=playlists.map(({name,files})=> {
    if(!safeName(name) || !Array.isArray(files) || !files.length) throw new Error('Invalid schedule playlist')
    return `<Playlist Name="${escapeXml(name)}">${files.map(({fileName,bytes})=> {
      if(!safeName(fileName) || !Buffer.isBuffer(bytes)) throw new Error('Invalid schedule file')
      return `<File Name="${escapeXml(fileName)}" Size="${bytes.length}"/>`
    }).join('')}</Playlist>`
  }).join('')
  return `${scheduleXml}[.PLS_FILES.]<?xml version="1.0" encoding="utf-8"?>\n<Playlists>${manifest}</Playlists>`
}

// Compare all native elements and attributes, ignoring XML formatting, quote style,
// attribute order and self-closing spelling changed by Android's XML writer.
export function nativeScheduleMatches(actual,expected) {
  const tokens=xml=> {
    if(typeof xml!=='string') return null
    const result=[]
    for(const match of xml.matchAll(/<([^>]+)>/g)) {
      if(match[1].startsWith('?')) continue
      const tag=/^(\/?[A-Za-z_][\w.:-]*)\b/.exec(match[1])?.[1]
      if(!tag) return null
      const attrs=[...match[1].matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*(['"])(.*?)\2/g)].map(m=>[m[1],m[3].replace(/&(?:amp|lt|gt|quot|apos);/g,e=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[e]))]).sort((a,b)=>a[0].localeCompare(b[0]))
      result.push([tag,attrs])
      if(match[1].endsWith('/')) result.push(['/'+tag,[]])
    }
    return result.length?result:null
  }
  const a=tokens(actual),b=tokens(expected)
  return a!==null && b!==null && JSON.stringify(a)===JSON.stringify(b)
}
