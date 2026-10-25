import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleSeamstressRequest } from './_handler.js'

export const maxDuration = 60

export default function fuse(req: IncomingMessage, res: ServerResponse) {
  req.url = '/api/fuse'
  return handleSeamstressRequest(req, res, process.cwd(), process.env.VERCEL ? 'production' : 'development')
}
