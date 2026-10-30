'use client'
import {useEffect,useState} from 'react'

export default function DeviceSnapshot({device,refresh}) {
  const [image,setImage]=useState(''),[error,setError]=useState(''),[updated,setUpdated]=useState('')
  useEffect(()=> {
    let stopped=false,pending=false,url=''
    setImage('');setUpdated('');setError('')
    const controller=new AbortController()
    async function capture() {
      if(pending) return
      pending=true
      try {
        const response=await fetch(`/api/devices/screenshot?deviceId=${encodeURIComponent(device.id)}`,{cache:'no-store',signal:controller.signal})
        if(!response.ok) {
          const result=await response.json()
          throw new Error(result.error || 'Snapshot unavailable')
        }
        const blob=await response.blob()
        if(stopped) return
        const next=URL.createObjectURL(blob)
        if(url) URL.revokeObjectURL(url)
        url=next;setImage(next);setError('');setUpdated(new Date().toLocaleTimeString())
      } catch(err) { if(!stopped) setError(err.message) }
      finally { pending=false }
    }
    capture()
    const timer=setInterval(capture,60000)
    return ()=>{stopped=true;controller.abort();clearInterval(timer);if(url) URL.revokeObjectURL(url)}
  },[device.id,refresh])
  return <div className="snapshot-preview">
    <div className="device-visual"><div className="display-frame"><div className="display-screen">
      {image?<img className="remote-snapshot" src={image} alt={`Remote snapshot of ${device.name}`}/>:<><div className="screen-logo">Novo<span>DS</span></div><span className="screen-subtitle">{error?'Snapshot unavailable':'Requesting snapshot…'}</span></>}
    </div><span className="display-led"/></div><div className="display-stand"/></div>
    <p className="snapshot-status" role="status">{updated?`Last snapshot ${updated}. `:''}{error || 'Updates every minute and on refresh.'}</p>
  </div>
}
