import {open} from 'node:fs/promises'
import {Readable} from 'node:stream'
import path from 'node:path'
import {dataRoot} from '../../../../lib/store.mjs'
export const runtime='nodejs'
const types={'.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm'}
export async function GET(request,{params}) {
  const {file}=await params
  if(!/^[0-9a-f-]{36}\.(png|jpg|gif|webp|mp4|webm)$/.test(file)) return new Response('Not found',{status:404})
  const mediaDir=path.resolve(dataRoot,'media')
  const target=path.resolve(mediaDir,file)
  if(!target.startsWith(mediaDir+path.sep)) return new Response('Not found',{status:404})
  let handle
  try {
    handle=await open(target,'r')
    const stats=await handle.stat()
    if(!stats.isFile()) throw new Error('Not a file')
    const size=stats.size
    const headers={'Content-Type':types[path.extname(file)],'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; media-src 'self'; img-src 'self'",'Cache-Control':'private, max-age=3600','Accept-Ranges':'bytes'}
    const range=request.headers.get('range')
    let start=0,end=size-1,status=200
    if(range) {
      const match=/^bytes=(\d*)-(\d*)$/.exec(range)
      let valid=!!match && !!(match[1] || match[2])
      if(valid) {
        if(!match[1]) {
          const suffix=Number(match[2])
          valid=Number.isSafeInteger(suffix) && suffix>0
          start=Math.max(0,size-suffix)
        } else {
          start=Number(match[1])
          end=match[2] ? Number(match[2]) : size-1
          valid=Number.isSafeInteger(start) && Number.isSafeInteger(end) && start<=end
          end=Math.min(end,size-1)
        }
        valid=valid && start<size
      }
      if(!valid) {
        await handle.close()
        return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${size}`,'Content-Length':'0'}})
      }
      status=206
      headers['Content-Range']=`bytes ${start}-${end}/${size}`
    }
    headers['Content-Length']=String(Math.max(0,end-start+1))
    if(size===0) {
      await handle.close()
      return new Response(null,{headers})
    }
    const stream=handle.createReadStream({start,end})
    return new Response(Readable.toWeb(stream),{status,headers})
  } catch {
    if(handle) await handle.close().catch(()=>{})
    return new Response('Not found',{status:404})
  }
}
