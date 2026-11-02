import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'

// Run only against an isolated Docker Compose project, never production data:
// NOVODS_PORT=3100 docker compose -p novods-shipping up -d --build --wait
// node scripts/docker-smoke.mjs http://127.0.0.1:3100 novods-shipping
const [base,project]=process.argv.slice(2)
assert.ok(base && project,'Usage: node scripts/docker-smoke.mjs BASE_URL ISOLATED_COMPOSE_PROJECT')
const compose=(...args)=>execFileSync('docker',['compose','-p',project,...args],{stdio:'inherit',env:{...process.env,NOVODS_PORT:new URL(base).port || '80'}})
const request=(url,options={})=>fetch(base+url,{...options,headers:{...options.headers,connection:'close'},signal:AbortSignal.timeout(15000)})
const json=body=>({method:'PUT',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(body)})
const home=await request('/')
assert.equal(home.status,200)
assert.match(await home.text(),/NovoDS/)
const initial=await (await request('/api/studio')).json()
assert.deepEqual(initial,{media:[],playlists:[],schedules:[],revision:0},'Requires a fresh isolated data volume')
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64')
const upload=await request('/api/media',{method:'POST',headers:{origin:base,'content-type':'image/png','x-file-name':'shipping-test.png'},body:png})
assert.equal(upload.status,200,await upload.clone().text())
const {media,revision}=await upload.json()
const state={media:[media],playlists:[{id:'shipping-playlist',name:'Shipping test',width:1920,height:1080,items:[{mediaId:media.id,duration:10}]}],schedules:[],revision}
const saved=await request('/api/studio',json(state))
assert.equal(saved.status,200,await saved.clone().text())
const expected=await saved.json()
const rejected=await request('/api/studio',{...json(expected),headers:{'content-type':'application/json',origin:'https://untrusted.example'}})
assert.equal(rejected.status,400)
const range=await request(media.url,{headers:{range:'bytes=0-7'}})
assert.equal(range.status,206)
assert.deepEqual(Buffer.from(await range.arrayBuffer()),png.subarray(0,8))
compose('down')
compose('up','-d','--wait')
assert.deepEqual(await (await request('/api/studio')).json(),expected,'Data must survive container recreation')
const download=await request(media.url)
assert.equal(download.status,200)
assert.deepEqual(Buffer.from(await download.arrayBuffer()),png)
console.log('PASS: page, upload, playlist save, cross-origin rejection, ranged media, and persistence after container recreation')
