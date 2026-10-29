import {inspectDevices} from '../lib/protocol.mjs'
console.log(JSON.stringify(await inspectDevices(),null,2))
