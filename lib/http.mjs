export function mutationGuard(request) {
  const origin=request.headers.get('origin')
  if (origin && origin!==new URL(request.url).origin) throw new Error('Cross-origin changes are not allowed')
}
export function errorResponse(error,status=400) {
  console.error(error)
  return Response.json({error:error.message || 'Request failed'},{status})
}
