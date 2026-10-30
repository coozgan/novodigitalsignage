import {Transform} from 'node:stream'

export const MAX_MEDIA_BYTES=1024*1024*1024
export const MAX_LEGACY_BYTES=50*1024*1024
export const MAX_MULTIPART_BYTES=MAX_LEGACY_BYTES+2*1024*1024

export function sniff(bytes) {
  if(bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return ['png','image','image/png']
  if(bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff) return ['jpg','image','image/jpeg']
  if(['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'))) return ['gif','image','image/gif']
  if(bytes.subarray(0,4).toString('ascii')==='RIFF' && bytes.subarray(8,12).toString('ascii')==='WEBP') return ['webp','image','image/webp']
  if(bytes.subarray(4,8).toString('ascii')==='ftyp') return ['mp4','video','video/mp4']
  if(bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) return ['webm','video','video/webm']
  throw new Error('Only PNG, JPEG, GIF, WebP, MP4, and WebM media files are supported')
}

export function uploadCounter(limit=MAX_MEDIA_BYTES,{validate=false}={}) {
  let prefix=Buffer.alloc(0)
  const stream=new Transform({
    transform(chunk,_encoding,callback) {
      stream.bytes+=chunk.length
      if(stream.bytes>limit) return callback(new Error(`Upload exceeds ${limit} bytes`))
      if(validate && prefix.length<12) {
        prefix=Buffer.concat([prefix,chunk.subarray(0,12-prefix.length)])
        if(prefix.length===12) {
          try { stream.mediaType=sniff(prefix) }
          catch(error) { return callback(error) }
        }
      }
      callback(null,chunk)
    },
    flush(callback) {
      callback(validate && stream.bytes<12 ? new Error('Media size must be at least 12 bytes') : null)
    }
  })
  stream.bytes=0
  return stream
}
