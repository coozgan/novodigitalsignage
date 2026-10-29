# Native upload investigation

Artifact: `/Applications/NovoDS Studio.app/Contents/MacOS/NovoDS Studio`
SHA256: `81a86e4afae79d9a012f451833f4c904f5cc1997c31c726214c46ec30b08b543`

## Static observations

- `UploadToDevice::run` at `0x1003f2a40` calls DataExchangeClient construction and `setAesKeyInfo`, plus playlist/schedule upload handlers. Evidence `ev_71c84c0876db58212b7ebac229776095f2e6fdcd2676b694637abe49cd8060e1`.
- `setAesKeyInfo` at `0x1002b6160` only assigns two QString fields at offsets `0x200098` and `0x2000a0`. It does not derive a key. Evidence `ev_9bfe26231a2f383c43854541c5d0320abdf0016a7694091b05e6f3114543f49f`.
- `sendFileDataToServer` at `0x1002b4890` calls AES Crypt (`0x100407e70`) and `_nvc_crypto_getIV` (`0x10040ac50`). Evidence `ev_9a0687b367c39f0a645e7610cb3e778b995de52b4c1d2d90112c5b35386abbff`.
- `_nvc_crypto_getIV(out, uint32)` builds 16 bytes. For little-endian input bytes a,b,c,d, output is `[a,b,c,d,c,~a,d,~b,~d,b,~c,a,~d,~c,~b,~a]` with byte truncation. Assembly confirms bitwise NOT, not logical negation shown ambiguously in pseudocode. Evidence `ev_05f98fba6986acb5018415dccca37cc0e305b1443ce4c521c3369d2680ec84bc`.

## Remaining work

Key assembly `ev_f96cc2047084211d1e10bcc29de51a8db58db4dbd25e8ed5ef4132ed33f816c7` and switch-table bytes `ev_042faab1866d17a1792acbb0074de7f0090a03cad865612a0002588bc46d1ae2` resolve the final operation by original key byte modulo six: 0 add mask, 1 absolute difference, 2 unchanged, 3 replace with mask, 4 multiply mask, 5 XOR mask (all byte-truncated). Table at 0x1002b660c: `38ffffff42ffffff07fffffffefeffff54ffffff5effffff`.

Initial key fill is `key[(seed+i)&31] = firstUtf8[i % firstUtf8.length]`. Second fill multiplies each byte by repeated second-string bytes, with a separate rotated index. Mask assembly has three branches selected by `(floor(seed/1000)+iteration)%3`. Preserve unsigned 32-bit arithmetic and bitwise NOT, not logical negation. Full algorithm still needs independent vectors before integration.

UploadToDevice::run pseudocode `ev_9330a0d4d6032d7dae74a818862bcf3f52cec2fc495d553b6fc10933ea6989d5` traces the two configured strings to UploadToDevice fields +0x90 and +0x98. Their writers remain to be traced. No device uploads have been attempted.

Assembly follow-up `ev_ecc937012a776967a2c448ddae67d70ebd5e779eea09e73fb15b432340beb595` confirms the numeric key seed is the basename QString length (UTF-16 code units), not file size: QFileInfo::fileName is stored at object +0x38, then `[QString data +4]` feeds QString::number at 0x1002b4eae. JavaScript basename `.length` matches this length convention. IV helper is implemented with fixed-vector checks in commit `6c621b9`.

Follow-up evidence `ev_ca5e13900346105c79a6360f8bfd5fe202d389b5fe660557f86f285cfedfc2f1`: file sender obtains QTime::currentTime, divides milliseconds by 1000, writes the timestamp big-endian in the header and passes it to getIV. Key helper is `sub_1002b6190`, receiving a numeric QString and the two configured strings. The numeric QString source needs assembly confirmation (pseudocode points at an object field's length).

Key helper evidence `ev_6ee16ca95f4f5bfa4140c7bde554736fffca9fc608927312d345d7d236066efa` is complete pseudocode. It fills a 32-byte key by rotated repeated bytes of one UTF-8 string, multiplies by bytes of the other string, derives a 32-byte numeric mask, and combines each byte using a six-way operation. Compiler division constants and ambiguous decompiler negations require assembly validation before implementation. Do not substitute a standard hash for this custom derivation.

Trace the IV argument and key construction in `sendFileDataToServer`, and the two strings passed by UploadToDevice::run. Recover complete native XML and archive conventions before exposing deployment API. Local loopback tests do not establish device compatibility. Transport is committed at `febc171`, not wired to deployment routes.

Hopper recovery: close/open restored provider after unreachable error. First search timed out during startup; subsequent focused calls and search succeeded.
