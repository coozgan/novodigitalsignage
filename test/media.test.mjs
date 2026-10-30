import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readdir,readFile,rm,mkdir,rename,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Readable,Writable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {MAX_MEDIA_BYTES,MAX_LEGACY_BYTES,MAX_MULTIPART_BYTES,uploadCounter} from '../lib/media.mjs'

const signature=Buffer.from('000000006674797069736f6d','hex')
const chunk=Buffer.alloc(1024*1024)
function body(size,{fail=false}={}) {
  return Readable.toWeb(Readable.from((async function*() {
    yield signature.subarray(0,Math.min(size,signature.length))
    let remaining=size-signature.length
    while(remaining>0) {
      yield chunk.subarray(0,Math.min(remaining,chunk.length))
      remaining-=Math.min(remaining,chunk.length)
    }
    if(fail) throw new Error('broken upload')
  })()))
}
function request(stream,headers={},signal) {
  return new Request('http://localhost/api/media',{method:'POST',body:stream,duplex:'half',headers:{'content-type':'video/mp4','x-file-name':encodeURIComponent('demo 测试.mp4'),...headers},signal})
}

test('streamed media routes, limits and cleanup',async t=> {
  const root=await mkdtemp(path.join(tmpdir(),'novods-media-'))
  process.env.NOVODS_DATA_DIR=root
  const {POST}=await import('../app/api/media/route.js')
  const {GET}=await import('../app/api/media/[file]/route.js')
  const mediaDir=path.join(root,'media')
  const files=()=>readdir(mediaDir)
  let media
  try {
    await t.test('raw request streams beyond 50 MiB despite understated Content-Length',async()=> {
      const size=51*1024*1024
      const response=await POST(request(body(size),{'content-length':'12'}))
      assert.equal(response.status,200)
      media=(await response.json()).media
      assert.equal(media.size,size)
      assert.equal(media.name,'demo 测试.mp4')
      assert.equal(media.mimeType,'video/mp4')
      assert.equal((await stat(path.join(mediaDir,media.fileName))).size,size)
      assert.deepEqual(await files(),[media.fileName])
      assert.equal(JSON.parse(await readFile(path.join(root,'studio.json'))).media[0].fileName,media.fileName)
    })
    await t.test('full GET streams and ranged GET handles closed, open, suffix and clipped ranges',async()=> {
      const get=range=>GET(new Request('http://localhost'+media.url,{headers:range ? {range} : {}}),{params:Promise.resolve({file:media.fileName})})
      const response=await get()
      assert.equal(response.status,200)
      assert.equal(response.headers.get('content-length'),String(media.size))
      assert.equal(response.headers.get('accept-ranges'),'bytes')
      let count=0
      for await(const bytes of response.body) count+=bytes.length
      assert.equal(count,media.size)
      for(const [range,start,end] of [['bytes=0-11',0,11],['bytes=10-20',10,20],['bytes=-10',media.size-10,media.size-1],[`bytes=${media.size-5}-`,media.size-5,media.size-1],[`bytes=${media.size-5}-${media.size+100}`,media.size-5,media.size-1]]) {
        const partial=await get(range)
        assert.equal(partial.status,206)
        assert.equal(partial.headers.get('content-range'),`bytes ${start}-${end}/${media.size}`)
        const bytes=Buffer.from(await partial.arrayBuffer())
        assert.equal(bytes.length,end-start+1)
        if(start===0) assert.deepEqual(bytes,signature)
      }
      for(const range of ['bytes=9-2','bytes=-0','bytes=-','bytes=0-1,5-6',`bytes=${media.size}-`,'bytes=9007199254740992-']) {
        const invalid=await get(range)
        assert.equal(invalid.status,416,range)
        assert.equal(invalid.headers.get('content-range'),`bytes */${media.size}`)
      }
      const cancelled=await get()
      await cancelled.body.cancel()
      assert.equal((await GET(new Request('http://localhost'),{params:{file:'../studio.json'}})).status,404)
    })
    await t.test('legacy multipart remains compatible',async()=> {
      const form=new FormData()
      form.set('file',new Blob([signature],{type:'video/mp4'}),'legacy.mp4')
      const response=await POST(new Request('http://localhost/api/media',{method:'POST',body:form}))
      assert.equal(response.status,200)
      assert.equal((await response.json()).media.name,'legacy.mp4')
    })
    await t.test('signature sniffing spans chunks and ignores untrusted MIME',async()=> {
      const split=Readable.toWeb(Readable.from([...signature].map(byte=>Buffer.from([byte]))))
      const response=await POST(request(split,{'content-type':'image/png'}))
      assert.equal(response.status,200)
      assert.equal((await response.json()).media.mimeType,'video/mp4')
    })
    await t.test('legacy file size cap is separate from envelope cap',async()=> {
      const before=await files()
      const form=new FormData()
      form.set('file',new Blob([signature,...Array(50).fill(chunk)],{type:'video/mp4'}),'oversized.mp4')
      const response=await POST(new Request('http://localhost/api/media',{method:'POST',body:form}))
      assert.equal(response.status,400)
      assert.match((await response.json()).error,/50 MiB/)
      assert.deepEqual(await files(),before)
    })
    await t.test('1 GiB counter boundary is inclusive without a 1 GiB allocation',async()=> {
      const counter=uploadCounter()
      await pipeline(Readable.fromWeb(body(MAX_MEDIA_BYTES)),counter,new Writable({write(_chunk,_encoding,done) { done() }}))
      assert.equal(counter.bytes,MAX_MEDIA_BYTES)
      await assert.rejects(pipeline(Readable.fromWeb(body(MAX_MEDIA_BYTES+1)),uploadCounter(),new Writable({write(_chunk,_encoding,done) { done() }})),/Upload exceeds/)
    })
    await t.test('raw overflow is counted without Content-Length and removes partial file',async()=> {
      const before=await files()
      const response=await POST(request(body(MAX_MEDIA_BYTES+1)))
      assert.equal(response.status,400)
      assert.match((await response.json()).error,/Upload exceeds/)
      assert.deepEqual(await files(),before)
    })
    await t.test('raw route accepts exactly 1 GiB and serves its final bytes',async()=> {
      const response=await POST(request(body(MAX_MEDIA_BYTES)))
      assert.equal(response.status,200)
      const item=(await response.json()).media
      assert.equal(item.size,MAX_MEDIA_BYTES)
      assert.equal((await stat(path.join(mediaDir,item.fileName))).size,MAX_MEDIA_BYTES)
      const partial=await GET(new Request('http://localhost'+item.url,{headers:{range:'bytes=-12'}}),{params:{file:item.fileName}})
      assert.equal(partial.status,206)
      assert.equal(partial.headers.get('content-range'),`bytes ${MAX_MEDIA_BYTES-12}-${MAX_MEDIA_BYTES-1}/${MAX_MEDIA_BYTES}`)
      assert.equal((await partial.arrayBuffer()).byteLength,12)
    })
    await t.test('legacy envelope cap counts bytes even with false Content-Length',async()=> {
      const before=await files()
      const response=await POST(request(body(MAX_MULTIPART_BYTES+1),{'content-type':'multipart/form-data; boundary=test','content-length':'12'}))
      assert.equal(response.status,400)
      assert.match((await response.json()).error,/Upload exceeds/)
      assert.deepEqual(await files(),before)
      assert.equal(MAX_LEGACY_BYTES,50*1024*1024)
    })
    await t.test('bad signatures, short bodies, source errors, aborts and bad filename leave no files',async()=> {
      const before=await files()
      for(const req of [request(body(11)),request(Buffer.alloc(20)),request(body(1024,{fail:true})),request(body(12),{'x-file-name':'%zz'})]) {
        assert.equal((await POST(req)).status,400)
        assert.deepEqual(await files(),before)
      }
      const controller=new AbortController()
      const req=request(body(51*1024*1024),{},controller.signal)
      const pending=POST(req)
      controller.abort()
      assert.equal((await pending).status,400)
      assert.deepEqual(await files(),before)
    })
    await t.test('persistence errors remove atomically finalized file',async()=> {
      const before=await files()
      const state=path.join(root,'studio.json')
      await rename(state,state+'.saved')
      await mkdir(state)
      try {
        assert.equal((await POST(request(body(12)))).status,400)
        assert.deepEqual(await files(),before)
      } finally {
        await rm(state,{recursive:true})
        await rename(state+'.saved',state)
      }
    })
  } finally { await rm(root,{recursive:true,force:true}) }
})
