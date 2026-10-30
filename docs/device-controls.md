# Device playlist controls

## Recovered deletion protocol

Read-only artifact: `/Applications/NovoDS Studio.app/Contents/MacOS/NovoDS Studio`, NovoDS Studio 4.4.1.101, x86_64 Mach-O, SHA-256 `81a86e4afae79d9a012f451833f4c904f5cc1997c31c726214c46ec30b08b543`.

REA MCP session confirmed the matching native target and Hopper binding. Procedure search timed out and Hopper became unreachable. One close/open recovery also timed out on pseudocode. No target application was run. Investigation continued with macOS `nm -n | c++filt` and `otool -tvV`, reading the executable only.

Exact assembly observations, not guessed command strings:

- `DeviceTCP::remoteDelete(QString)` at `0x100097460`: `0x100097473` loads the literal `DELETE;`, `0x100097481` sets its length to 7, `0x100097491` calls `QString::append` with the supplied argument, and `0x1000974b1` calls `DeviceTCP::writeLine(QString)`. Therefore the payload is exactly `DELETE;<selected name>` using the existing DeviceTCP framing.
- `Device::TCP_remoteDelete(QString)` at `0x10012b5d0` passes its QString unchanged to that method at `0x10012b5f4`.
- `DeviceSettingDialog::on_btnDelete_clicked()` at `0x100294ca0` presents a confirmation dialog, reads column zero of the selected QTableWidget row at `0x100294d4c`, converts the item data to QString at `0x100294d71`, then calls `Device::TCP_remoteDelete` at `0x100294d86`.
- `DeviceSettingDialog::rc_playlists(QString)` at `0x100280620` splits comma-separated entries and colon-separated fields at `0x100280ea9` / `0x1002812e0`, constructs a QTableWidgetItem from the name at `0x1002813a4`, and places it in the table at `0x1002813b4`. The native size parser recognizes GB, MB and BYTES. No extension or path is appended by the deletion caller.
- The same list handler checks for `[ERROR]` at `0x100280cdf` and shows `The playlist is playing on device,please stop it first.` at `0x100280d71`. This establishes a native error case, not a guaranteed device error format for every firmware.
- `DeviceTCP::tcp_messageArrived(QString)` at `0x100097c30` dispatches `[REMOTE_CONTROL]`, `[UPLOAD_STATUS]`, `[GET_PLAYLISTS]`, and password responses. `[GET_PLAYLISTS]` is checked at `0x100097d6d`, stripped at `0x1000982de`, then delivered to `rc_playlists` at `0x100098328`. This bounded inspection recovered no dedicated delete acknowledgement. An arbitrary `OK`, a socket connection, or the command reply alone is never treated as success.

To reproduce locally, run `otool -tvV` against the artifact above and inspect those exact symbols/addresses. The binary was not modified. No hardware requests were issued during this investigation or validation.

## Implemented safety and status

`POST /api/devices/control` accepts `{deviceId, action:"delete", value:<exact listed name>, confirmed:true}` after the existing same-origin mutation guard. Device lookup remains registry-based.

Deletion obtains a fresh device playlist list in the same request, requires a wholly parseable non-duplicate list, checks exact membership and conservative name validation, then sends the recovered command. It never accepts an arbitrary raw command, local playlist ID, path, client-provided allowlist, or unconfirmed delete. Delimiter/control/path-like and reserved overlay names fail closed. Unsupported list formats disable deletion rather than guessing.

A separate subsequent playlist query supplies readback. Only a valid complete listing omitting the selected name produces `verified`, with the precise user message `The device no longer lists this playlist.` A still-listed target, malformed response, error, missing reply or unreachable readback stays unconfirmed. This observes list absence only. It does not prove disk erasure, causation, or continued playback/schedule correctness. There is no automatic retry, implicit stop, or delete-and-upload sequence. A concurrent external controller can still change device state between queries.

The UI confirms the exact device and playlist, warns that device deletion cannot be undone here and may break schedules, and clears the selection after an attempt. Normal text stays user-oriented. Protocol and unresolved implementation details appear only when `DeviceControls` receives `developerMode={true}`. No changes to `page.js` are required by this implementation.

## Content replacement remains blocked

Update means replacing playlist content, not firmware. No firmware control or fake update button is added. `docs/native-xml.md` documents incomplete native playlist/schedule serializer recovery. `docs/native-upload.md` documents the custom upload crypto and transport findings but lacks independent native ciphertext vectors and complete validated XML/package conventions. Those gaps must be closed before a content replacement route can safely ship. Deletion is not represented as a workaround for update.

## Validation

`node --test test/control.test.mjs`: ten tests pass. New checks cover the exact delete mapping, confirmation types, absent/stale allowlists, malicious names, malformed/duplicate/error readback, still-present and absent targets, arbitrary ACK rejection, orchestration order and API rejection before hardware access. The delete orchestration uses injected offline functions, not sockets or real content. Tests do not establish live device acceptance. Existing API rejection checks read the registry but do not send device commands.
