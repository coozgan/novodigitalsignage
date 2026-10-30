import test from 'node:test'
import assert from 'node:assert/strict'
import {access,mkdtemp,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const dir=await mkdtemp(path.join(os.tmpdir(),'novods-studio-delete-'))
process.env.NOVODS_DATA_DIR=dir
const studio=await import('../app/api/studio/route.js')
const media=await import('../app/api/media/route.js')
const mediaFile=await import('../app/api/media/[file]/route.js')
const headers={origin:'http://localhost:3000','content-type':'application/json'}
const remove=(kind,id,revision,confirmed=true)=>studio.DELETE(new Request('http://localhost:3000/api/studio',{method:'DELETE',headers,body:JSON.stringify({kind,id,revision,confirmed})}))
test.after(()=>rm(dir,{recursive:true,force:true}))

test('confirmed studio deletes block dependents and reject stale revisions',async()=> {
  const form=new FormData()
  form.set('file',new File([Buffer.from('000000006674797069736f6d','hex')],'delete.mp4',{type:'video/mp4'}))
  const uploaded=await media.POST(new Request('http://localhost:3000/api/media',{method:'POST',headers:{origin:headers.origin},body:form}))
  assert.equal(uploaded.status,200)
  const {media:item,revision}=await uploaded.json()
  const saved=await studio.PUT(new Request('http://localhost:3000/api/studio',{method:'PUT',headers,body:JSON.stringify({revision,media:[item],playlists:[{id:'playlist-1',name:'Playlist',width:1920,height:1080,items:[{mediaId:item.id,duration:10}]}],schedules:[{id:'schedule-1',name:'Schedule',playlistId:'playlist-1',start:'08:00',end:'09:00',days:[1]}]})}))
  assert.equal(saved.status,200)
  let state=await saved.json()

  for(const body of [
    {kind:'schedule',id:'schedule-1',revision:state.revision},
    {kind:'media',id:item.id,revision:state.revision},
  ]) {
    const response=await studio.DELETE(new Request('http://localhost:3000/api/studio',{method:'DELETE',headers,body:JSON.stringify(body)}))
    assert.equal(response.status,400)
  }
  assert.equal((await remove('playlist','playlist-1',state.revision)).status,409)
  assert.equal((await remove('media',item.id,state.revision)).status,409)

  const directMediaBlocked=await remove('media',item.id,state.revision)
  assert.equal(directMediaBlocked.status,409)
  assert.match((await directMediaBlocked.json()).error,/referenced by playlist/)

  let response=await remove('schedule','schedule-1',state.revision)
  assert.equal(response.status,200)
  state=await response.json()
  response=await remove('playlist','playlist-1',state.revision)
  assert.equal(response.status,200)
  state=await response.json()

  const directMediaDeleted=await remove('media',item.id,state.revision)
  assert.equal(directMediaDeleted.status,200)
  state=await directMediaDeleted.json()
  assert.deepEqual(state.media,[])
  await assert.rejects(access(path.join(dir,'media',item.fileName)))
  assert.equal((await mediaFile.GET(new Request('http://localhost'+item.url),{params:{file:item.fileName}})).status,404)

  assert.equal((await remove('schedule','schedule-1',state.revision)).status,409)
  const stale=await remove('schedule','schedule-1',state.revision-1)
  assert.equal(stale.status,409)
  assert.match((await stale.json()).error,/Studio changed/)
})
