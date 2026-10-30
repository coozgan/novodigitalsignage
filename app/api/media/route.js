import {mkdir,rename,unlink} from 'node:fs/promises'
import {createWriteStream} from 'node:fs'
import {Readable,Writable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {dataRoot,transact} from '../../../lib/store.mjs'
import {mutationGuard,errorResponse} from '../../../lib/http.mjs'
import {MAX_MEDIA_BYTES,MAX_LEGACY_BYTES,MAX_MULTIPART_BYTES,uploadCounter} from '../../../lib/media.mjs'
export const runtime='nodejs'
export async function POST(request) {
  let tempPath,fullPath
  try {
    mutationGuard(request)
    const multipart=(request.headers.get('content-type') || '').toLowerCase().startsWith('multipart/form-data;')
    const limit=multipart ? MAX_MULTIPART_BYTES : MAX_MEDIA_BYTES
    if(Number(request.headers.get('content-length'))>limit) throw new Error(`Upload exceeds ${limit} bytes`)
    if(!request.body) throw new Error('Missing media file')
    let source=Readable.fromWeb(request.body),name
    if(multipart) {
      // Bound the entire legacy envelope before the platform's buffering formData parser.
      const chunks=[]
      await pipeline(source,uploadCounter(limit),new Writable({write(chunk,_encoding,done) { chunks.push(chunk); done() }}),{signal:request.signal})
      const form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':request.headers.get('content-type')}}).formData()
      const file=form.get('file')
      if(!file || typeof file.stream!=='function') throw new Error('Missing media file')
      if(file.size<12 || file.size>MAX_LEGACY_BYTES) throw new Error('Media size must be between 12 bytes and 50 MiB for multipart uploads')
      name=file.name
      source=Readable.fromWeb(file.stream())
    } else {
      name=decodeURIComponent(request.headers.get('x-file-name') || '')
    }
    const id=randomUUID()
    const mediaDir=path.join(dataRoot,'media')
    await mkdir(mediaDir,{recursive:true})
    tempPath=path.join(mediaDir,`${id}.tmp`)
    const counter=uploadCounter(multipart ? MAX_LEGACY_BYTES : MAX_MEDIA_BYTES,{validate:true})
    await pipeline(source,counter,createWriteStream(tempPath,{flags:'wx'}),{signal:request.signal})
    const [ext,type,mimeType]=counter.mediaType
    const fileName=`${id}.${ext}`
    fullPath=path.join(mediaDir,fileName)
    await rename(tempPath,fullPath)
    name=(name || fileName).replace(/[\0\r\n]/g,'').trim().slice(0,200) || fileName
    const item={id,name,type,mimeType,size:counter.bytes,fileName,url:`/api/media/${fileName}`}
    const state=await transact(current=>({...current,media:[...current.media,item]}))
    fullPath=undefined
    return Response.json({media:item,revision:state.revision})
  } catch(error) { return errorResponse(error) }
  finally {
    if(tempPath) await unlink(tempPath).catch(()=>{})
    if(fullPath) await unlink(fullPath).catch(()=>{})
  }
}
