import {mkdir,writeFile,unlink} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {dataRoot,transact} from '../../../lib/store.mjs'
import {mutationGuard,errorResponse} from '../../../lib/http.mjs'
export const runtime='nodejs'
function sniff(bytes) {
  if(bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return ['png','image','image/png']
  if(bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) return ['jpg','image','image/jpeg']
  if(['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'))) return ['gif','image','image/gif']
  if(bytes.subarray(0,4).toString('ascii')==='RIFF' && bytes.subarray(8,12).toString('ascii')==='WEBP') return ['webp','image','image/webp']
  if(bytes.subarray(4,8).toString('ascii')==='ftyp') return ['mp4','video','video/mp4']
  if(bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) return ['webm','video','video/webm']
  throw new Error('Only PNG, JPEG, GIF, WebP, MP4, and WebM media files are supported')
}
export async function POST(request) {
  try {
    mutationGuard(request)
    if(Number(request.headers.get('content-length'))>52*1024*1024) throw new Error('Upload exceeds 50 MB')
    const file=(await request.formData()).get('file')
    if(!file || typeof file.arrayBuffer!=='function') throw new Error('Missing media file')
    if(file.size<12 || file.size>50*1024*1024) throw new Error('Media size must be between 12 bytes and 50 MB')
    const bytes=Buffer.from(await file.arrayBuffer())
    const [ext,type,mimeType]=sniff(bytes)
    const id=randomUUID()
    const fileName=`${id}.${ext}`
    const mediaDir=path.join(dataRoot,'media')
    const fullPath=path.join(mediaDir,fileName)
    await mkdir(mediaDir,{recursive:true})
    await writeFile(fullPath,bytes)
    const name=(file.name || fileName).replace(/[\0\r\n]/g,'').trim().slice(0,200) || fileName
    const item={id,name,type,mimeType,size:bytes.length,fileName,url:`/api/media/${fileName}`}
    let state
    try { state=await transact(current=>({...current,media:[...current.media,item]})) }
    catch(error) { await unlink(fullPath).catch(()=>{}); throw error }
    return Response.json({media:item,revision:state.revision})
  } catch(error) { return errorResponse(error) }
}
