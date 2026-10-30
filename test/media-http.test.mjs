import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {MAX_MEDIA_BYTES} from '../lib/media.mjs'

// Run after npm run build: node --test test/media-http.test.mjs
// These signature-valid synthetic bytes test transport, not device codec capability.
test('production HTTP streams 1 GiB library upload, reads, ranges and overflow cleanup',{timeout:120000},async()=> {
  const dir=await mkdtemp(path.join(tmpdir(),'novods-media-http-'))
  const base='http://127.0.0.1:3468'
  const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3468','--hostname','127.0.0.1'],{env:{...process.env,NOVODS_DATA_DIR:dir},stdio:['ignore','pipe','pipe']})
  const exited=once(server,'exit')
  let logs=''
  server.stdout.on('data',bytes=>{ logs=(logs+bytes).slice(-12000) })
  server.stderr.on('data',bytes=>{ logs=(logs+bytes).slice(-12000) })
  const signature=Buffer.from('000000006674797069736f6d','hex')
  const chunk=Buffer.alloc(1024*1024)
  async function* body(size) {
    yield signature
    for(let remaining=size-signature.length;remaining>0;remaining-=chunk.length) yield chunk.subarray(0,Math.min(chunk.length,remaining))
  }
  const upload=size=>fetch(base+'/api/media',{method:'POST',headers:{origin:base,'content-type':'video/mp4','x-file-name':encodeURIComponent('HTTP 测试.mp4')},body:body(size),duplex:'half',signal:AbortSignal.timeout(60000)})
  try {
    let ready=false
    for(let i=0;i<100;i++) {
      assert.equal(server.exitCode,null,logs)
      try {
        const response=await fetch(base+'/api/studio',{signal:AbortSignal.timeout(1000)})
        await response.arrayBuffer()
        if(response.ok) { ready=true; break }
      } catch {}
      await new Promise(resolve=>setTimeout(resolve,100))
    }
    assert.ok(ready,logs)
    const response=await upload(MAX_MEDIA_BYTES)
    assert.equal(response.status,200,await response.clone().text())
    const {media}=await response.json()
    assert.equal(media.size,MAX_MEDIA_BYTES)
    assert.equal(media.name,'HTTP 测试.mp4')
    assert.equal(media.mimeType,'video/mp4')
    const mediaDir=path.join(dir,'media')
    assert.equal((await stat(path.join(mediaDir,media.fileName))).size,MAX_MEDIA_BYTES)
    assert.deepEqual(await readdir(mediaDir),[media.fileName])
    const persisted=JSON.parse(await readFile(path.join(dir,'studio.json'),'utf8'))
    assert.deepEqual(persisted.media,[media])

    const full=await fetch(base+media.url)
    assert.equal(full.status,200)
    assert.equal(full.headers.get('content-length'),String(MAX_MEDIA_BYTES))
    assert.equal(full.headers.get('accept-ranges'),'bytes')
    let received=0
    for await(const bytes of full.body) received+=bytes.length
    assert.equal(received,MAX_MEDIA_BYTES)
    for(const [range,start,end] of [['bytes=0-11',0,11],['bytes=-16',MAX_MEDIA_BYTES-16,MAX_MEDIA_BYTES-1],[`bytes=${MAX_MEDIA_BYTES-8}-`,MAX_MEDIA_BYTES-8,MAX_MEDIA_BYTES-1]]) {
      const partial=await fetch(base+media.url,{headers:{range}})
      assert.equal(partial.status,206)
      assert.equal(partial.headers.get('content-range'),`bytes ${start}-${end}/${MAX_MEDIA_BYTES}`)
      const bytes=Buffer.from(await partial.arrayBuffer())
      assert.equal(bytes.length,end-start+1)
      if(start===0) assert.deepEqual(bytes,signature)
    }
    const invalid=await fetch(base+media.url,{headers:{range:`bytes=${MAX_MEDIA_BYTES}-`}})
    assert.equal(invalid.status,416)
    assert.equal(invalid.headers.get('content-range'),`bytes */${MAX_MEDIA_BYTES}`)
    await invalid.arrayBuffer()

    // Async iterable body uses chunked HTTP with no Content-Length to trust.
    const overflow=await upload(MAX_MEDIA_BYTES+1)
    assert.equal(overflow.status,400)
    assert.match((await overflow.json()).error,/Upload exceeds/)
    assert.deepEqual(await readdir(mediaDir),[media.fileName])
    assert.deepEqual(JSON.parse(await readFile(path.join(dir,'studio.json'),'utf8')),persisted)
    assert.deepEqual((await (await fetch(base+'/api/studio')).json()).media,[media])
  } catch(error) {
    error.message+='\nProduction server output:\n'+logs
    throw error
  } finally {
    if(server.exitCode===null) server.kill('SIGTERM')
    await exited
    await rm(dir,{recursive:true,force:true})
  }
})
