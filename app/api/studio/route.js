import {loadStudio,transact,validateStudio} from '../../../lib/store.mjs'
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
