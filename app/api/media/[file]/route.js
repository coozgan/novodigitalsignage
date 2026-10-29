import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {dataRoot} from '../../../../lib/store.mjs'
export const runtime='nodejs'
const types={'.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm'}
export async function GET(_request,{params}) {
  const {file}=await params
  if(!/^[0-9a-f-]{36}\.(png|jpg|gif|webp|mp4|webm)$/.test(file)) return new Response('Not found',{status:404})
  const mediaDir=path.resolve(dataRoot,'media')
  const target=path.resolve(mediaDir,file)
  if(!target.startsWith(mediaDir+path.sep)) return new Response('Not found',{status:404})
  try {
    const bytes=await readFile(target)
    return new Response(bytes,{headers:{'Content-Type':types[path.extname(file)],'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; media-src 'self'; img-src 'self'",'Cache-Control':'private, max-age=3600'}})
  } catch { return new Response('Not found',{status:404}) }
}
