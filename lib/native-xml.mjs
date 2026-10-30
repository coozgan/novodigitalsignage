import {randomUUID} from 'node:crypto'

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
    return `  <Page ID="${index+1}" FreeDesignerMode="false" SerialNumber="${index+1}" BackgroundMusic="" BackgroundMusicUrl="" BackgroundMusicSize="0" BgMusicApplyToAll="${index===0}" BackgroundImage="" BackgroundImageSize="0" Layout="1" Row="1" Column="1" Orientation="Landscape" AudioSource="mute">\n`
      + `   <Section Index="1" X="0" Y="0" Z="0" Width="${width}" Height="${height}" ContentType="Media" SectionValid="true" is169="${Math.abs(width/height-16/9)<0.01}" isFixedRatio="false" Content="${escapeXml(item.fileName)}">\n`
      + `    <MediaItem src="${escapeXml(item.fileName)}" note="" duration="${Math.round(item.duration)}" videoDuration="${isVideo?Math.round(item.duration):0}" fileSize="${item.size||0}" videoStartTime="0" videoEndTime="0"${isVideo?'':' pdfPageRange=""'}/>\n`
      + `   </Section>\n`
      + `  </Page>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<NovoDS Version="1.1" Description="${escapeXml(name)}" Playlist_UUID="${uuid}" Model_Type="ds200" Interactive="false" Layout_Type="1" Show_ConnOverlay="false" ConnOverlay_Value="false">\n <Pages>\n${pages.join('\n')}\n </Pages>\n</NovoDS>\n`
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
