import {unlink,rename} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {dataRoot,loadStudio,transact,validateStudio} from '../../../lib/store.mjs'
import {mutationGuard,errorResponse} from '../../../lib/http.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET() {
  try { return Response.json(await loadStudio()) } catch(error) { return errorResponse(error,500) }
}
export async function PUT(request) {
  try {
    mutationGuard(request)
    if(Number(request.headers.get('content-length'))>2*1024*1024) throw new Error('Document exceeds 2 MB')
    const state=await request.json()
    const result=await transact(current=> {
      if(state.revision!==current.revision) { const error=new Error('Studio changed. Refresh before saving again.'); error.status=409; throw error }
      validateStudio(state,current)
      return {media:state.media,playlists:state.playlists,schedules:state.schedules}
    })
    return Response.json(result)
  } catch(error) { return errorResponse(error,error.status || 400) }
}
export async function DELETE(request) {
  try {
    mutationGuard(request)
    const {kind,id,revision,confirmed}=await request.json()
    if(confirmed!==true) throw new Error(`Confirm ${kind || 'item'} deletion`)
    if(!['media','playlist','schedule'].includes(kind)) throw new Error('Invalid item kind')
    let stagedPath
    let mediaFileToDelete
    let result
    try {
      result=await transact(async current=> {
        if(revision!==current.revision) { const error=new Error('Studio changed. Refresh before saving again.'); error.status=409; throw error }
        if(kind==='schedule') {
          const index=current.schedules.findIndex(s=>s.id===id)
          if(index<0) { const error=new Error('Schedule not found'); error.status=409; throw error }
          const schedules=[...current.schedules]
          schedules.splice(index,1)
          return {...current,schedules}
        }
        if(kind==='playlist') {
          const index=current.playlists.findIndex(p=>p.id===id)
          if(index<0) { const error=new Error('Playlist not found'); error.status=409; throw error }
          const using=current.schedules.filter(s=>s.playlistId===id)
          if(using.length>0) {
            const names=using.map(s=>`"${s.name}"`).join(', ')
            const error=new Error(`Cannot delete playlist referenced by schedule(s): ${names}`)
            error.status=409
            throw error
          }
          const playlists=[...current.playlists]
          playlists.splice(index,1)
          return {...current,playlists}
        }
        const item=current.media.find(m=>m.id===id)
        if(!item) { const error=new Error('Media not found'); error.status=409; throw error }
        const using=current.playlists.filter(p=>p.items?.some(i=>i.mediaId===id))
        if(using.length>0) {
          const names=using.map(p=>`"${p.name}"`).join(', ')
          const error=new Error(`Cannot delete media referenced by playlist(s): ${names}`)
          error.status=409
          throw error
        }
        if(!/^[0-9a-f-]{36}\.(png|jpg|gif|webp|mp4|webm)$/.test(item.fileName || '')) throw new Error('Invalid media file name')
        mediaFileToDelete=path.join(dataRoot,'media',item.fileName)
        stagedPath=`${mediaFileToDelete}.${randomUUID()}.delete`
        await rename(mediaFileToDelete,stagedPath)
        return {...current,media:current.media.filter(m=>m.id!==id)}
      })
    } catch(error) {
      if(stagedPath) await rename(stagedPath,mediaFileToDelete).catch(()=>{})
      throw error
    }
    if(stagedPath) await unlink(stagedPath).catch(()=>{})
    return Response.json(result)
  } catch(error) { return errorResponse(error,error.status || 400) }
}
