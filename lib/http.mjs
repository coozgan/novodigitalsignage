// ponytail: loopback and Host-header origin check covers local single-operator studio; upgrade to signed session tokens if exposed beyond LAN.
const local = host => ['localhost','127.0.0.1','[::1]'].includes(host)
export function mutationGuard(request) {
  const origin=request.headers.get('origin')
  if (!origin) return
  const from=new URL(origin), target=new URL(request.url)
  const host=request.headers.get('x-forwarded-host') || request.headers.get('host') || target.host
  if (from.host===host || from.host===target.host) return
  if (local(from.hostname) && local(target.hostname) && (from.port || '80')===(target.port || '80')) return
  throw new Error('Cross-origin changes are not allowed')
}
export function errorResponse(error,status=400) {
  console.error(error)
  return Response.json({error:error.message || 'Request failed'},{status})
}
